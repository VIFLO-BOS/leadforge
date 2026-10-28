import { describe, expect, it } from "vitest";
import { ObjectId } from "@leadforge/db-mongo";
import { HtmlDocument } from "../html/html-document.js";
import { normalizeCreateRequest } from "../businesses/business-input.js";
import {
  buildObservations,
  createBusinessDocument,
  mergeWebsiteContacts,
  type ProvenanceContext,
} from "../businesses/business-model.js";
import { checkEmail } from "../normalization/email-checks.js";
import { isDisposableDomain } from "../normalization/disposable.js";
import { canonicalizeWebsite } from "../normalization/website.js";
import { normalizeSocialProfile } from "../normalization/social.js";
import { StubResolver } from "../safe-fetch/test-support.js";
import {
  extractContacts,
  labeledWhatsAppNumbers,
  whatsappLinkNumber,
} from "./contact-extractor.js";

const ORG = "0192c9a8-0000-7000-8000-000000000001";
const NOW = new Date("2026-10-25T12:00:00.000Z");

const PAGE = `<html><body>
<footer>
  <p>Email <a href="mailto:Hello@MamaPut.example.test?subject=Hi">Hello@MamaPut.example.test</a></p>
  <p>Call <a href="tel:+2348031234567">0803 123 4567</a></p>
  <a href="tel:08099998888" aria-label="WhatsApp us">Chat</a>
  <a href="https://wa.me/2348021112222">WhatsApp</a>
  <a href="https://api.whatsapp.com/send?phone=2348033334444&text=hi">Message</a>
  <a href="https://wa.me/message/ABCDEF">Order on WhatsApp</a>
  <p>WhatsApp: +234 805 555 6666 (no calls)</p>
  <p>Customer care 0806 777 8888</p>
  <a href="https://www.instagram.com/MamaPutKitchen/?hl=en">Instagram</a>
  <a href="https://facebook.com/sharer.php?u=x">Share</a>
  <a href="https://twitter.com/intent/tweet">Tweet</a>
  <a href="https://x.com/mamaput">X</a>
  <a href="mailto:not-an-email">broken</a>
</footer></body></html>`;

describe("contact extraction from a business page", () => {
  const doc = HtmlDocument.parse(PAGE, "https://mamaput.example.test/contact");
  const contacts = extractContacts(doc, "NG");

  it("extracts mailto, tel, WhatsApp and social profile links with evidence", () => {
    expect(contacts.emails.map((e) => e.address)).toEqual(["hello@mamaput.example.test"]);
    expect(contacts.emails[0]!.evidence).toMatchObject({
      page: "https://mamaput.example.test/contact",
      snippet: "Hello@MamaPut.example.test",
    });
    expect(contacts.emails[0]!.evidence.selector).toMatch(/footer > p:nth-of-type\(1\) > a$/);
    expect(contacts.phones.map((p) => p.phone.e164)).toEqual(
      expect.arrayContaining([
        "+2348031234567",
        "+2348099998888",
        "+2348021112222",
        "+2348033334444",
        "+2348055556666",
      ]),
    );
    // A number with no link and no WhatsApp label is not collected from text.
    expect(contacts.phones.some((p) => p.phone.e164 === "+2348067778888")).toBe(false);
    expect(contacts.socials.map((s) => s.url).sort()).toEqual([
      "https://instagram.com/mamaputkitchen",
      "https://x.com/mamaput",
    ]);
  });

  it("confirms WhatsApp only from explicit links or an explicit label, never from a plain number", () => {
    const byPhone = Object.fromEntries(
      contacts.whatsapp.filter((w) => w.phone).map((w) => [w.phone!.e164, w.method]),
    );
    expect(byPhone).toEqual({
      "+2348099998888": "explicit_label",
      "+2348021112222": "wa_link",
      "+2348033334444": "wa_link",
      "+2348055556666": "explicit_label",
    });
    expect(byPhone["+2348031234567"]).toBeUndefined();
    // A wa.me message link names no number: recorded, but it confirms no phone.
    expect(contacts.whatsapp.some((w) => w.phone === null && w.raw.includes("wa.me/message"))).toBe(
      true,
    );
  });

  it("parses WhatsApp link forms and labels", () => {
    expect(whatsappLinkNumber("https://wa.me/2348031234567")).toEqual({
      isWhatsApp: true,
      digits: "2348031234567",
    });
    expect(whatsappLinkNumber("https://api.whatsapp.com/send/?phone=%2B2348031234567")).toEqual({
      isWhatsApp: true,
      digits: "2348031234567",
    });
    expect(whatsappLinkNumber("whatsapp://send?phone=2348031234567").digits).toBe("2348031234567");
    expect(whatsappLinkNumber("https://chat.whatsapp.com/Invite").isWhatsApp).toBe(false);
    expect(whatsappLinkNumber("https://example.com/wa.me/123").isWhatsApp).toBe(false);
    expect(labeledWhatsAppNumbers("Call 0803 123 4567. WhatsApp available.", "NG")).toEqual([]);
    expect(
      labeledWhatsAppNumbers("Call or WhatsApp 0803 123 4567", "NG").map((x) => x.phone.e164),
    ).toEqual(["+2348031234567"]);
  });
});

describe("website contact merge rules", () => {
  function business() {
    const { input } = normalizeCreateRequest(
      {
        name: "Mama Put",
        categories: [],
        phones: ["0803 123 4567"],
        emails: ["info@mamaput.example.test"],
        website: "mamaput.example.test",
      },
      "NG",
    );
    const ctx: ProvenanceContext = {
      source: "user_import",
      collectionMethod: "user_import",
      sourceRef: null,
      collectedAt: NOW,
      confidence: 0.6,
      actor: { type: "system", userId: null },
      importId: null,
      note: null,
      idSeed: null,
    };
    const id = new ObjectId();
    const { refs } = buildObservations(ORG, id, input!, ctx);
    return createBusinessDocument(ORG, input!, refs, ctx, {
      id,
      slug: "mama-put",
      createdVia: { kind: "manual", importId: null, userId: null },
    });
  }
  const website: ProvenanceContext = {
    source: "website",
    collectionMethod: "website_fetch",
    sourceRef: "https://mamaput.example.test/",
    collectedAt: NOW,
    confidence: 0.7,
    actor: { type: "system", userId: null },
    importId: null,
    note: null,
    idSeed: null,
  };
  const phone = (raw: string) => {
    const { input } = normalizeCreateRequest(
      { name: "x", categories: [], phones: [raw], emails: [] },
      "NG",
    );
    return input!.phones[0]!;
  };

  it("verifies a valid phone seen on the own site and confirms WhatsApp from explicit evidence", () => {
    const doc = business();
    const obs = new ObjectId();
    const wa = new ObjectId();
    const change = mergeWebsiteContacts(
      doc,
      {
        ownSite: true,
        phones: [{ phone: phone("0803 123 4567"), obsId: obs }],
        emails: [],
        socials: [],
        whatsapp: [{ e164: "+2348031234567", obsId: wa }],
      },
      website,
    );
    expect(change.phonesVerified).toEqual(["+2348031234567"]);
    expect(doc.phones[0]).toMatchObject({
      state: "verified",
      lastVerifiedAt: NOW,
      whatsapp: { status: "confirmed" },
    });
    expect(doc.phones[0]!.whatsapp.evidenceObservationId!.equals(wa)).toBe(true);
    expect(doc.sources).toContain("website");
  });

  it("does not verify or confirm anything seen off the business's own site", () => {
    const doc = business();
    const change = mergeWebsiteContacts(
      doc,
      {
        ownSite: false,
        phones: [{ phone: phone("0803 123 4567"), obsId: new ObjectId() }],
        emails: [],
        socials: [],
        whatsapp: [{ e164: "+2348031234567", obsId: new ObjectId() }],
      },
      website,
    );
    expect(change.phonesVerified).toEqual([]);
    expect(change.whatsappConfirmed).toEqual([]);
    expect(doc.phones[0]).toMatchObject({ state: "unverified", whatsapp: { status: "unknown" } });
  });

  it("keeps emails unverified: release 1 does no mailbox probing", () => {
    const doc = business();
    mergeWebsiteContacts(
      doc,
      {
        ownSite: true,
        phones: [],
        emails: [
          {
            email: {
              address: "sales@mamaput.example.test",
              domain: "mamaput.example.test",
              raw: "sales@mamaput.example.test",
            },
            obsId: new ObjectId(),
          },
        ],
        socials: [],
        whatsapp: [],
      },
      website,
    );
    expect(doc.emails.map((e) => e.state)).toEqual(["unverified", "unverified"]);
  });
});

describe("email checks (syntax, MX, disposable)", () => {
  const dns = new StubResolver(
    {},
    {
      "acme.ng": [
        { exchange: "mx2.acme.ng", priority: 20 },
        { exchange: "mx1.acme.ng", priority: 10 },
      ],
      "nomail.ng": [{ exchange: ".", priority: 0 }],
      "flaky.ng": "ESERVFAIL",
      "mailinator.com": [{ exchange: "mx.mailinator.com", priority: 1 }],
    },
  );

  it("records a passed syntax and MX check, and never more than that", async () => {
    const r = await checkEmail("Info@Acme.ng", dns);
    expect(r).toMatchObject({
      address: "info@acme.ng",
      outcome: "mx_found",
      mxHosts: ["mx1.acme.ng", "mx2.acme.ng"],
    });
    expect(r.steps.map((s) => [s.method, s.result])).toEqual([
      ["email_syntax", "passed"],
      ["email_mx", "passed"],
      ["email_disposable", "passed"],
    ]);
  });

  it("fails MX for missing or null MX, and is inconclusive on DNS errors", async () => {
    expect((await checkEmail("a@unknown.ng", dns)).outcome).toBe("no_mx");
    expect((await checkEmail("a@nomail.ng", dns)).outcome).toBe("no_mx");
    const flaky = await checkEmail("a@flaky.ng", dns);
    expect(flaky.outcome).toBe("dns_error");
    expect(flaky.steps[1]).toMatchObject({ method: "email_mx", result: "inconclusive" });
  });

  it("flags disposable domains (and their subdomains) and stops at bad syntax", async () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("x.mailinator.com")).toBe(true);
    expect(isDisposableDomain("acme.ng")).toBe(false);
    expect((await checkEmail("a@mailinator.com", dns)).outcome).toBe("disposable");
    const bad = await checkEmail("not-an-email", dns);
    expect(bad.outcome).toBe("invalid_syntax");
    expect(bad.steps).toHaveLength(1);
  });
});

describe("social URL normalization", () => {
  it("canonicalizes profiles and refuses share links and posts", () => {
    expect(normalizeSocialProfile("https://m.facebook.com/AcmeFoods/?ref=page")).toEqual({
      platform: "facebook",
      url: "https://facebook.com/acmefoods",
      handle: "acmefoods",
    });
    expect(normalizeSocialProfile("facebook.com/profile.php?id=100012345")).toMatchObject({
      url: "https://facebook.com/profile.php?id=100012345",
    });
    expect(normalizeSocialProfile("https://twitter.com/@Acme_NG")).toMatchObject({
      platform: "x",
      url: "https://x.com/acme_ng",
    });
    expect(
      normalizeSocialProfile("https://ng.linkedin.com/company/Acme-Foods/about"),
    ).toMatchObject({ url: "https://linkedin.com/company/acme-foods" });
    expect(normalizeSocialProfile("https://www.tiktok.com/@acme.ng?lang=en")).toMatchObject({
      url: "https://tiktok.com/@acme.ng",
    });
    expect(normalizeSocialProfile("https://www.youtube.com/channel/UCabcdefghij123")).toMatchObject(
      { url: "https://youtube.com/channel/UCabcdefghij123" },
    );
    for (const notProfile of [
      "https://www.facebook.com/sharer/sharer.php?u=x",
      "https://instagram.com/p/Cx1",
      "https://youtu.be/abc",
      "https://x.com/intent/tweet",
      "https://linkedin.com/feed/",
    ]) {
      expect(normalizeSocialProfile(notProfile), notProfile).toBeNull();
    }
  });

  it("keeps social links out of the website field", () => {
    expect(canonicalizeWebsite("https://www.instagram.com/acme.ng/")).toMatchObject({
      ok: true,
      kind: "social",
      url: "https://instagram.com/acme.ng",
    });
    expect(canonicalizeWebsite("https://facebook.com/sharer.php?u=x")).toMatchObject({ ok: false });
  });
});
