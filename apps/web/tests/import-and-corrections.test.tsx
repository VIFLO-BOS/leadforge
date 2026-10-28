import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MappingStep,
  mappingFromEntries,
  type ColumnMapping,
} from "@/components/app/businesses/import/mapping-step";
import {
  CorrectionDialog,
  toCorrectionRequest,
  type CorrectionTarget,
} from "@/components/app/businesses/detail/correction-dialog";
import { DETAIL, UPLOADED_IMPORT } from "../e2e/fixtures-businesses";
import { BELOW_MD, NARROW, mockMatchMedia } from "./helpers";
import { renderWithQuery, stubApi } from "./phase2-helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/businesses",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return { useWorkspace: () => workspace("researcher") };
});

afterEach(() => vi.unstubAllGlobals());

function Mapping({ onContinue }: { onContinue: () => void }) {
  const [mapping, setMapping] = useState<ColumnMapping>(
    mappingFromEntries(UPLOADED_IMPORT.headers.length, UPLOADED_IMPORT.suggestedMapping),
  );
  const [country, setCountry] = useState("NG");
  return (
    <MappingStep
      job={UPLOADED_IMPORT}
      mapping={mapping}
      onMappingChange={setMapping}
      defaultCountry={country}
      onDefaultCountryChange={setCountry}
      onBack={() => {}}
      onContinue={onContinue}
      continuing={false}
      previewRows={100}
    />
  );
}

describe("import mapping step", () => {
  it("preselects the API's suggestion and continues when it is valid", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    const onContinue = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<Mapping onContinue={onContinue} />);
    expect(screen.getByText(/Business name comes from “Business Name”/)).toBeVisible();
    expect(screen.getAllByText("Suggested from the header").length).toBe(7);
    // The unmapped "Notes" column is skipped.
    expect(screen.getByRole("combobox", { name: /Import “Notes” as/ })).toHaveTextContent(
      "Don't import",
    );
    await user.click(screen.getByRole("button", { name: "Check rows" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("blocks continuing without a name column, with the contracts' message", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    const onContinue = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<Mapping onContinue={onContinue} />);
    await user.click(screen.getByRole("combobox", { name: /Import “Business Name” as/ }));
    await user.click(await screen.findByRole("option", { name: "Don't import" }));
    expect(screen.getByText(/Choose the column that holds the business name/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Check rows" }));
    const alert = screen.getByText("Fix the mapping to continue").closest("[role=alert]");
    expect(alert).not.toBeNull();
    expect(within(alert as HTMLElement).getByText("Map exactly one column to name")).toBeVisible();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("flags a single-value field mapped from two columns on both rows", async () => {
    mockMatchMedia([]);
    const onContinue = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<Mapping onContinue={onContinue} />);
    await user.click(screen.getByRole("combobox", { name: /Import “Notes” as/ }));
    await user.click(await screen.findByRole("option", { name: "Website" }));
    expect(screen.getAllByText(/Only one column can map to it/)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Check rows" }));
    expect(screen.getByText("Only one column can map to website")).toBeVisible();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("validates the default country", async () => {
    mockMatchMedia([]);
    const onContinue = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<Mapping onContinue={onContinue} />);
    const country = screen.getByLabelText("Default country");
    await user.clear(country);
    await user.type(country, "N");
    expect(screen.getByText("Use a two-letter country code")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Check rows" }));
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe("corrections dialog", () => {
  function Dialog({ target }: { target: CorrectionTarget }) {
    const [t, setT] = useState<CorrectionTarget | null>(target);
    return <CorrectionDialog detail={DETAIL} target={t} onOpenChange={(o) => !o && setT(null)} />;
  }

  it("builds one correction per request from the contracts schema", () => {
    const base = {
      action: "replace" as const,
      target: "+2348031234567",
      value: "0809 111 2222",
      removeWebsite: false,
      whatsapp: "user_asserted" as const,
      country: "NG",
      categories: "Bakery, Catering",
      street: "",
      locality: "Ikeja",
      lga: "",
      region: "Lagos",
      postalCode: "",
      locationCountry: "NG",
      note: "",
    };
    expect(toCorrectionRequest({ ...base, field: "phone" })).toEqual({
      field: "phone",
      target: "+2348031234567",
      value: "0809 111 2222",
      country: "NG",
    });
    expect(toCorrectionRequest({ ...base, field: "phone", action: "remove" })).toEqual({
      field: "phone",
      target: "+2348031234567",
      value: null,
    });
    expect(toCorrectionRequest({ ...base, field: "categories" })).toEqual({
      field: "categories",
      value: ["Bakery", "Catering"],
    });
    expect(
      toCorrectionRequest({ ...base, field: "website", removeWebsite: true, note: " gone " }),
    ).toEqual({
      field: "website",
      value: null,
      note: "gone",
    });
    expect(toCorrectionRequest({ ...base, field: "location" })).toMatchObject({
      field: "location",
      value: { locality: "Ikeja", region: "Lagos", country: "NG", street: null },
    });
  });

  it("sends a phone replacement as a single PATCH and closes on success", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    const { calls } = stubApi((url, init) => {
      if (url.pathname === `/businesses/${DETAIL.id}` && init.method === "PATCH")
        return { body: { data: DETAIL } };
      return { body: { data: [], meta: { nextCursor: null, pageSize: 25 } } };
    });
    const user = userEvent.setup();
    renderWithQuery(
      <Dialog target={{ field: "phone", target: "+2348031234567", action: "replace" }} />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Correct details" });
    const value = within(dialog).getByLabelText(/New number/);
    expect(value).toHaveValue("+234 803 123 4567");
    await user.clear(value);
    await user.type(value, "0809 111 2222");
    await user.type(within(dialog).getByLabelText("Note"), "Called to confirm");
    await user.click(within(dialog).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({
      field: "phone",
      target: "+2348031234567",
      value: "0809 111 2222",
      country: "NG",
      note: "Called to confirm",
    });
  });

  it("shows client validation without calling the API", async () => {
    mockMatchMedia([]);
    const { calls } = stubApi(() => undefined);
    const user = userEvent.setup();
    renderWithQuery(<Dialog target={{ field: "name" }} />);
    const dialog = await screen.findByRole("dialog", { name: "Correct details" });
    await user.clear(within(dialog).getByLabelText(/Business name/));
    await user.click(within(dialog).getByRole("button", { name: "Save correction" }));
    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("puts the server's 400 details on the matching input", async () => {
    mockMatchMedia([]);
    stubApi((url, init) => {
      if (init.method === "PATCH") {
        return {
          status: 400,
          body: {
            error: {
              code: "VALIDATION_FAILED",
              message: "Invalid",
              details: [
                {
                  path: "value",
                  message: "Not a valid phone number for NG or with a country code",
                },
              ],
              requestId: "r1",
            },
          },
        };
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(<Dialog target={{ field: "phone", action: "add" }} />);
    const dialog = await screen.findByRole("dialog", { name: "Correct details" });
    await user.type(within(dialog).getByLabelText(/Phone number/), "12345");
    await user.click(within(dialog).getByRole("button", { name: "Save correction" }));
    const error = await within(dialog).findByText(
      "Not a valid phone number for NG or with a country code",
    );
    expect(error).toHaveAttribute("role", "alert");
    expect(within(dialog).getByLabelText(/Phone number/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("never offers WhatsApp confirmed by hand", async () => {
    mockMatchMedia([]);
    stubApi(() => undefined);
    renderWithQuery(<Dialog target={{ field: "whatsapp", target: "+2348031234567" }} />);
    const dialog = await screen.findByRole("dialog", { name: "Correct details" });
    expect(within(dialog).getByRole("radio", { name: /team-asserted/ })).toBeVisible();
    expect(within(dialog).getByRole("radio", { name: "Unknown" })).toBeVisible();
    expect(within(dialog).queryByRole("radio", { name: /^Confirmed/ })).toBeNull();
    expect(within(dialog).getByText(/cannot be set by hand/)).toBeVisible();
  });
});
