import { describe, expect, it } from "vitest";
import {
  canonicalizeWebsite,
  cleanText,
  csvCell,
  csvLine,
  formatLocation,
  isBlankOrPlaceholder,
  looksLikeFormula,
  neutralizeCell,
  nigerianState,
  normalizeBusinessName,
  normalizeEmail,
  normalizeRegion,
  parseCountry,
  parsePhone,
  regionKey,
  searchWords,
  slugify,
  splitMultiValue,
  titleCaseIfUniform,
} from "./index.js";

describe("phone normalization", () => {
  it("parses Nigerian numbers in common local formats with NG as the default", () => {
    for (const raw of [
      "0803 123 4567",
      "08031234567",
      "+234 803 123 4567",
      "2348031234567",
      "(0803) 123-4567",
    ]) {
      const r = parsePhone(raw, "NG");
      expect(r.ok, raw).toBe(true);
      if (r.ok) {
        expect(r.phone.e164).toBe("+2348031234567");
        expect(r.phone.country).toBe("NG");
        expect(r.phone.type).toBe("mobile");
      }
    }
  });

  it("parses Lagos landlines (0201 numbering) as fixed lines", () => {
    const r = parsePhone("0201 234 5678", "NG");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.phone.e164).toBe("+2342012345678");
      expect(r.phone.type).toBe("fixed_line");
    }
  });

  it("keeps a number's own country when it has a country code (not everything is Nigerian)", () => {
    const uk = parsePhone("+44 20 7946 0958", "NG");
    expect(uk.ok).toBe(true);
    if (uk.ok) {
      expect(uk.phone.country).toBe("GB");
      expect(uk.phone.e164).toBe("+442079460958");
    }
    const gh = parsePhone("024 412 3456", "GH");
    expect(gh.ok).toBe(true);
    if (gh.ok) expect(gh.phone.e164).toBe("+233244123456");
  });

  it("honors the 00 international prefix", () => {
    const r = parsePhone("00 44 20 7946 0958", "NG");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.phone.e164).toBe("+442079460958");
  });

  it("rejects invalid numbers, letters and junk", () => {
    expect(parsePhone("12345", "NG").ok).toBe(false);
    expect(parsePhone("0803 123", "NG").ok).toBe(false);
    expect(parsePhone("call me", "NG").ok).toBe(false);
    expect(parsePhone("0803ABC4567", "NG").ok).toBe(false);
    expect(parsePhone("+999 123 456 789", "NG").ok).toBe(false);
  });
});

describe("email normalization", () => {
  it("lowercases and strips mailto and display names", () => {
    expect(normalizeEmail(" Info@Acme.NG ")).toEqual({
      ok: true,
      address: "info@acme.ng",
      domain: "acme.ng",
    });
    expect(normalizeEmail("mailto:sales@acme.com.ng")).toMatchObject({
      ok: true,
      address: "sales@acme.com.ng",
    });
    expect(normalizeEmail("Acme Sales <sales@acme.ng>")).toMatchObject({
      ok: true,
      address: "sales@acme.ng",
    });
  });

  it("rejects malformed addresses", () => {
    for (const bad of [
      "acme.ng",
      "info@",
      "@acme.ng",
      "info@acme",
      "in fo@acme.ng",
      "info..x@acme.ng",
      "info@-acme.ng",
      "info@acme.n",
    ]) {
      expect(normalizeEmail(bad).ok, bad).toBe(false);
    }
  });
});

describe("website canonicalization", () => {
  it("canonicalizes host case, www, scheme, query and trailing slash", () => {
    expect(canonicalizeWebsite("WWW.Acme-Foods.com.ng/")).toEqual({
      ok: true,
      kind: "website",
      url: "https://www.acme-foods.com.ng",
      domain: "acme-foods.com.ng",
    });
    expect(canonicalizeWebsite("http://acme.ng/menu/?utm_source=x#top")).toEqual({
      ok: true,
      kind: "website",
      url: "http://acme.ng/menu",
      domain: "acme.ng",
    });
  });

  it("converts internationalized domains to punycode", () => {
    const r = canonicalizeWebsite("https://bücher.de");
    expect(r).toMatchObject({ ok: true, domain: "xn--bcher-kva.de" });
  });

  it("classifies social profiles as socials, never as the website", () => {
    expect(canonicalizeWebsite("https://m.facebook.com/AcmeFoods")).toEqual({
      ok: true,
      kind: "social",
      platform: "facebook",
      url: "https://facebook.com/acmefoods",
      handle: "acmefoods",
    });
    expect(canonicalizeWebsite("instagram.com/acme.ng")).toMatchObject({
      kind: "social",
      platform: "instagram",
    });
  });

  it("rejects IPs, internal hosts, other schemes and junk", () => {
    for (const bad of [
      "http://127.0.0.1",
      "http://10.0.0.5/admin",
      "localhost:3000",
      "intranet.local",
      "javascript:alert(1)",
      "mailto:info@acme.ng",
      "ftp://acme.ng",
      "not a site",
      "acme",
      "https://user:pass@acme.ng",
    ]) {
      expect(canonicalizeWebsite(bad).ok, bad).toBe(false);
    }
  });
});

describe("names, places and countries", () => {
  it("normalizes business names for exact matching", () => {
    expect(normalizeBusinessName("  Acme   Foods Nig. Ltd. ")).toEqual({
      value: "Acme Foods Nig. Ltd.",
      normalized: "acme foods nig",
    });
    expect(normalizeBusinessName("ACME FOODS NIG LIMITED").normalized).toBe("acme foods nig");
    expect(normalizeBusinessName("Ọ̀yọ́ Bakery & Co").normalized).toBe("oyo bakery and");
  });

  it("canonicalizes Nigerian states and their spellings", () => {
    expect(nigerianState("Lagos State")).toBe("Lagos");
    expect(nigerianState("LAGOS")).toBe("Lagos");
    expect(nigerianState("FCT")).toBe("Federal Capital Territory");
    expect(nigerianState("Abuja")).toBe("Federal Capital Territory");
    expect(nigerianState("akwa-ibom")).toBe("Akwa Ibom");
    expect(nigerianState("Atlantis")).toBeNull();
    expect(normalizeRegion("rivers state", "NG")).toBe("Rivers");
    expect(normalizeRegion("greater accra", "GH")).toBe("Greater Accra");
    expect(regionKey("Lagos State")).toBe(regionKey("lagos"));
  });

  it("parses country codes and English names", () => {
    expect(parseCountry("ng")).toBe("NG");
    expect(parseCountry("Nigeria")).toBe("NG");
    expect(parseCountry("Ghana")).toBe("GH");
    expect(parseCountry("UK")).toBe("GB");
    expect(parseCountry("Wakanda")).toBeNull();
    expect(parseCountry("ZZ")).toBeNull();
  });

  it("formats a location without repeating parts", () => {
    expect(
      formatLocation({
        street: "12 Allen Avenue",
        locality: "Ikeja",
        lga: "Ikeja",
        region: "Lagos",
        country: "NG",
        postalCode: null,
      }),
    ).toBe("12 Allen Avenue, Ikeja, Lagos, Nigeria");
  });

  it("title-cases only uniform-case text", () => {
    expect(titleCaseIfUniform("VICTORIA ISLAND")).toBe("Victoria Island");
    expect(titleCaseIfUniform("port harcourt")).toBe("Port Harcourt");
    expect(titleCaseIfUniform("McDonald Street")).toBe("McDonald Street");
  });

  it("builds slugs and search words", () => {
    expect(slugify("Acme Foods (Sample)", "Ikeja")).toBe("acme-foods-sample-ikeja");
    expect(searchWords("Acme-Foods.com.ng")).toEqual(["acme", "foods", "com", "ng"]);
  });
});

describe("text helpers", () => {
  it("treats spreadsheet placeholders as blank", () => {
    for (const v of ["", "  ", "-", "N/A", "nil", "None", "#N/A"])
      expect(isBlankOrPlaceholder(v), v).toBe(true);
    expect(isBlankOrPlaceholder("0")).toBe(false);
  });

  it("strips control and zero-width characters", () => {
    expect(cleanText("Ac​me\u0007  Foods\n")).toBe("Acme Foods");
  });

  it("splits multi-valued cells", () => {
    expect(splitMultiValue("0803 123 4567, 0812 000 1111")).toEqual([
      "0803 123 4567",
      "0812 000 1111",
    ]);
    expect(splitMultiValue("0803 123 4567/0812 000 1111")).toEqual([
      "0803 123 4567",
      "0812 000 1111",
    ]);
    expect(splitMultiValue("a@x.ng; b@x.ng")).toEqual(["a@x.ng", "b@x.ng"]);
  });
});

describe("formula injection", () => {
  it("detects formula triggers on import", () => {
    for (const v of [
      '=HYPERLINK("http://x")',
      "+1+1",
      "-2+3",
      "@SUM(A1)",
      "\t=1",
      "\r=1",
      "  =1",
    ]) {
      expect(looksLikeFormula(v), JSON.stringify(v)).toBe(true);
    }
    expect(looksLikeFormula("Acme Foods")).toBe(false);
    expect(looksLikeFormula("+2348031234567", { allowLeadingPlus: true })).toBe(false);
    expect(looksLikeFormula("=2348031234567", { allowLeadingPlus: true })).toBe(true);
  });

  it("neutralizes formula cells on export but keeps E.164 numbers", () => {
    expect(neutralizeCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(neutralizeCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(neutralizeCell("-1")).toBe("'-1");
    expect(neutralizeCell("\tx")).toBe("'\tx");
    expect(neutralizeCell("+2348031234567")).toBe("+2348031234567");
    expect(neutralizeCell("+1+cmd")).toBe("'+1+cmd");
    expect(neutralizeCell("Acme")).toBe("Acme");
  });

  it("quotes per RFC 4180", () => {
    expect(csvCell('Acme, "The Best"')).toBe('"Acme, ""The Best"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvLine(["a", null, "=1"])).toBe("a,,'=1\r\n");
  });
});
