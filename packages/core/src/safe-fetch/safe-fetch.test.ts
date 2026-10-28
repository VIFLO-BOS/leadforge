import zlib from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SafeFetchError, parseHostOverrides } from "./safe-fetch.js";
import {
  html,
  MemoryRobotsCache,
  RecordingLimiter,
  startServer,
  StubResolver,
  testFetcher,
  UA,
  type TestServer,
} from "./test-support.js";

/**
 * SafeFetch against local servers. DNS is stubbed: test host names resolve to public-looking
 * addresses, and the dial hook connects those addresses to 127.0.0.1. No internet access.
 */

const PUBLIC = "93.184.216.34";
const PUBLIC_TLS = "93.184.216.35";
let server: TestServer;
let tlsServer: TestServer;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code;
    throw err;
  }
}

beforeAll(async () => {
  server = await startServer({
    "/robots.txt": html(
      "User-agent: *\nDisallow: /private\n\nUser-agent: leadforgebot\nDisallow: /bot-only\n",
      200,
      { "content-type": "text/plain" },
    ),
    "/": html("<html><head><title>Home</title></head><body>Hello</body></html>", 200, {
      "set-cookie": "session=abc; Path=/",
    }),
    "/again": html("<p>again</p>"),
    "/private": html("<p>secret</p>"),
    "/bot-only": html("<p>no bots</p>"),
    "/image": (_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.alloc(10));
    },
    "/no-type": (_req, res) => {
      res.writeHead(200);
      res.end("<p>x</p>");
    },
    "/big": (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(64 * 1024, 97);
      let sent = 0;
      const push = () => {
        while (sent < 3 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return res.once("drain", push);
        }
        res.end();
      };
      push();
    },
    "/big-declared": (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-length": String(50 * 1024 * 1024),
      });
      res.write("<p>");
    },
    "/bomb": (_req, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 32)));
    },
    "/slow": () => {
      // never answers
    },
    "/drip": (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<p>start");
    },
    "/redirect-ok": html("", 302, { location: "/again" }),
    "/redirect-internal": html("", 302, { location: "http://internal.example.ng/admin" }),
    "/redirect-literal": html("", 301, { location: "http://127.0.0.1/" }),
    "/redirect-metadata": html("", 307, { location: "http://169.254.169.254/latest/meta-data/" }),
    "/redirect-localhost": html("", 302, { location: "http://localhost/" }),
    "/redirect-ftp": html("", 302, { location: "ftp://shop.example.ng/file" }),
    "/redirect-port": html("", 302, { location: "http://shop.example.ng:22/" }),
    "/loop": html("", 302, { location: "/loop" }),
    "/server-error": html("<p>oops</p>", 500),
  });
  tlsServer = await startServer({ "/": html("<p>tls</p>") }, true);
});

afterAll(async () => {
  await server.close();
  await tlsServer.close();
});

beforeEach(() => {
  server.requests.length = 0;
});

function fetcher(
  resolverTable: ConstructorParameters<typeof StubResolver>[0] = {},
  extra: Parameters<typeof testFetcher>[0] extends infer O ? Partial<O> : never = {},
) {
  const resolver = new StubResolver({
    "shop.example.ng": [{ address: PUBLIC, family: 4 }],
    "selfsigned.example.test": [{ address: PUBLIC_TLS, family: 4 }],
    "internal.example.ng": [{ address: "10.0.0.5", family: 4 }],
    ...resolverTable,
  });
  const dialed: string[] = [];
  const f = testFetcher({
    resolver,
    dialMap: { [PUBLIC]: server.port, [PUBLIC_TLS]: tlsServer.port },
    dialed,
    ...extra,
  });
  return { f, resolver, dialed };
}

describe("SafeFetch: URL and address policy", () => {
  it("fetches through the pinned address with the original Host, our user agent and no cookies", async () => {
    const { f, dialed } = fetcher();
    const res = await f.fetch("http://shop.example.ng/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Hello");
    expect(res.address).toBe(PUBLIC);
    expect(dialed).toContain(PUBLIC);
    await f.fetch("http://shop.example.ng/again");
    const pageRequests = server.requests.filter((r) => r.path !== "/robots.txt");
    expect(pageRequests.map((r) => r.headers.host)).toEqual(["shop.example.ng", "shop.example.ng"]);
    for (const r of server.requests) {
      expect(r.headers["user-agent"]).toBe(UA);
      expect(r.headers.cookie).toBeUndefined();
      expect(r.headers.authorization).toBeUndefined();
    }
  });

  it("refuses other schemes, credentials and non-standard ports before any connection", async () => {
    const { f, resolver } = fetcher();
    expect(await code(f.fetch("ftp://shop.example.ng/x"))).toBe("URL_NOT_ALLOWED");
    expect(await code(f.fetch("file:///etc/passwd"))).toBe("URL_NOT_ALLOWED");
    expect(await code(f.fetch("http://user:pass@shop.example.ng/"))).toBe("URL_NOT_ALLOWED");
    expect(await code(f.fetch("http://shop.example.ng:22/"))).toBe("URL_NOT_ALLOWED");
    expect(await code(f.fetch("http://shop.example.ng:6379/"))).toBe("URL_NOT_ALLOWED");
    expect(await code(f.fetch("not a url"))).toBe("INVALID_URL");
    expect(resolver.calls).toEqual([]);
    expect(server.requests).toEqual([]);
  });

  it("refuses internal host names without resolving them", async () => {
    const { f, resolver } = fetcher();
    for (const url of [
      "http://localhost/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://printer.local/",
      "http://intranet/",
    ]) {
      expect(await code(f.fetch(url)), url).toBe("URL_NOT_ALLOWED");
    }
    expect(resolver.calls).toEqual([]);
  });

  it("refuses private, loopback, metadata and IPv6-mapped literals, including encoded forms", async () => {
    const { f } = fetcher();
    for (const url of [
      "http://127.0.0.1/",
      "http://2130706433/", // decimal 127.0.0.1
      "http://0x7f.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1:8080/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://[64:ff9b::7f00:1]/",
    ]) {
      expect(await code(f.fetch(url)), url).toBe("ADDRESS_NOT_ALLOWED");
    }
    expect(server.requests).toEqual([]);
  });

  it("refuses a host when any resolved address is denied, including IPv6-mapped answers", async () => {
    const { f } = fetcher({
      "mixed.example.ng": [
        { address: PUBLIC, family: 4 },
        { address: "10.0.0.7", family: 4 },
      ],
      "mapped.example.ng": [{ address: "::ffff:127.0.0.1", family: 6 }],
      "v6local.example.ng": [{ address: "fd00::5", family: 6 }],
    });
    expect(await code(f.fetch("http://mixed.example.ng/"))).toBe("ADDRESS_NOT_ALLOWED");
    expect(await code(f.fetch("http://mapped.example.ng/"))).toBe("ADDRESS_NOT_ALLOWED");
    expect(await code(f.fetch("http://v6local.example.ng/"))).toBe("ADDRESS_NOT_ALLOWED");
    expect(server.requests).toEqual([]);
  });

  it("defeats DNS rebinding: a connection uses the address checked for it, and every new connection is checked again", async () => {
    let answers = 0;
    const { f, resolver, dialed } = fetcher({
      // Two public answers (page target, robots.txt), then the attacker flips the record to loopback.
      "rebind.example.ng": () =>
        answers++ < 2 ? [{ address: PUBLIC, family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
    });
    const first = await f.fetch("http://rebind.example.ng/");
    expect(first.status).toBe(200);
    // One lookup per connection; both connections went to the checked public address.
    expect(resolver.calls.filter((h) => h === "rebind.example.ng")).toHaveLength(2);
    expect(dialed).toEqual([PUBLIC, PUBLIC]);
    // The next connection resolves again, sees loopback and is refused.
    expect(await code(f.fetch("http://rebind.example.ng/again"))).toBe("ADDRESS_NOT_ALLOWED");
    expect(dialed).toEqual([PUBLIC, PUBLIC]);
    expect(server.requests.map((r) => r.path)).toEqual(["/robots.txt", "/"]);
  });

  it("reports a name that does not resolve as DNS_FAILED", async () => {
    const { f } = fetcher();
    expect(await code(f.fetch("http://nowhere.example.ng/"))).toBe("DNS_FAILED");
  });

  it("parses development host overrides and rejects malformed ones", () => {
    expect(
      parseHostOverrides("site.test=127.0.0.1:4299, other.test=[::1]:80").get("other.test"),
    ).toEqual({ address: "::1", port: 80 });
    expect(() => parseHostOverrides("site.test=localhost:80")).toThrow();
    expect(parseHostOverrides("").size).toBe(0);
  });
});

describe("SafeFetch: redirects", () => {
  it("follows same-site redirects and records each hop", async () => {
    const { f } = fetcher();
    const res = await f.fetch("http://shop.example.ng/redirect-ok");
    expect(res.status).toBe(200);
    expect(res.url).toBe("http://shop.example.ng/again");
    expect(res.redirects).toEqual([{ url: "http://shop.example.ng/redirect-ok", status: 302 }]);
  });

  it("re-validates every hop: internal names, private and metadata addresses, other schemes and ports", async () => {
    const { f } = fetcher();
    expect(await code(f.fetch("http://shop.example.ng/redirect-internal"))).toBe(
      "ADDRESS_NOT_ALLOWED",
    );
    expect(await code(f.fetch("http://shop.example.ng/redirect-literal"))).toBe(
      "ADDRESS_NOT_ALLOWED",
    );
    expect(await code(f.fetch("http://shop.example.ng/redirect-metadata"))).toBe(
      "ADDRESS_NOT_ALLOWED",
    );
    expect(await code(f.fetch("http://shop.example.ng/redirect-localhost"))).toBe(
      "URL_NOT_ALLOWED",
    );
    expect(await code(f.fetch("http://shop.example.ng/redirect-ftp"))).toBe("URL_NOT_ALLOWED");
    expect(await code(f.fetch("http://shop.example.ng/redirect-port"))).toBe("URL_NOT_ALLOWED");
  });

  it("stops after 5 redirects", async () => {
    const { f } = fetcher();
    expect(await code(f.fetch("http://shop.example.ng/loop"))).toBe("TOO_MANY_REDIRECTS");
    expect(server.requests.filter((r) => r.path === "/loop")).toHaveLength(6);
  });
});

describe("SafeFetch: size, time and content type", () => {
  it("aborts a streamed body past the size cap", async () => {
    const { f } = fetcher({}, { config: { maxBytes: 256 * 1024 } });
    expect(await code(f.fetch("http://shop.example.ng/big"))).toBe("TOO_LARGE");
  });

  it("refuses a declared length over the cap before reading it", async () => {
    const { f } = fetcher({}, { config: { maxBytes: 256 * 1024 } });
    expect(await code(f.fetch("http://shop.example.ng/big-declared"))).toBe("TOO_LARGE");
  });

  it("counts decompressed bytes, so a compression bomb is aborted", async () => {
    const { f } = fetcher({}, { config: { maxBytes: 256 * 1024 } });
    expect(await code(f.fetch("http://shop.example.ng/bomb"))).toBe("TOO_LARGE");
  });

  it("times out a server that never answers, and one that stalls mid-body", async () => {
    const { f } = fetcher({}, { config: { timeoutMs: 300 } });
    const started = Date.now();
    expect(await code(f.fetch("http://shop.example.ng/slow"))).toBe("TIMEOUT");
    expect(await code(f.fetch("http://shop.example.ng/drip"))).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reads only HTML, XHTML, plain text and JSON", async () => {
    const { f } = fetcher();
    expect(await code(f.fetch("http://shop.example.ng/image"))).toBe("CONTENT_TYPE_NOT_ALLOWED");
    expect(await code(f.fetch("http://shop.example.ng/no-type"))).toBe("CONTENT_TYPE_NOT_ALLOWED");
  });

  it("returns error statuses without their body", async () => {
    const { f } = fetcher();
    const res = await f.fetch("http://shop.example.ng/server-error");
    expect(res.status).toBe(500);
    expect(res.body).toBe("");
  });

  it("reports an invalid TLS certificate as TLS_INVALID", async () => {
    const { f } = fetcher();
    const err = await f.fetch("https://selfsigned.example.test/").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect((err as SafeFetchError).code).toBe("TLS_INVALID");
    expect((err as SafeFetchError).detail).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY/);
  });
});

describe("SafeFetch: robots.txt", () => {
  it("does not fetch disallowed pages, honoring the group for our product token", async () => {
    const { f } = fetcher();
    expect(await code(f.fetch("http://shop.example.ng/bot-only"))).toBe("ROBOTS_DISALLOWED");
    expect(server.requests.map((r) => r.path)).toEqual(["/robots.txt"]);
    // Our own group replaces the * group, so /private is allowed for LeadForgeBot.
    expect((await f.fetch("http://shop.example.ng/private")).status).toBe(200);
  });

  it("caches robots.txt per origin", async () => {
    const cache = new MemoryRobotsCache();
    const { f } = fetcher({}, { robotsCache: cache });
    await f.fetch("http://shop.example.ng/");
    await f.fetch("http://shop.example.ng/again");
    expect(server.requests.filter((r) => r.path === "/robots.txt")).toHaveLength(1);
    expect(cache.store.has("http://shop.example.ng")).toBe(true);
  });

  it("treats a missing robots.txt as allow all and a failing one as disallow all", async () => {
    const original = server.routes.get("/robots.txt")!;
    try {
      server.routes.set("/robots.txt", html("nope", 404));
      expect((await fetcher().f.fetch("http://shop.example.ng/private")).status).toBe(200);
      server.routes.set("/robots.txt", html("down", 503));
      expect(await code(fetcher().f.fetch("http://shop.example.ng/"))).toBe("ROBOTS_DISALLOWED");
    } finally {
      server.routes.set("/robots.txt", original);
    }
  });
});

describe("SafeFetch: rate limits", () => {
  it("applies a per-host and a global limit to every request, waiting for a token", async () => {
    const limiter = new RecordingLimiter([150]);
    const sleeps: number[] = [];
    const { f } = fetcher({}, { limiter, sleeps });
    await f.fetch("http://shop.example.ng/");
    expect(sleeps).toEqual([150]);
    expect(limiter.calls).toContain("safe-fetch:host:shop.example.ng");
    expect(limiter.calls).toContain("safe-fetch:global");
  });

  it("fails with RATE_LIMITED rather than waiting longer than allowed", async () => {
    const limiter = new RecordingLimiter([120_000]);
    const { f } = fetcher({}, { limiter, config: { maxRateWaitMs: 1_000 } });
    expect(await code(f.fetch("http://shop.example.ng/"))).toBe("RATE_LIMITED");
  });
});
