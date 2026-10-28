import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryWizard } from "@/components/app/discovery/wizard/discovery-wizard";
import { EstimateStep } from "@/components/app/discovery/wizard/estimate-step";
import {
  defaultValues,
  placeRequirement,
  suggestName,
  supportFor,
  toSpec,
  validateThrough,
  type WizardValues,
} from "@/components/app/discovery/wizard/wizard-model";
import {
  CATEGORIES,
  DISCOVERY_SOURCES,
  ESTIMATE_BLOCKED,
  ESTIMATE_INSUFFICIENT,
  ESTIMATE_OK,
  LOCATIONS,
  QUEUED_JOB,
} from "../e2e/fixtures-discovery";
import { mockMatchMedia } from "./helpers";
import { renderWithQuery, stubApi } from "./phase2-helpers";
import { routerPush, setLocation } from "./phase3-helpers";

vi.mock("next/navigation", async () => (await import("./phase3-helpers")).navigationMock());

vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return { useWorkspace: () => workspace("researcher") };
});

const overture = DISCOVERY_SOURCES.find((s) => s.key === "overture_places")!;
const OVERTURE_SUPPORT = supportFor([overture]);

function values(o: Partial<WizardValues> = {}): WizardValues {
  return { ...defaultValues(), ...o };
}

beforeEach(() => {
  // Step bodies fade in; under reduced motion they render in their final state at once.
  mockMatchMedia(["(prefers-reduced-motion: reduce)"]);
  window.sessionStorage.clear();
  setLocation("/app/discovery/new");
  routerPush.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("wizard model (validated with the contracts' DiscoveryJobSpec)", () => {
  it("asks for a source first, then categories and a place", () => {
    expect(validateThrough(0, values())).toEqual({ sources: "Choose at least one source." });
    const step1 = validateThrough(
      1,
      values({ sources: ["overture_places"] }),
      "NG",
      OVERTURE_SUPPORT,
    );
    expect(step1.categories).toBe("Add at least one category or keyword.");
    expect(step1.region).toBe("Choose a state, an LGA or a city or town.");
    expect(step1.name).toBe("Give the job a name of at least 2 characters.");
  });

  it("words the place requirement from the fields the sources honour", () => {
    expect(placeRequirement(supportFor([]))).toBe("Choose a state, a city or town or an area.");
    expect(placeRequirement(OVERTURE_SUPPORT)).toBe("Choose a state, an LGA or a city or town.");
  });

  it("rejects record limits outside 1 to 5,000 and malformed domains", () => {
    const base = values({
      sources: ["overture_places"],
      categories: ["Pharmacy"],
      locality: "Ikeja",
      name: "Pharmacy in Ikeja",
    });
    for (const maxRecords of ["0", "abc", "6000", "1.5", ""]) {
      expect(validateThrough(2, { ...base, maxRecords }, "NG", OVERTURE_SUPPORT).maxRecords).toBe(
        "Enter a whole number from 1 to 5,000.",
      );
    }
    expect(
      validateThrough(2, { ...base, domainsExclude: "not a domain" }, "NG", OVERTURE_SUPPORT)
        .domainsExclude,
    ).toBe("Domain 1: Use a bare domain such as example.com");
    expect(validateThrough(2, base, "NG", OVERTURE_SUPPORT)).toEqual({});
  });

  it("sends only the controls the selected sources honour", () => {
    const spec = toSpec(
      values({
        sources: ["overture_places"],
        categories: ["Pharmacy"],
        region: "Lagos",
        lga: "Ikeja",
        area: "Allen Avenue",
        name: "Pharmacies",
        confidence: "high",
      }),
      "NG",
      OVERTURE_SUPPORT,
    );
    expect(spec.location).toEqual({
      country: "NG",
      region: "Lagos",
      lga: "Ikeja",
      locality: undefined,
      query: undefined,
    });
    expect(spec.confidence).toBe("high");
    expect(spec.requireContact).toBe(true);
    expect(spec.priorityFields).toBeUndefined();
  });

  it("suggests a name from the categories and place", () => {
    expect(
      suggestName(
        values({
          categories: ["Pharmacy", "Bakery"],
          lga: "ikeja",
          region: "Lagos",
          locality: "Ikeja",
        }),
      ),
    ).toBe("Pharmacy and bakery in Ikeja, Lagos");
  });
});

interface Calls {
  estimate: number;
  creates: { key: string | null; body: unknown }[];
}

function stubWizardApi(
  opts: {
    estimate?: typeof ESTIMATE_OK;
    create?: (n: number) => { status: number; body: unknown; headers?: Record<string, string> };
  } = {},
) {
  const calls: Calls = { estimate: 0, creates: [] };
  const api = stubApi((url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (url.pathname === "/discovery/sources")
      return { body: { data: DISCOVERY_SOURCES, meta: { nextCursor: null, pageSize: 2 } } };
    if (url.pathname === "/discovery/categories")
      return { body: { data: CATEGORIES, meta: { nextCursor: null, pageSize: 4 } } };
    if (url.pathname === "/discovery/locations") return { body: { data: LOCATIONS } };
    if (method === "POST" && url.pathname === "/discovery/jobs/estimate") {
      calls.estimate++;
      return { body: { data: opts.estimate ?? ESTIMATE_OK } };
    }
    if (method === "POST" && url.pathname === "/discovery/jobs") {
      const n = calls.creates.length;
      calls.creates.push({
        key: new Headers(init.headers).get("idempotency-key"),
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      return opts.create ? opts.create(n) : { status: 201, body: { data: QUEUED_JOB } };
    }
    return undefined;
  });
  return { ...api, calls };
}

async function fillToEstimate(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: the only runnable source is preselected; the unavailable one shows its reason.
  await screen.findByText("Choose where to search");
  const google = await screen.findByRole("checkbox", { name: "Google Places API (New)" });
  expect(google).toBeDisabled();
  expect(screen.getByText(/^Not available: Google's terms/)).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Overture Maps Places" })).toBeChecked(),
  );
  await user.click(screen.getByRole("button", { name: /Continue/ }));

  // Step 2: categories from the source's catalogue, a city.
  await screen.findByText("What to find, and where");
  await user.click(await screen.findByRole("button", { name: /^Pharmacy/ }));
  await user.type(screen.getByLabelText("City or town"), "Ikeja");
  expect(screen.getByLabelText("Name")).toHaveValue("Pharmacy in Ikeja");
  await user.click(screen.getByRole("button", { name: /Continue/ }));

  // Step 3: the source honours confidence and require-contact, not priority fields.
  await screen.findByText("Set limits");
  expect(screen.getByRole("radio", { name: /^High/ })).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "Only places with a way to contact them" }),
  ).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Phone numbers" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /Continue/ }));
  await screen.findByText("Check the estimate");
}

describe("discovery wizard", () => {
  it("blocks a step until its fields are valid and explains why", async () => {
    stubWizardApi();
    const user = userEvent.setup();
    renderWithQuery(<DiscoveryWizard />);
    await screen.findByText("Choose where to search");
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Overture Maps Places" })).toBeChecked(),
    );
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByText("What to find, and where");
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Add at least one category or keyword.")).toBeVisible();
    expect(screen.getByText("Choose a state, an LGA or a city or town.")).toBeVisible();
    expect(window.location.search).toBe("?step=target");
  });

  it("estimates, creates with an Idempotency-Key and opens the job", async () => {
    const api = stubWizardApi();
    const user = userEvent.setup();
    renderWithQuery(<DiscoveryWizard />);
    await fillToEstimate(user);
    const est = await screen.findByTestId("estimate");
    expect(within(est).getByText("Credits held").closest("div")?.parentElement).toHaveTextContent(
      "100",
    );
    expect(within(est).getByText("Matching places")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { name: "Review and create" });
    // Scheduling is shown, disabled and labelled.
    expect(screen.getByRole("radio", { name: /Schedule/ })).toBeDisabled();
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Create discovery job" }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`/app/discovery/${QUEUED_JOB.id}`));
    expect(api.calls.creates).toHaveLength(1);
    expect(api.calls.creates[0]?.key).toMatch(/^wizard-[A-Za-z0-9-]{8,}$/);
    expect(api.calls.creates[0]?.body).toMatchObject({
      sources: ["overture_places"],
      categories: ["Pharmacy"],
      location: { country: "NG", locality: "Ikeja" },
      confidence: "standard",
      requireContact: true,
    });
  });

  it("reuses the Idempotency-Key when the same submission is retried", async () => {
    const api = stubWizardApi({
      create: (n) =>
        n === 0
          ? {
              status: 500,
              body: { error: { code: "INTERNAL_ERROR", message: "x", requestId: "r1" } },
            }
          : { status: 200, body: { data: QUEUED_JOB } },
    });
    const user = userEvent.setup();
    renderWithQuery(<DiscoveryWizard />);
    await fillToEstimate(user);
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { name: "Review and create" });
    await user.click(screen.getByRole("button", { name: "Create discovery job" }));
    expect(await screen.findByText("Could not create the job")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create discovery job" }));
    await waitFor(() => expect(routerPush).toHaveBeenCalled());
    expect(api.calls.creates).toHaveLength(2);
    expect(api.calls.creates[1]?.key).toBe(api.calls.creates[0]?.key);
  });

  it("honours Retry-After when job creation is rate limited", async () => {
    stubWizardApi({
      create: () => ({
        status: 429,
        body: { error: { code: "RATE_LIMITED", message: "Too many", requestId: "r2" } },
        headers: { "retry-after": "30" },
      }),
    });
    const user = userEvent.setup();
    renderWithQuery(<DiscoveryWizard />);
    await fillToEstimate(user);
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(await screen.findByRole("button", { name: "Create discovery job" }));
    expect(await screen.findByText(/You can try again in (30|29) seconds/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Create discovery job" })).toBeDisabled();
  });

  it("stops at insufficient credits with required versus available and says who can buy credits", async () => {
    stubWizardApi({ estimate: ESTIMATE_INSUFFICIENT });
    const user = userEvent.setup();
    renderWithQuery(<DiscoveryWizard />);
    await fillToEstimate(user);
    const shortfall = await screen.findByTestId("credits-shortfall");
    expect(shortfall).toHaveTextContent("This job holds 100 credits and 42 are available");
    // Owners and administrators buy credits on the Billing page (Phase 6); this researcher is
    // told who can, with no dead button.
    expect(within(shortfall).queryByRole("button", { name: /Buy credits/ })).toBeNull();
    expect(within(shortfall).getByTestId("buy-credits-note")).toHaveTextContent(
      "Owners and administrators can buy credits.",
    );
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
  });
});

describe("estimate blockers", () => {
  it("lists each blocker with its source and a way back", async () => {
    const onGoToStep = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <EstimateStep
        estimate={ESTIMATE_BLOCKED}
        loading={false}
        fetching={false}
        error={null}
        retryIn={0}
        updatedAt={Date.now()}
        sources={DISCOVERY_SOURCES}
        onRefresh={() => {}}
        onGoToStep={onGoToStep}
      />,
    );
    const blockers = screen.getByTestId("estimate-blockers");
    expect(blockers).toHaveAttribute("role", "alert");
    expect(blockers).toHaveTextContent("Source disabled · Overture Maps Places");
    expect(blockers).toHaveTextContent("switched off for this workspace");
    expect(screen.getByText("No selected source can run")).toBeVisible();
    await user.click(within(blockers).getByRole("button", { name: "Change sources" }));
    expect(onGoToStep).toHaveBeenCalledWith(0);
  });
});
