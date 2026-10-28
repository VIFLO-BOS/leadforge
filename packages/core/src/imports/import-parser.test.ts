import { describe, expect, it } from "vitest";
import type { ImportMappingEntry } from "@leadforge/contracts";
import { decodeCsvBuffer, detectDelimiter, ImportFileError, parseCsvFile } from "./csv-file.js";
import { suggestMapping } from "./mapping.js";
import { normalizeImportRow } from "./row-normalizer.js";

const utf8 = (s: string) => Buffer.from(s, "utf8");

function expectFileError(fn: () => unknown, code: string, message?: RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImportFileError);
    expect((err as ImportFileError).code).toBe(code);
    if (message) expect((err as Error).message).toMatch(message);
    return;
  }
  throw new Error("expected an ImportFileError");
}

describe("CSV file parsing", () => {
  it("parses a simple file with spreadsheet row numbers", () => {
    const parsed = parseCsvFile(utf8("Name,Phone\nAcme,08031234567\nBeta,08121234567\n"));
    expect(parsed.headers).toEqual(["Name", "Phone"]);
    expect(parsed.rows).toEqual([
      { rowNumber: 2, cells: ["Acme", "08031234567"] },
      { rowNumber: 3, cells: ["Beta", "08121234567"] },
    ]);
    expect(parsed.delimiter).toBe(",");
    expect(parsed.encoding).toBe("utf-8");
  });

  it("strips a UTF-8 BOM so the first header is clean", () => {
    const parsed = parseCsvFile(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8("Name,City\nAcme,Ikeja\n")]),
    );
    expect(parsed.headers[0]).toBe("Name");
    expect(parsed.encoding).toBe("utf-8");
  });

  it("decodes UTF-16 LE and BE with BOM", () => {
    const text = "Name,City\nỌja Store,Ibadan\n";
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const parsedLe = parseCsvFile(le);
    expect(parsedLe.encoding).toBe("utf-16le");
    expect(parsedLe.rows[0]!.cells[0]).toBe("Ọja Store");

    const swapped = Buffer.from(text, "utf16le");
    for (let i = 0; i < swapped.length; i += 2) {
      const a = swapped[i]!;
      swapped[i] = swapped[i + 1]!;
      swapped[i + 1] = a;
    }
    const parsedBe = parseCsvFile(Buffer.concat([Buffer.from([0xfe, 0xff]), swapped]));
    expect(parsedBe.encoding).toBe("utf-16be");
    expect(parsedBe.rows[0]!.cells[1]).toBe("Ibadan");
  });

  it("falls back to Windows-1252 for non-UTF-8 bytes (Excel on Windows)", () => {
    // "Café" in Windows-1252: é = 0xE9, which is invalid as a lone UTF-8 byte.
    const buf = Buffer.concat([utf8("Name\nCaf"), Buffer.from([0xe9]), utf8("\n")]);
    const { text, encoding } = decodeCsvBuffer(buf);
    expect(encoding).toBe("windows-1252");
    expect(text).toContain("Café");
    expect(parseCsvFile(buf).rows[0]!.cells[0]).toBe("Café");
  });

  it("keeps quoted newlines, quotes and delimiters inside one cell and one row", () => {
    const csv =
      'Name,Address,Phone\n"Acme ""Best"" Foods","12 Allen Ave,\nIkeja",08031234567\nBeta,Lekki,08121234567\n';
    const parsed = parseCsvFile(utf8(csv));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.cells).toEqual([
      'Acme "Best" Foods',
      "12 Allen Ave,\nIkeja",
      "08031234567",
    ]);
    // Row numbers follow records, as a spreadsheet shows them.
    expect(parsed.rows[1]!.rowNumber).toBe(3);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter('Name;Phone;"a,b"\n')).toBe(";");
    expect(detectDelimiter("Name\tPhone\n")).toBe("\t");
    expect(parseCsvFile(utf8("Name;City\nAcme;Ikeja\n")).rows[0]!.cells).toEqual(["Acme", "Ikeja"]);
  });

  it("handles CRLF line endings and counts blank lines without dropping data rows", () => {
    const parsed = parseCsvFile(utf8("Name,City\r\nAcme,Ikeja\r\n\r\n,\r\nBeta,Yaba\r\n"));
    expect(parsed.rows.map((r) => r.cells[0])).toEqual(["Acme", "Beta"]);
    expect(parsed.rows[1]!.rowNumber).toBe(5);
    expect(parsed.blankRowsSkipped).toBe(2);
  });

  it("keeps rows with the wrong number of cells so they can be reported", () => {
    const parsed = parseCsvFile(utf8("Name,City,Phone\nAcme,Ikeja\nBeta,Yaba,0812,extra\n"));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.cells).toHaveLength(2);
    expect(parsed.rows[1]!.cells).toHaveLength(4);
  });

  it("rejects files that are empty, header-only or not CSV", () => {
    expectFileError(() => parseCsvFile(Buffer.alloc(0)), "IMPORT_INVALID", /empty/);
    expectFileError(() => parseCsvFile(utf8("Name,Phone\n")), "IMPORT_INVALID", /no data rows/);
    expectFileError(
      () => parseCsvFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])),
      "UNSUPPORTED_MEDIA_TYPE",
      /Excel/,
    );
    expectFileError(
      () => parseCsvFile(Buffer.from("%PDF-1.7 ...")),
      "UNSUPPORTED_MEDIA_TYPE",
      /PDF/,
    );
    expectFileError(
      () => parseCsvFile(Buffer.from([0x41, 0x00, 0x42, 0x00, 0x0a])),
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  it("reports an unclosed quote with its line", () => {
    expectFileError(
      () => parseCsvFile(utf8('Name,City\n"Acme,Ikeja\nBeta,Yaba\n')),
      "IMPORT_INVALID",
      /line/,
    );
  });

  it("enforces the 50,000 data row limit with PAYLOAD_TOO_LARGE", () => {
    const file = (n: number) => utf8("Name\n" + "x\n".repeat(n));
    expectFileError(() => parseCsvFile(file(50_001)), "PAYLOAD_TOO_LARGE", /50,000/);
    expect(parseCsvFile(file(50_000)).rows).toHaveLength(50_000);
  });

  it("enforces the column limit", () => {
    const header = Array.from({ length: 101 }, (_, i) => `c${i}`).join(",");
    expectFileError(
      () => parseCsvFile(utf8(`${header}\n${"x,".repeat(100)}x\n`)),
      "IMPORT_INVALID",
      /101 columns/,
    );
  });
});

describe("mapping suggestions", () => {
  it("recognizes common header names", () => {
    expect(
      suggestMapping([
        "Business Name",
        "Phone Number",
        "Phone 2",
        "E-mail",
        "Website",
        "City",
        "State",
        "LGA",
        "Notes",
      ]),
    ).toEqual([
      { column: 0, field: "name" },
      { column: 1, field: "phone" },
      { column: 2, field: "phone" },
      { column: 3, field: "email" },
      { column: 4, field: "website" },
      { column: 5, field: "locality" },
      { column: 6, field: "region" },
      { column: 7, field: "lga" },
    ]);
  });

  it("suggests a single-valued field once", () => {
    expect(suggestMapping(["Name", "Company", "Website", "URL"])).toEqual([
      { column: 0, field: "name" },
      { column: 2, field: "website" },
    ]);
  });
});

describe("row normalization", () => {
  const headers = [
    "Name",
    "Phone",
    "Email",
    "Website",
    "City",
    "State",
    "Country",
    "Category",
    "WhatsApp",
  ];
  const mapping: ImportMappingEntry[] = [
    { column: 0, field: "name" },
    { column: 1, field: "phone" },
    { column: 2, field: "email" },
    { column: 3, field: "website" },
    { column: 4, field: "locality" },
    { column: 5, field: "region" },
    { column: 6, field: "country" },
    { column: 7, field: "category" },
    { column: 8, field: "whatsapp" },
  ];
  const row = (overrides: Partial<Record<number, string>>) => {
    const base = [
      "Acme Foods",
      "0803 123 4567",
      "Info@Acme.ng",
      "www.acme.ng",
      "ikeja",
      "Lagos State",
      "",
      "Restaurant; Catering",
      "",
    ];
    for (const [k, v] of Object.entries(overrides)) base[Number(k)] = v!;
    return base;
  };

  it("normalizes a good row with NG defaults", () => {
    const r = normalizeImportRow(row({}), headers, mapping, "NG");
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.input?.phones[0]?.e164).toBe("+2348031234567");
    expect(r.input?.emails[0]?.address).toBe("info@acme.ng");
    expect(r.input?.website).toMatchObject({ domain: "acme.ng", url: "https://www.acme.ng" });
    expect(r.input?.location).toMatchObject({
      locality: "Ikeja",
      region: "Lagos",
      country: "NG",
      regionKey: "lagos",
    });
    expect(r.preview.categories).toEqual(["Restaurant", "Catering"]);
  });

  it("uses the country column to parse phones and override the default", () => {
    const r = normalizeImportRow(
      row({ 1: "024 412 3456", 5: "Greater Accra", 6: "Ghana" }),
      headers,
      mapping,
      "NG",
    );
    expect(r.valid).toBe(true);
    expect(r.input?.phones[0]?.e164).toBe("+233244123456");
    expect(r.input?.location?.country).toBe("GH");
  });

  it("reports invalid phones, emails, websites and countries per cell", () => {
    const r = normalizeImportRow(
      row({ 1: "12345", 2: "info@", 3: "http://10.0.0.1", 6: "Wakanda" }),
      headers,
      mapping,
      "NG",
    );
    expect(r.valid).toBe(false);
    expect(r.input).toBeNull();
    expect(r.errors.map((e) => e.code).sort()).toEqual([
      "INVALID_COUNTRY",
      "INVALID_EMAIL",
      "INVALID_PHONE",
      "INVALID_WEBSITE",
    ]);
    const phoneError = r.errors.find((e) => e.code === "INVALID_PHONE")!;
    expect(phoneError).toMatchObject({ column: 1, header: "Phone", field: "phone" });
  });

  it("rejects formula-injection cells in any mapped column", () => {
    for (const [col, value] of [
      [0, '=HYPERLINK("http://evil.example","Click")'],
      [0, "@SUM(A1:A9)"],
      [0, "+cmd|' /C calc'!A0"],
      [0, "-2+3"],
      [0, "\t=1+1"],
      [4, "\r=1"],
      [1, "=2348031234567"],
    ] as const) {
      const r = normalizeImportRow(row({ [col]: value }), headers, mapping, "NG");
      expect(r.valid, JSON.stringify(value)).toBe(false);
      expect(
        r.errors.some((e) => e.code === "FORMULA_INJECTION" && e.column === col),
        JSON.stringify(value),
      ).toBe(true);
    }
  });

  it("accepts a leading plus in phone columns", () => {
    const r = normalizeImportRow(row({ 1: "+234 803 123 4567" }), headers, mapping, "NG");
    expect(r.valid).toBe(true);
  });

  it("requires a name and treats placeholders as blank", () => {
    const r = normalizeImportRow(row({ 0: "  ", 2: "N/A", 3: "-" }), headers, mapping, "NG");
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: "REQUIRED", field: "name", column: 0 }),
    ]);
  });

  it("reports rows whose cell count does not match the header", () => {
    const short = normalizeImportRow(["Acme", "0803 123 4567"], headers, mapping, "NG");
    expect(short.valid).toBe(false);
    expect(short.errors[0]?.code).toBe("COLUMN_COUNT_MISMATCH");
    // Trailing empty cells from trailing delimiters are fine.
    const trailing = normalizeImportRow([...row({}), "", ""], headers, mapping, "NG");
    expect(trailing.valid).toBe(true);
  });

  it("splits multi-valued phone and email cells and dedupes them", () => {
    const r = normalizeImportRow(
      row({ 1: "0803 123 4567, +2348031234567 / 0812 000 1111", 2: "a@acme.ng; b@acme.ng" }),
      headers,
      mapping,
      "NG",
    );
    expect(r.valid).toBe(true);
    expect(r.input?.phones.map((p) => p.e164)).toEqual(["+2348031234567", "+2348120001111"]);
    expect(r.input?.emails.map((e) => e.address)).toEqual(["a@acme.ng", "b@acme.ng"]);
  });

  it("records WhatsApp only as user_asserted", () => {
    const flagged = normalizeImportRow(row({ 8: "Yes" }), headers, mapping, "NG");
    expect(flagged.input?.phones[0]?.whatsapp).toBe("user_asserted");
    const number = normalizeImportRow(row({ 8: "0812 000 1111" }), headers, mapping, "NG");
    expect(number.input?.phones.find((p) => p.e164 === "+2348120001111")?.whatsapp).toBe(
      "user_asserted",
    );
    expect(number.input?.phones.find((p) => p.e164 === "+2348031234567")?.whatsapp).toBe("unknown");
    const none = normalizeImportRow(row({ 8: "no" }), headers, mapping, "NG");
    expect(none.input?.phones.every((p) => p.whatsapp === "unknown")).toBe(true);
  });

  it("stores social profile links as socials with a warning", () => {
    const r = normalizeImportRow(
      row({ 3: "https://instagram.com/acme.ng" }),
      headers,
      mapping,
      "NG",
    );
    expect(r.valid).toBe(true);
    expect(r.input?.website).toBeNull();
    expect(r.input?.socials[0]).toMatchObject({ platform: "instagram", handle: "acme.ng" });
    expect(r.warnings[0]?.code).toBe("SOCIAL_PROFILE");
  });

  it("flags cells over the length limit", () => {
    const r = normalizeImportRow(row({ 7: "x".repeat(2001) }), headers, mapping, "NG");
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: "CELL_TOO_LONG", column: 7 });
  });
});
