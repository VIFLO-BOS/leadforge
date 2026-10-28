/**
 * A local stand-in for the Paystack REST API, for tests only (PAYSTACK_BASE_URL points at it;
 * the environment schema refuses another origin in production). Responses are HAND-BUILT
 * FIXTURES following the documented Paystack payload shapes (envelope `{ status, message, data }`,
 * amounts in subunits, `customer_code`, `plan_code`, `subscription_code`, `email_token`,
 * `authorization` with masked card fields); they are not recordings of live traffic. No test
 * ever calls Paystack.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** Fixture payloads and request bodies, asserted field by field in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export const FAKE_SECRET = "sk_test_fixture0123456789abcdef";
export const OTHER_SECRET = "sk_test_someoneelse0123456789ab";

export interface FakeRequest {
  method: string;
  path: string;
  body: Json | null;
  authorization: string | undefined;
}

export interface FakePaystack {
  url: string;
  requests: FakeRequest[];
  /** Verify responses by reference (the `data` object). Absent: Paystack's "reference not found". */
  transactions: Map<string, Json>;
  subscriptions: Map<string, Json>;
  /** Next N calls to a path prefix answer HTTP 500. */
  failNext(pathPrefix: string, times?: number): void;
  close(): Promise<void>;
}

/** Hand-built Paystack transaction object (verify data and charge.success data share it). */
export function transactionData(input: {
  reference: string;
  amount: number;
  currency?: string;
  status?: string;
  customerCode?: string | null;
  email?: string;
  planCode?: string | null;
  id?: number;
  paidAt?: string;
  domain?: "test" | "live";
}): Json {
  return {
    id: input.id ?? Math.floor(Math.random() * 1e9),
    domain: input.domain ?? "test",
    status: input.status ?? "success",
    reference: input.reference,
    amount: input.amount,
    message: null,
    gateway_response: input.status === "failed" ? "Declined" : "Successful",
    paid_at:
      input.status === "success" || input.status === undefined
        ? (input.paidAt ?? new Date().toISOString())
        : null,
    created_at: new Date().toISOString(),
    channel: "card",
    currency: input.currency ?? "NGN",
    ip_address: "203.0.113.10",
    metadata: "",
    fees: 1500,
    customer: {
      id: 42,
      first_name: null,
      last_name: null,
      email: input.email ?? "billing@example.test",
      customer_code: input.customerCode ?? "CUS_fixture",
      phone: null,
      metadata: null,
      risk_action: "default",
    },
    authorization: {
      authorization_code: "AUTH_must_never_be_stored",
      bin: "408408",
      last4: "4081",
      exp_month: "12",
      exp_year: "2030",
      channel: "card",
      card_type: "visa ",
      bank: "TEST BANK",
      country_code: "NG",
      brand: "visa",
      reusable: true,
      signature: "SIG_must_never_be_stored",
      account_name: null,
    },
    plan: input.planCode
      ? {
          id: 7,
          name: "Fixture plan",
          plan_code: input.planCode,
          interval: "monthly",
          amount: input.amount,
          currency: input.currency ?? "NGN",
        }
      : null,
    requested_amount: input.amount,
  };
}

export function webhookBody(event: string, data: Json): Buffer {
  return Buffer.from(JSON.stringify({ event, data }), "utf8");
}

export function sign(body: Buffer, secret: string = FAKE_SECRET): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

function send(res: ServerResponse, status: number, payload: Json): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<Json | null> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
  } catch {
    return null;
  }
}

export async function startFakePaystack(secret: string = FAKE_SECRET): Promise<FakePaystack> {
  const requests: FakeRequest[] = [];
  const transactions = new Map<string, Json>();
  const subscriptions = new Map<string, Json>();
  const failures = new Map<string, number>();
  let planSeq = 0;
  let refundSeq = 1000;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const path = url.pathname;
      const body = await readJson(req);
      requests.push({
        method: req.method ?? "GET",
        path,
        body,
        authorization: req.headers.authorization,
      });
      if (req.headers.authorization !== `Bearer ${secret}`)
        return send(res, 401, { status: false, message: "Invalid key" });
      for (const [prefix, n] of failures) {
        if (path.startsWith(prefix) && n > 0) {
          failures.set(prefix, n - 1);
          return send(res, 500, { status: false, message: "Fixture: internal error" });
        }
      }
      if (req.method === "POST" && path === "/customer") {
        const email = String(body?.email ?? "");
        const code = `CUS_${createHmac("sha256", "fixture").update(email).digest("hex").slice(0, 12)}`;
        return send(res, 200, {
          status: true,
          message: "Customer created",
          data: { id: 42, email, customer_code: code, integration: 1 },
        });
      }
      if (req.method === "POST" && path === "/plan") {
        planSeq++;
        return send(res, 200, {
          status: true,
          message: "Plan created",
          data: {
            name: body?.name,
            interval: body?.interval,
            amount: Number(body?.amount),
            plan_code: `PLN_fixture${planSeq}`,
            currency: body?.currency,
            id: planSeq,
          },
        });
      }
      if (req.method === "POST" && path === "/transaction/initialize") {
        const reference = String(body?.reference ?? `T${randomBytes(6).toString("hex")}`);
        const access = randomBytes(8).toString("hex");
        if (!transactions.has(reference)) {
          transactions.set(reference, {
            ...transactionData({
              reference,
              amount: Number(body?.amount),
              currency: String(body?.currency ?? "NGN"),
              status: "abandoned",
              email: String(body?.email ?? ""),
            }),
            paid_at: null,
            gateway_response: "The transaction was not completed",
          });
        }
        return send(res, 200, {
          status: true,
          message: "Authorization URL created",
          data: {
            authorization_url: `https://checkout.paystack.com/${access}`,
            access_code: access,
            reference,
          },
        });
      }
      const verify = /^\/transaction\/verify\/(.+)$/.exec(path);
      if (req.method === "GET" && verify) {
        const data = transactions.get(decodeURIComponent(verify[1]!));
        if (!data)
          return send(res, 400, { status: false, message: "Transaction reference not found" });
        return send(res, 200, { status: true, message: "Verification successful", data });
      }
      if (
        req.method === "POST" &&
        (path === "/subscription/disable" || path === "/subscription/enable")
      ) {
        const sub = subscriptions.get(String(body?.code));
        if (sub) sub.status = path.endsWith("disable") ? "non-renewing" : "active";
        return send(res, 200, {
          status: true,
          message: path.endsWith("disable")
            ? "Subscription disabled successfully"
            : "Subscription enabled successfully",
        });
      }
      const manage = /^\/subscription\/([^/]+)\/manage\/link$/.exec(path);
      if (req.method === "GET" && manage) {
        return send(res, 200, {
          status: true,
          message: "Link generated",
          data: {
            link: `https://paystack.com/manage/subscriptions/${manage[1]}?subscription_token=fixture`,
          },
        });
      }
      const fetchSub = /^\/subscription\/([^/]+)$/.exec(path);
      if (req.method === "GET" && fetchSub) {
        const sub = subscriptions.get(decodeURIComponent(fetchSub[1]!));
        if (!sub) return send(res, 404, { status: false, message: "Subscription not found" });
        return send(res, 200, { status: true, message: "Subscription retrieved", data: sub });
      }
      if (req.method === "POST" && path === "/refund") {
        refundSeq++;
        return send(res, 200, {
          status: true,
          message: "Refund has been queued for processing",
          data: {
            id: refundSeq,
            integration: 1,
            domain: "test",
            currency: body?.currency ?? "NGN",
            amount: Number(body?.amount),
            status: "pending",
            transaction: { reference: body?.transaction },
            merchant_note: body?.merchant_note ?? null,
          },
        });
      }
      return send(res, 404, {
        status: false,
        message: `Fixture has no route ${req.method} ${path}`,
      });
    })().catch((err: unknown) => send(res, 500, { status: false, message: String(err) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    transactions,
    subscriptions,
    failNext(prefix, times = 1) {
      failures.set(prefix, times);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Env for a harness whose billing talks to the fake server. */
export function billingEnv(
  fake: FakePaystack,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { PAYSTACK_SECRET_KEY: FAKE_SECRET, PAYSTACK_BASE_URL: fake.url, ...extra };
}
