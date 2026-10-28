/**
 * Development only: `pnpm billing:webhook:replay <event.json> [webhook-url]` signs a Paystack
 * webhook body with PAYSTACK_SECRET_KEY (HMAC-SHA512 over the exact bytes of the file, like
 * Paystack does) and POSTs it to the local API (default <API_URL>/api/v1/webhooks/paystack).
 * Use it to replay a payload captured from the Paystack dashboard, or a hand-built one, against a
 * local stack. The API still verifies every charge with Paystack before granting anything, so a
 * replayed charge.success only settles a transaction Paystack itself reports as successful.
 * Refuses production and live keys.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to replay webhooks in production");
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!key)
    throw new Error("PAYSTACK_SECRET_KEY is not set; the API would refuse the webhook anyway");
  if (!key.startsWith("sk_test_"))
    throw new Error("Replays are for Paystack test keys (sk_test_...) only");
  const file = process.argv[2];
  if (!file) throw new Error("Usage: paystack-webhook-replay <event.json> [webhook-url]");
  const body = readFileSync(file);
  JSON.parse(body.toString("utf8"));
  const apiUrl = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const url = process.argv[3] ?? `${apiUrl}/api/v1/webhooks/paystack`;
  const signature = createHmac("sha512", key).update(body).digest("hex");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body,
  });
  process.stdout.write(`POST ${url} -> ${res.status}\n${await res.text()}\n`);
  if (!res.ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
