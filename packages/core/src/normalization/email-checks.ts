import { isDisposableDomain } from "./disposable.js";
import { normalizeEmail } from "./email.js";

/**
 * Release 1 email checks (PRODUCT_REQUIREMENTS section 5): syntax, then an MX lookup, then a
 * disposable-domain check. No SMTP recipient probing happens, so an address can never become
 * `verified`; each check is recorded as a verification event and the address stays
 * `unverified` ("Mailbox not confirmed").
 */

export type EmailCheckOutcome =
  "mx_found" | "no_mx" | "disposable" | "invalid_syntax" | "dns_error";

export interface EmailCheckStep {
  method: "email_syntax" | "email_mx" | "email_disposable";
  result: "passed" | "failed" | "inconclusive";
  details: string;
}

export interface EmailCheckReport {
  address: string;
  domain: string | null;
  outcome: EmailCheckOutcome;
  steps: EmailCheckStep[];
  mxHosts: string[];
}

export interface MxResolver {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
}

const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export async function checkEmail(raw: string, resolver: MxResolver): Promise<EmailCheckReport> {
  const parsed = normalizeEmail(raw);
  if (!parsed.ok) {
    return {
      address: raw.trim().toLowerCase(),
      domain: null,
      outcome: "invalid_syntax",
      steps: [{ method: "email_syntax", result: "failed", details: parsed.reason }],
      mxHosts: [],
    };
  }
  const steps: EmailCheckStep[] = [
    { method: "email_syntax", result: "passed", details: "Address syntax is valid" },
  ];
  let mxHosts: string[] = [];
  let mxOutcome: "found" | "none" | "error";
  try {
    const records = await resolver.resolveMx(parsed.domain);
    // A null MX ("." per RFC 7505) means the domain accepts no mail.
    mxHosts = records
      .filter((r) => r.exchange && r.exchange !== ".")
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange.toLowerCase())
      .slice(0, 5);
    mxOutcome = mxHosts.length > 0 ? "found" : "none";
    steps.push(
      mxOutcome === "found"
        ? {
            method: "email_mx",
            result: "passed",
            details: `Mail servers found for ${parsed.domain}: ${mxHosts.join(", ")}`,
          }
        : {
            method: "email_mx",
            result: "failed",
            details: `${parsed.domain} publishes no mail server (MX)`,
          },
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? "DNS_ERROR";
    if (NO_RECORD_CODES.has(code)) {
      mxOutcome = "none";
      steps.push({
        method: "email_mx",
        result: "failed",
        details: `No mail server (MX) found for ${parsed.domain} (${code})`,
      });
    } else {
      mxOutcome = "error";
      steps.push({
        method: "email_mx",
        result: "inconclusive",
        details: `MX lookup for ${parsed.domain} could not complete (${code})`,
      });
    }
  }
  const disposable = isDisposableDomain(parsed.domain);
  steps.push(
    disposable
      ? {
          method: "email_disposable",
          result: "failed",
          details: `${parsed.domain} is a known disposable email provider`,
        }
      : {
          method: "email_disposable",
          result: "passed",
          details: `${parsed.domain} is not on the disposable-domain list`,
        },
  );
  const outcome: EmailCheckOutcome = disposable
    ? "disposable"
    : mxOutcome === "found"
      ? "mx_found"
      : mxOutcome === "none"
        ? "no_mx"
        : "dns_error";
  return { address: parsed.address, domain: parsed.domain, outcome, steps, mxHosts };
}
