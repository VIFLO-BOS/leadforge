import { isIP } from "node:net";

/**
 * SSRF address policy (docs/SECURITY_AND_DATA_COLLECTION.md section 5). Every address a
 * hostname resolves to, and every IP literal, is checked here before a connection is made.
 * IPv6 forms that embed an IPv4 address (IPv4-mapped, IPv4-compatible, NAT64, 6to4, Teredo)
 * are unwrapped and the IPv4 address is checked against the IPv4 list as well.
 */

interface V4Range {
  base: number;
  bits: number;
  label: string;
}
interface V6Range {
  base: bigint;
  bits: number;
  label: string;
}

function v4(cidr: string, label: string): V4Range {
  const [addr, bits] = cidr.split("/") as [string, string];
  return { base: parseIPv4(addr)!, bits: Number(bits), label };
}
function v6(cidr: string, label: string): V6Range {
  const [addr, bits] = cidr.split("/") as [string, string];
  return { base: parseIPv6(addr)!, bits: Number(bits), label };
}

/** Denied IPv4 ranges: private, loopback, link-local (cloud metadata), CGNAT, multicast, reserved, documentation. */
export const DENIED_IPV4: readonly V4Range[] = [
  v4("0.0.0.0/8", "this network"),
  v4("10.0.0.0/8", "private"),
  v4("100.64.0.0/10", "carrier-grade NAT"),
  v4("127.0.0.0/8", "loopback"),
  v4("169.254.0.0/16", "link-local (cloud metadata)"),
  v4("172.16.0.0/12", "private"),
  v4("192.0.0.0/24", "IETF protocol assignments"),
  v4("192.0.2.0/24", "documentation"),
  v4("192.88.99.0/24", "6to4 relay anycast"),
  v4("192.168.0.0/16", "private"),
  v4("198.18.0.0/15", "benchmarking"),
  v4("198.51.100.0/24", "documentation"),
  v4("203.0.113.0/24", "documentation"),
  v4("224.0.0.0/4", "multicast"),
  v4("240.0.0.0/4", "reserved"),
  v4("255.255.255.255/32", "broadcast"),
];

/** Denied IPv6 ranges. Embedded-IPv4 prefixes are handled separately (the IPv4 part is re-checked). */
export const DENIED_IPV6: readonly V6Range[] = [
  v6("::/128", "unspecified"),
  v6("::1/128", "loopback"),
  v6("64:ff9b::/96", "NAT64"),
  v6("64:ff9b:1::/48", "local-use NAT64"),
  v6("100::/64", "discard"),
  v6("2001::/32", "Teredo"),
  v6("2001:db8::/32", "documentation"),
  v6("2002::/16", "6to4"),
  v6("fc00::/7", "unique local"),
  v6("fe80::/10", "link-local"),
  v6("fec0::/10", "site-local"),
  v6("ff00::/8", "multicast"),
];

export interface AddressVerdict {
  allowed: boolean;
  /** Why it was denied ("loopback", "private", "IPv4-mapped loopback", ...). */
  reason: string | null;
  family: 4 | 6 | null;
}

/** Dotted-quad IPv4 to an unsigned 32-bit number; null when malformed. */
export function parseIPv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** IPv6 (any textual form, including a trailing dotted IPv4 and a zone id) to a 128-bit bigint. */
export function parseIPv6(address: string): bigint | null {
  let text = address.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (isIP(text) !== 6) return null;

  // A trailing dotted IPv4 becomes two hextets.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4value = parseIPv4(tail);
    if (v4value === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4value >>> 16).toString(16)}:${(v4value & 0xffff).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function inV4(value: number, range: V4Range): boolean {
  if (range.bits === 0) return true;
  const shift = 32 - range.bits;
  return Math.floor(value / 2 ** shift) === Math.floor(range.base / 2 ** shift);
}

function inV6(value: bigint, range: V6Range): boolean {
  const shift = BigInt(128 - range.bits);
  return value >> shift === range.base >> shift;
}

function checkV4(value: number): string | null {
  for (const range of DENIED_IPV4) if (inV4(value, range)) return range.label;
  return null;
}

function formatV4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** The IPv4 address embedded in an IPv6 address, with the embedding kind; null when none. */
export function embeddedIPv4(value: bigint): { kind: string; v4: number } | null {
  const low32 = Number(value & 0xffffffffn);
  if (value >> 32n === 0xffffn) return { kind: "IPv4-mapped", v4: low32 };
  // ::ffff:0:a.b.c.d (IPv4-translated, RFC 2765).
  if (value >> 32n === 0xffff0000n) return { kind: "IPv4-translated", v4: low32 };
  // ::a.b.c.d (deprecated IPv4-compatible); :: and ::1 are handled by the IPv6 list.
  if (value >> 32n === 0n && value > 1n) return { kind: "IPv4-compatible", v4: low32 };
  // NAT64 well-known prefix 64:ff9b::/96.
  if (value >> 32n === 0x0064ff9b0000000000000000n) return { kind: "NAT64", v4: low32 };
  // 6to4 2002:AABB:CCDD::/48.
  if (value >> 112n === 0x2002n) return { kind: "6to4", v4: Number((value >> 80n) & 0xffffffffn) };
  // Teredo 2001:0::/32: client IPv4 is the last 32 bits inverted.
  if (value >> 96n === 0x20010000n)
    return { kind: "Teredo", v4: Number(~value & 0xffffffffn) >>> 0 };
  return null;
}

/**
 * Decides whether a connection to `address` is allowed. Embedded IPv4 addresses are checked
 * first so the reason names the real target ("IPv4-mapped loopback 127.0.0.1").
 */
export function checkAddress(address: string): AddressVerdict {
  const family = isIP(address.replace(/^\[|\]$/g, "").replace(/%.*$/, ""));
  if (family === 4) {
    const value = parseIPv4(address);
    if (value === null) return { allowed: false, reason: "malformed IPv4 address", family: 4 };
    const reason = checkV4(value);
    return { allowed: reason === null, reason, family: 4 };
  }
  if (family === 6) {
    const value = parseIPv6(address);
    if (value === null) return { allowed: false, reason: "malformed IPv6 address", family: 6 };
    const embedded = embeddedIPv4(value);
    if (embedded) {
      const inner = checkV4(embedded.v4);
      if (inner)
        return {
          allowed: false,
          reason: `${embedded.kind} ${inner} ${formatV4(embedded.v4)}`,
          family: 6,
        };
    }
    for (const range of DENIED_IPV6)
      if (inV6(value, range)) return { allowed: false, reason: range.label, family: 6 };
    if (embedded && embedded.kind !== "6to4" && embedded.kind !== "Teredo") {
      // Mapped, translated and compatible forms are never public destinations of their own.
      return { allowed: false, reason: `${embedded.kind} address`, family: 6 };
    }
    return { allowed: true, reason: null, family: 6 };
  }
  return { allowed: false, reason: "not an IP address", family: null };
}

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".intranet",
  ".corp",
];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "kubernetes.default",
]);

/**
 * Hostnames refused before any DNS lookup: localhost, cloud metadata names, internal
 * suffixes and single-label names (which resolve through search domains on internal networks).
 */
export function checkHostname(hostname: string): { allowed: boolean; reason: string | null } {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { allowed: false, reason: "empty host" };
  if (BLOCKED_HOSTS.has(host)) return { allowed: false, reason: `internal host name ${host}` };
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)))
    return { allowed: false, reason: `internal host name ${host}` };
  if (!host.includes(".") && isIP(host) === 0)
    return { allowed: false, reason: "single-label host names are not fetched" };
  return { allowed: true, reason: null };
}
