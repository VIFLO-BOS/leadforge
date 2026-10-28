import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  clearedFilters,
  contactChoice,
  parseDirectoryParams,
  serializeDirectoryState,
  toFilter,
  toListQuery,
  withContactChoice,
} from "@/lib/business-filters";
import { mappingFromEntries, mappingIssues } from "@/components/app/businesses/import/mapping-step";
import { checkImportFile } from "@/components/app/businesses/import/upload-step";
import { toQueryString } from "@/lib/api";
import { formatBytes, safeHttpUrl } from "@/lib/format";

describe("directory URL state", () => {
  it("round-trips filters, sort and page size through the URL", () => {
    const params = new URLSearchParams(
      "q=acme&category=bakery&category=pharmacy&region=lagos&hasPhone=true&emailState=verified&whatsapp=confirmed&source=user_import&suppression=include&sort=name:asc&pageSize=50",
    );
    const state = parseDirectoryParams(params);
    expect(state).toMatchObject({
      q: "acme",
      category: ["bakery", "pharmacy"],
      region: ["lagos"],
      hasPhone: true,
      emailState: ["verified"],
      whatsapp: ["confirmed"],
      source: ["user_import"],
      suppression: "include",
      sort: { field: "name", direction: "asc" },
      pageSize: 50,
    });
    const again = parseDirectoryParams(serializeDirectoryState(state));
    expect(again).toEqual(state);
  });

  it("leaves defaults out of the URL", () => {
    const state = parseDirectoryParams(new URLSearchParams());
    expect(serializeDirectoryState(state).toString()).toBe("");
    expect(state.suppression).toBe("exclude");
    expect(state.sort).toEqual({ field: "updatedAt", direction: "desc" });
    expect(state.pageSize).toBe(25);
  });

  it("drops invalid params from a stale or hand-edited link and keeps the rest", () => {
    const state = parseDirectoryParams(
      new URLSearchParams(
        "phoneState=probably&sort=score:desc&pageSize=500&region=lagos&importId=nope",
      ),
    );
    expect(state.phoneState).toEqual([]);
    expect(state.sort).toEqual({ field: "updatedAt", direction: "desc" });
    expect(state.pageSize).toBe(25);
    expect(state.importId).toBeUndefined();
    expect(state.region).toEqual(["lagos"]);
  });

  it("builds the API query with repeated array params and the export filter as JSON", () => {
    const state = parseDirectoryParams(new URLSearchParams("category=a&category=b&hasEmail=false"));
    expect(toQueryString(toListQuery(state, "CUR"))).toBe(
      "?suppression=exclude&category=a&category=b&hasEmail=false&sort=updatedAt%3Adesc&pageSize=25&cursor=CUR",
    );
    expect(toFilter(state)).toEqual({
      suppression: "exclude",
      category: ["a", "b"],
      hasEmail: false,
    });
  });

  it("maps contact presence and state to one choice per field", () => {
    const base = parseDirectoryParams(new URLSearchParams());
    const has = withContactChoice(base, "phone", "has");
    expect(has.hasPhone).toBe(true);
    expect(contactChoice(has, "phone")).toBe("has");
    const verified = withContactChoice(has, "phone", "verified");
    expect(verified.hasPhone).toBeUndefined();
    expect(verified.phoneState).toEqual(["verified"]);
    expect(contactChoice(verified, "phone")).toBe("verified");
    expect(contactChoice(withContactChoice(verified, "phone", "none"), "phone")).toBe("none");
    expect(activeFilterCount(verified)).toBe(1);
    expect(activeFilterCount(clearedFilters(verified))).toBe(0);
  });
});

describe("import mapping validation (contracts ImportMapping)", () => {
  it("requires exactly one name column", () => {
    expect(mappingIssues(["phone", "email"])).toContain("Map exactly one column to name");
    expect(mappingIssues(["", ""])).toEqual(["Map at least the business name column."]);
    expect(mappingIssues(["name", "phone", "phone"])).toEqual([]);
  });

  it("allows several phone, email and category columns but one of anything else", () => {
    expect(mappingIssues(["name", "website", "website"])).toContain(
      "Only one column can map to website",
    );
    expect(mappingIssues(["name", "category", "category", "email", "email"])).toEqual([]);
  });

  it("seeds a per-column mapping from the API's suggestion", () => {
    expect(
      mappingFromEntries(4, [
        { column: 0, field: "name" },
        { column: 2, field: "phone" },
        { column: 9, field: "email" },
      ]),
    ).toEqual(["name", "", "phone", ""]);
  });
});

describe("upload client checks", () => {
  const file = (name: string, size: number) =>
    Object.defineProperty(new File(["x"], name), "size", { value: size }) as File;

  it("accepts .csv, .tsv and .txt within the size limit", () => {
    expect(checkImportFile(file("a.csv", 10))).toBeNull();
    expect(checkImportFile(file("a.TSV", 10))).toBeNull();
    expect(checkImportFile(file("a.txt", 10))).toBeNull();
  });

  it("refuses workbooks, empty files and files over 20 MB", () => {
    expect(checkImportFile(file("a.xlsx", 10))).toMatch(/is not a CSV/);
    expect(checkImportFile(file("a.csv", 0))).toMatch(/empty/);
    expect(checkImportFile(file("a.csv", 21 * 1024 * 1024))).toMatch(/up to 20 MB/);
  });
});

describe("display helpers", () => {
  it("only lets http(s) values become links", () => {
    expect(safeHttpUrl("https://mamaput.example.test")).toBe("https://mamaput.example.test/");
    expect(safeHttpUrl("http://a.example.test/x")).toBe("http://a.example.test/x");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("mamaput.example.test")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it("formats sizes without a trailing .0", () => {
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
    expect(formatBytes(18_234)).toBe("17.8 KB");
    expect(formatBytes(512)).toBe("512 B");
  });
});
