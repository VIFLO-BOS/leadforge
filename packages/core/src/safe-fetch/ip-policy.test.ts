import { describe, expect, it } from "vitest";
import { checkAddress, checkHostname, embeddedIPv4, parseIPv6 } from "./ip-policy.js";

describe("SSRF address deny list", () => {
  it("denies every private, loopback, link-local, CGNAT, multicast and reserved IPv4 range", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "100.127.255.254",
      "127.0.0.1",
      "127.255.255.254",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.8",
      "192.0.2.10",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(checkAddress(ip).allowed, ip).toBe(false);
    }
  });

  it("allows public IPv4 addresses next to the denied ranges", () => {
    for (const ip of [
      "8.8.8.8",
      "100.63.255.255",
      "100.128.0.1",
      "172.15.255.255",
      "172.32.0.1",
      "192.167.255.255",
      "198.17.255.255",
      "1.1.1.1",
    ]) {
      expect(checkAddress(ip).allowed, ip).toBe(true);
    }
  });

  it("denies IPv6 loopback, unspecified, unique-local, link-local, multicast and documentation ranges", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "fe80::1%eth0",
      "ff02::1",
      "2001:db8::1",
      "fec0::1",
      "[::1]",
    ]) {
      expect(checkAddress(ip).allowed, ip).toBe(false);
    }
    expect(checkAddress("2606:4700:4700::1111").allowed).toBe(true);
  });

  it("unwraps IPv4-mapped, translated and compatible IPv6 forms and re-checks the IPv4 address", () => {
    const mapped = checkAddress("::ffff:127.0.0.1");
    expect(mapped.allowed).toBe(false);
    expect(mapped.reason).toMatch(/IPv4-mapped loopback 127\.0\.0\.1/);
    expect(checkAddress("::ffff:7f00:1").allowed).toBe(false); // hex form of 127.0.0.1
    expect(checkAddress("::ffff:a9fe:a9fe").reason).toMatch(/169\.254\.169\.254/);
    expect(checkAddress("::ffff:10.0.0.1").allowed).toBe(false);
    expect(checkAddress("0:0:0:0:0:ffff:192.168.0.1").allowed).toBe(false);
    expect(checkAddress("::ffff:0:127.0.0.1").allowed).toBe(false); // IPv4-translated
    expect(checkAddress("::127.0.0.1").allowed).toBe(false); // IPv4-compatible
    // Even a public IPv4 is not reached through a mapped form.
    expect(checkAddress("::ffff:8.8.8.8").allowed).toBe(false);
  });

  it("denies NAT64, 6to4 and Teredo prefixes that can reach internal IPv4 addresses", () => {
    expect(checkAddress("64:ff9b::7f00:1").allowed).toBe(false);
    expect(checkAddress("64:ff9b::808:808").allowed).toBe(false);
    expect(checkAddress("2002:7f00:0001::1").reason).toMatch(/6to4 loopback 127\.0\.0\.1/);
    expect(checkAddress("2001:0:4136:e378:8000:63bf:3fff:fdd2").allowed).toBe(false);
    expect(embeddedIPv4(parseIPv6("2002:c0a8:0101::")!)).toMatchObject({ kind: "6to4" });
  });

  it("rejects malformed input instead of guessing", () => {
    expect(checkAddress("not-an-ip").allowed).toBe(false);
    expect(checkAddress("999.1.1.1").allowed).toBe(false);
    expect(parseIPv6("1::2::3")).toBeNull();
  });
});

describe("host name policy", () => {
  it("refuses localhost, metadata and internal names before any DNS lookup", () => {
    for (const host of [
      "localhost",
      "LOCALHOST.",
      "api.localhost",
      "metadata.google.internal",
      "db.internal",
      "printer.local",
      "router.lan",
      "nas.home.arpa",
      "intranet",
    ]) {
      expect(checkHostname(host).allowed, host).toBe(false);
    }
    expect(checkHostname("acme.example.ng").allowed).toBe(true);
  });
});
