/*
 * Local stand-ins for the outside world, used only by the release end-to-end stack
 * (release-stack.mjs). Nothing here talks to a real third party.
 *
 * - startPaystackFixture(): the Paystack fixture server of the API tests
 *   (apps/api/test/paystack-fake.ts, hand-built payloads in Paystack's documented shapes) behind a
 *   small front on a fixed port. The front forwards the Paystack REST calls the API makes, remembers
 *   each checkout it initialized, and serves the e2e control routes under /__e2e/:
 *     GET  /__e2e/health
 *     GET  /__e2e/checkout/:accessCode           a test checkout page (the browser lands here
 *                                                instead of checkout.paystack.com)
 *     POST /__e2e/checkout/:accessCode/pay       marks the transaction successful at the fixture and
 *                                                redirects to the callback URL with ?trxref=&reference=
 *     POST /__e2e/checkout/:accessCode/pay-later marks it in progress ("ongoing", not final) and
 *                                                redirects the same way, so the return page has to wait
 *     POST /__e2e/checkout/:accessCode/decline   marks it failed and redirects the same way
 *     POST /__e2e/paystack/settle?reference=     marks an in-progress transaction successful
 *     POST /__e2e/paystack/webhook?reference=&times=n   sends the signed charge.success event n times
 *     GET  /__e2e/paystack/calls                 method and path of every call the API made
 *     POST /__e2e/faults/businesses              {"namePattern": "..."}: the e2e Mongo database
 *                                                rejects new businesses whose name matches (a real,
 *                                                transient write failure for the retry test)
 *     DELETE /__e2e/faults/businesses            removes it again
 *     POST /__e2e/maintenance/rollup-usage       queues the worker's usage rollup now instead of
 *                                                waiting for its 10-minute schedule
 * - startTestSite(): websites for analysis and enrichment, reached by the worker through
 *   SAFE_FETCH_HOST_OVERRIDES (development and test only; production refuses it).
 */
import { createServer, request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

/** Loads the API tests' Paystack fixture (TypeScript, run through Node's type stripping). */
async function loadPaystackFake(repo) {
  return import(pathToFileURL(join(repo, "apps", "api", "test", "paystack-fake.ts")).href);
}

export async function startPaystackFixture({
  repo,
  port,
  apiUrl,
  mongoUri,
  mongoDb,
  redisUrl,
  queuePrefix,
  log,
}) {
  const fakeModule = await loadPaystackFake(repo);
  const secret = fakeModule.FAKE_SECRET;
  const fake = await fakeModule.startFakePaystack(secret);
  /** access code -> { reference, callbackUrl, amount, currency, email } */
  const checkouts = new Map();
  let faultValidator = null;

  const { MongoClient } = createRequire(join(repo, "packages", "db-mongo", "package.json"))(
    "mongodb",
  );
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  let maintenance = null;
  function maintenanceQueue() {
    if (!maintenance) {
      const coreRequire = createRequire(join(repo, "packages", "core", "package.json"));
      const { Queue } = coreRequire("bullmq");
      const IORedis = coreRequire("ioredis");
      const connection = new (IORedis.default ?? IORedis)(redisUrl, { maxRetriesPerRequest: null });
      maintenance = {
        queue: new Queue("maintenance", { connection, prefix: queuePrefix }),
        connection,
      };
    }
    return maintenance.queue;
  }

  async function setBusinessesFault(pattern) {
    if (!mongoDb.endsWith("_e2e"))
      throw new Error(`Refusing to change validators outside an _e2e database (${mongoDb})`);
    await mongo.connect();
    const db = mongo.db(mongoDb);
    const [info] = await db.listCollections({ name: "businesses" }).toArray();
    const original = info?.options?.validator ?? {};
    if (!faultValidator) faultValidator = original;
    const validator = pattern
      ? { $and: [faultValidator, { "name.value": { $not: new RegExp(pattern) } }] }
      : faultValidator;
    await db.command({
      collMod: "businesses",
      validator,
      validationLevel: "moderate",
      validationAction: "error",
    });
    if (!pattern) faultValidator = null;
  }

  function forward(req, res, body) {
    const target = new URL(req.url, fake.url);
    const upstream = httpRequest(
      target,
      {
        method: req.method,
        headers: { ...req.headers, host: target.host, "content-length": body.length },
      },
      async (up) => {
        const out = await readBody(up);
        if (
          req.method === "POST" &&
          target.pathname === "/transaction/initialize" &&
          up.statusCode === 200
        ) {
          try {
            const sent = JSON.parse(body.toString("utf8"));
            const data = JSON.parse(out.toString("utf8")).data;
            checkouts.set(data.access_code, {
              reference: data.reference,
              callbackUrl: sent.callback_url,
              amount: Number(sent.amount),
              currency: sent.currency ?? "NGN",
              email: sent.email,
            });
          } catch (err) {
            log(`paystack fixture: could not record a checkout: ${err}`);
          }
        }
        res.writeHead(up.statusCode ?? 502, {
          "content-type": up.headers["content-type"] ?? "application/json",
          "content-length": out.length,
        });
        res.end(out);
      },
    );
    upstream.on("error", (err) =>
      sendJson(res, 502, { status: false, message: `Fixture proxy: ${err.message}` }),
    );
    upstream.end(body);
  }

  function settle(code, status) {
    const checkout = checkouts.get(code);
    if (!checkout) return null;
    const previous = fake.transactions.get(checkout.reference) ?? {};
    fake.transactions.set(checkout.reference, {
      ...previous,
      ...fakeModule.transactionData({
        reference: checkout.reference,
        amount: checkout.amount,
        currency: checkout.currency,
        status,
        email: checkout.email,
      }),
      id: previous.id ?? Math.floor(Math.random() * 1e9),
      ...(status === "failed" ? { paid_at: null, gateway_response: "Declined" } : {}),
      ...(status === "ongoing" ? { paid_at: null, gateway_response: "Transaction ongoing" } : {}),
    });
    const back = new URL(checkout.callbackUrl);
    back.searchParams.set("trxref", checkout.reference);
    back.searchParams.set("reference", checkout.reference);
    return back.toString();
  }

  async function sendWebhook(reference, times) {
    const data = fake.transactions.get(reference);
    if (!data) return { sent: 0, statuses: [], error: "unknown reference" };
    const body = fakeModule.webhookBody(
      data.status === "success" ? "charge.success" : "charge.failed",
      data,
    );
    const signature = fakeModule.sign(body, secret);
    const statuses = [];
    for (let i = 0; i < times; i++) {
      const res = await fetch(`${apiUrl}/api/v1/webhooks/paystack`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-paystack-signature": signature },
        body,
      });
      statuses.push(res.status);
    }
    return { sent: times, statuses };
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://fixture");
      const body = await readBody(req);
      if (!url.pathname.startsWith("/__e2e/")) return forward(req, res, body);

      if (url.pathname === "/__e2e/health")
        return sendJson(res, 200, { ok: true, paystack: fake.url });
      if (url.pathname === "/__e2e/paystack/calls") {
        return sendJson(
          res,
          200,
          fake.requests.map((r) => ({ method: r.method, path: r.path })),
        );
      }
      const page = /^\/__e2e\/checkout\/([A-Za-z0-9]+)$/.exec(url.pathname);
      if (req.method === "GET" && page) {
        const checkout = checkouts.get(page[1]);
        if (!checkout) return sendJson(res, 404, { error: "Unknown checkout" });
        const amount = (checkout.amount / 100).toLocaleString("en-NG", {
          minimumFractionDigits: 2,
        });
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paystack test checkout (fixture)</title>
<style>body{font:14px system-ui,sans-serif;margin:0;padding:24px;max-width:420px}button{font:inherit;padding:10px 16px;margin:8px 8px 0 0}</style></head>
<body><h1>Paystack test checkout (fixture)</h1>
<p>Local stand-in used by the LeadForge release tests. No money moves.</p>
<p data-testid="fixture-amount">${escapeHtml(checkout.currency)} ${escapeHtml(amount)}</p>
<p data-testid="fixture-reference">${escapeHtml(checkout.reference)}</p>
<form method="post" action="/__e2e/checkout/${escapeHtml(page[1])}/pay"><button type="submit">Pay (test)</button></form>
<form method="post" action="/__e2e/checkout/${escapeHtml(page[1])}/pay-later"><button type="submit">Pay, confirm later (test)</button></form>
<form method="post" action="/__e2e/checkout/${escapeHtml(page[1])}/decline"><button type="submit">Decline (test)</button></form>
</body></html>`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      const act = /^\/__e2e\/checkout\/([A-Za-z0-9]+)\/(pay|pay-later|decline)$/.exec(url.pathname);
      if (req.method === "POST" && act) {
        const back = settle(
          act[1],
          { pay: "success", "pay-later": "ongoing", decline: "failed" }[act[2]],
        );
        if (!back) return sendJson(res, 404, { error: "Unknown checkout" });
        res.writeHead(303, { location: back });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/__e2e/paystack/settle") {
        const reference = url.searchParams.get("reference") ?? "";
        const previous = fake.transactions.get(reference);
        if (!previous) return sendJson(res, 404, { error: "Unknown reference" });
        fake.transactions.set(reference, {
          ...previous,
          status: "success",
          paid_at: new Date().toISOString(),
          gateway_response: "Successful",
        });
        return sendJson(res, 200, { reference, status: "success" });
      }
      if (req.method === "POST" && url.pathname === "/__e2e/paystack/webhook") {
        const reference = url.searchParams.get("reference") ?? "";
        const times = Math.min(10, Math.max(1, Number(url.searchParams.get("times") ?? 1)));
        return sendJson(res, 200, await sendWebhook(reference, times));
      }
      if (url.pathname === "/__e2e/faults/businesses") {
        if (req.method === "POST") {
          const { namePattern } = JSON.parse(body.toString("utf8") || "{}");
          if (typeof namePattern !== "string" || namePattern.length < 3)
            return sendJson(res, 400, { error: "namePattern is required" });
          await setBusinessesFault(namePattern);
          return sendJson(res, 200, { fault: namePattern });
        }
        if (req.method === "DELETE") {
          await setBusinessesFault(null);
          return sendJson(res, 200, { fault: null });
        }
      }
      if (req.method === "POST" && url.pathname === "/__e2e/maintenance/rollup-usage") {
        const job = await maintenanceQueue().add(
          "rollup-usage",
          { days: 2 },
          { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
        );
        return sendJson(res, 200, { queued: job.id });
      }
      return sendJson(res, 404, { error: `No fixture route ${req.method} ${url.pathname}` });
    })().catch((err) => sendJson(res, 500, { error: String(err) }));
  });
  await listen(server, port, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}`,
    secret,
    async close() {
      if (faultValidator) await setBusinessesFault(null).catch(() => {});
      await mongo.close().catch(() => {});
      if (maintenance) {
        await maintenance.queue.close().catch(() => {});
        maintenance.connection.disconnect();
      }
      await new Promise((resolve) => server.close(() => resolve()));
      await fake.close();
    },
  };
}

/** Host names the test site answers for; the stack maps each to it with SAFE_FETCH_HOST_OVERRIDES. */
export const TEST_SITE_HOSTS = ["kitchen.lf-e2e.test", "clinic.lf-e2e.test"];
/** Phone numbers on the test sites: Ofcom drama numbers, reserved for fiction. */
export const TEST_SITE_PHONES = {
  "kitchen.lf-e2e.test": "+442079460555",
  "clinic.lf-e2e.test": "+442079460556",
};

function sitePage(host, path) {
  const phone = TEST_SITE_PHONES[host];
  const national = `+44 20 7946 ${phone.slice(-4)}`;
  if (path === "/robots.txt") return { type: "text/plain", body: "User-agent: *\nAllow: /\n" };
  if (host === "kitchen.lf-e2e.test") {
    // An old WordPress site: a generator tag and an old jQuery, a table layout, no viewport tag,
    // no contact form (a newsletter form only), a phone link, no WhatsApp link. The generator
    // value carries markup that would run if evidence were ever rendered as HTML.
    if (path === "/") {
      return {
        type: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>E2E Kitchen (Sample)</title>
<meta name="generator" content="WordPress 4.9.8 &lt;img src=x onerror=window.__lfInjected=1&gt;">
<script src="/wp-includes/js/jquery/jquery.js?ver=1.12.4"></script></head>
<body><table width="1024"><tr><td>
<h1>E2E Kitchen (Sample)</h1>
<p>Home-cooked meals in Ikeja. Call us on <a href="tel:${phone}">${national}</a>.</p>
<form action="/newsletter"><input type="email" name="email"><img src=x onerror="window.__lfInjected=1"></form>
<p><a href="/contact">Contact</a> <a href="/about">About</a></p>
<p><a href="https://instagram.com/e2ekitchen.sample">Instagram</a></p>
</td></tr></table></body></html>`,
      };
    }
    if (path === "/contact") {
      return {
        type: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>Contact E2E Kitchen (Sample)</title></head>
<body><h1>Contact</h1><p>Email <a href="mailto:hello@${host}">hello@${host}</a></p><p>Phone: ${national}</p></body></html>`,
      };
    }
    if (path === "/about") {
      return {
        type: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>About (Sample)</title></head><body><p>Family business since 2010.</p></body></html>`,
      };
    }
    return null;
  }
  // A modern site: viewport tag, a contact form and a WhatsApp link.
  if (path === "/") {
    return {
      type: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>E2E Clinic (Sample)</title></head><body><main><h1>E2E Clinic (Sample)</h1>
<p>Call <a href="tel:${phone}">${national}</a> or <a href="https://wa.me/${phone.slice(1)}">chat on WhatsApp</a>.</p>
<form action="/contact" method="post"><label>Name <input name="name"></label><label>Message <textarea name="message"></textarea></label><button>Send</button></form>
</main></body></html>`,
    };
  }
  return null;
}

export async function startTestSite({ port }) {
  const server = createServer((req, res) => {
    const host = String(req.headers.host ?? "")
      .split(":")[0]
      .toLowerCase();
    const path = (req.url ?? "/").split("?")[0] || "/";
    const page = TEST_SITE_HOSTS.includes(host) ? sitePage(host, path) : null;
    if (!page) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "content-type": page.type });
    res.end(page.body);
  });
  await listen(server, port, "127.0.0.1");
  return {
    overrides: TEST_SITE_HOSTS.map((h) => `${h}=127.0.0.1:${port}`).join(","),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
