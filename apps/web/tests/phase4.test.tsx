import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@leadforge/ui";
import { DetectionItem, EvidenceList } from "@/components/app/analysis/evidence";
import { ScoreView } from "@/components/app/businesses/detail/score-tab";
import { MergeDialog, defaultSurvivor } from "@/components/app/dedup/merge-dialog";
import { MergeRecordItem } from "@/components/app/dedup/merge-history";
import { ScoringSettings } from "@/components/app/settings/scoring-settings";
import { shouldPollAnalysis } from "@/lib/analysis";
import { parseDirectoryParams, serializeDirectoryState, toListQuery } from "@/lib/business-filters";
import { draftFromWeights, validateWeights, weightErrorsFromServer } from "@/lib/scoring";
import {
  CANDIDATE,
  DETECTIONS,
  MARKUP_SNIPPET,
  MERGES,
  MERGED_CANDIDATE,
  SCORE,
  SCORING_PROFILE,
} from "../e2e/fixtures-phase4";
import { renderWithQuery, stubApi } from "./phase2-helpers";
import { setLocation } from "./phase3-helpers";

vi.mock("next/navigation", async () => (await import("./phase3-helpers")).navigationMock());

let role: "owner" | "admin" | "researcher" | "sales_rep" | "analyst" = "owner";
vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return { useWorkspace: () => workspace(role) };
});

beforeEach(() => {
  role = "owner";
  setLocation("/app");
});
afterEach(() => vi.unstubAllGlobals());

const page = <T,>(data: T[]) => ({ data, meta: { nextCursor: null, pageSize: 25 } });

describe("evidence rendering", () => {
  it("renders a markup snippet as escaped text, never as HTML", () => {
    const detection = DETECTIONS.find((d) => d.key === "no_contact_form")!;
    const { container } = renderWithQuery(<DetectionItem detection={detection} />);
    // The snippet is visible exactly as text...
    const snippets = screen.getAllByTestId("evidence-snippet");
    expect(snippets.some((s) => s.textContent === MARKUP_SNIPPET)).toBe(true);
    // ...and none of its markup became elements.
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.innerHTML).toContain("&lt;form action=");
  });

  it("links pages only when they are http(s) and states the observation", () => {
    renderWithQuery(
      <EvidenceList
        evidence={[
          { type: "url", value: "javascript:alert(1)", page: null },
          {
            type: "url",
            value: "https://mamaput.example.test/contact",
            page: "https://mamaput.example.test/contact",
          },
        ]}
      />,
    );
    expect(screen.getByText("javascript:alert(1)").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: /mamaput\.example\.test\/contact/ })).toHaveAttribute(
      "href",
      "https://mamaput.example.test/contact",
    );
  });

  it("shows observed yes, no and unknown with confidence, phrased as detections", () => {
    renderWithQuery(
      <ul>
        {DETECTIONS.map((d) => (
          <DetectionItem key={d.key} detection={d} />
        ))}
      </ul>,
    );
    expect(screen.getAllByText("Gap observed").length).toBe(4);
    expect(screen.getAllByText("Feature seen").length).toBe(4);
    expect(screen.getAllByText("Could not check").length).toBe(1);
    expect(screen.getByText("No contact form was detected")).toBeVisible();
    expect(screen.getByText("Confidence 75%")).toBeVisible();
    expect(screen.queryByText(/has no/i)).toBeNull();
  });
});

describe("analysis polling", () => {
  it("polls while queued or running and until the credit is settled", () => {
    expect(shouldPollAnalysis({ status: "queued", credits: { settled: false } })).toBe(true);
    expect(shouldPollAnalysis({ status: "running", credits: { settled: false } })).toBe(true);
    expect(shouldPollAnalysis({ status: "completed", credits: { settled: false } })).toBe(true);
    expect(shouldPollAnalysis({ status: "completed", credits: { settled: true } })).toBe(false);
    expect(shouldPollAnalysis({ status: "failed", credits: { settled: true } })).toBe(false);
  });
});

describe("lead score", () => {
  it("shows fit and data confidence as two separate numbers, never blended", () => {
    renderWithQuery(<ScoreView score={SCORE} />);
    expect(screen.getByTestId("fit-score-value")).toHaveTextContent(/^64$/);
    expect(screen.getByTestId("data-confidence-value")).toHaveTextContent(/^48$/);
    // No combined figure anywhere: not the sum, not the average.
    const text = screen.getByTestId("score-tab").textContent ?? "";
    expect(text).not.toMatch(/\b112\b/);
    expect(text).not.toMatch(/\b56\b/);
    expect(screen.getByTestId("score-explanation")).toHaveTextContent(
      "Score reflects fit with your configured criteria. It is not a prediction of purchase intent.",
    );
    expect(screen.getByRole("table", { name: "Fit score breakdown" })).toBeVisible();
    expect(screen.getByText("Category Restaurant is in your ICP")).toBeVisible();
  });
});

describe("scoring weights", () => {
  it("validates whole numbers that add up to 100 with the contracts' schema", () => {
    expect(validateWeights(draftFromWeights(SCORING_PROFILE.weights)).weights).not.toBeNull();
    const off = validateWeights({ ...draftFromWeights(SCORING_PROFILE.weights), freshness: "5" });
    expect(off.weights).toBeNull();
    expect(off.sum).toBe(95);
    expect(off.totalError).toBe("Weights must add up to 100 (they add up to 95)");
    const fraction = validateWeights({
      ...draftFromWeights(SCORING_PROFILE.weights),
      freshness: "9.5",
    });
    expect(fraction.fieldErrors.freshness).toBe("Weights are whole numbers");
    const empty = validateWeights({
      ...draftFromWeights(SCORING_PROFILE.weights),
      sourceReliability: "",
    });
    expect(empty.fieldErrors.sourceReliability).toBe("Enter a whole number from 0 to 100");
  });

  it("maps server errors on `weights` and `weights.<signal>` onto the form", () => {
    const mapped = weightErrorsFromServer([
      { path: "weights", message: "Weights must add up to 100 (they add up to 101)" },
      { path: "weights.freshness", message: "At most 100" },
      { path: "icp.categories.0", message: "Too short" },
    ]);
    expect(mapped.totalError).toBe("Weights must add up to 100 (they add up to 101)");
    expect(mapped.fieldErrors.freshness).toBe("At most 100");
    expect(mapped.other).toEqual(["Too short"]);
  });

  it("shows the live total, blocks an invalid save, and sends the loaded version", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi((url, init) => {
      if (url.pathname === "/scoring/profile" && (init.method ?? "GET") === "GET")
        return { body: { data: SCORING_PROFILE } };
      if (url.pathname === "/scoring/profile" && init.method === "PATCH") {
        return {
          body: {
            data: {
              ...SCORING_PROFILE,
              version: 3,
              weights: { ...SCORING_PROFILE.weights, freshness: 5, sourceReliability: 10 },
            },
          },
        };
      }
      if (url.pathname === "/discovery/sources") return { body: page([]) };
      return undefined;
    });
    renderWithQuery(<ScoringSettings canEdit />);
    const freshness = await screen.findByLabelText("Freshness");
    await user.clear(freshness);
    await user.type(freshness, "5");
    expect(screen.getByTestId("weights-total")).toHaveTextContent("95 of 100");
    expect(screen.getByTestId("weights-error")).toHaveTextContent("they add up to 95");
    await user.click(screen.getByRole("button", { name: /Save and recompute scores/ }));
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);

    const reliability = screen.getByLabelText("Source reliability");
    await user.clear(reliability);
    await user.type(reliability, "10");
    expect(screen.getByTestId("weights-total")).toHaveTextContent("100 of 100");
    await user.click(screen.getByRole("button", { name: /Save and recompute scores/ }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    const body = calls.find((c) => c.method === "PATCH")!.body as {
      version: number;
      weights: Record<string, number>;
    };
    expect(body.version).toBe(SCORING_PROFILE.version);
    expect(body.weights.freshness).toBe(5);
    expect(body.weights.sourceReliability).toBe(10);
  });

  it("explains a 409 stale version and offers a reload", async () => {
    const user = userEvent.setup();
    stubApi((url, init) => {
      if (url.pathname === "/scoring/profile" && (init.method ?? "GET") === "GET")
        return { body: { data: SCORING_PROFILE } };
      if (url.pathname === "/scoring/profile" && init.method === "PATCH") {
        return {
          status: 409,
          body: { error: { code: "CONFLICT", message: "Stale version", requestId: "t" } },
        };
      }
      if (url.pathname === "/discovery/sources") return { body: page([]) };
      return undefined;
    });
    renderWithQuery(<ScoringSettings canEdit />);
    const freshness = await screen.findByLabelText("Freshness");
    const industry = screen.getByLabelText("Industry match");
    await user.clear(freshness);
    await user.type(freshness, "5");
    await user.clear(industry);
    await user.type(industry, "20");
    await user.click(screen.getByRole("button", { name: /Save and recompute scores/ }));
    const conflict = await screen.findByTestId("scoring-conflict");
    expect(conflict).toHaveTextContent("Someone else changed the scoring profile");
    expect(within(conflict).getByRole("button", { name: /Reload latest/ })).toBeVisible();
  });

  it("is read only for roles without settings:scoring", async () => {
    role = "researcher";
    stubApi((url) => {
      if (url.pathname === "/scoring/profile") return { body: { data: SCORING_PROFILE } };
      if (url.pathname === "/discovery/sources") return { body: page([]) };
      return undefined;
    });
    renderWithQuery(<ScoringSettings canEdit={false} />);
    expect(await screen.findByLabelText("Freshness")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save and recompute scores/ })).toBeNull();
    expect(screen.getByText("Read only")).toBeVisible();
  });
});

describe("merge dialog", () => {
  it("defaults to the earlier record as survivor and sends every field choice", async () => {
    const user = userEvent.setup();
    expect(defaultSurvivor(CANDIDATE.businesses)).toBe(CANDIDATE.businesses[0]!.id);
    const { calls } = stubApi((url, init) => {
      if (url.pathname === `/dedup/candidates/${CANDIDATE.id}/merge` && init.method === "POST") {
        return {
          body: { data: { merge: MERGES[0], candidate: { ...CANDIDATE, status: "merged" } } },
        };
      }
      return undefined;
    });
    const onMerged = vi.fn();
    renderWithQuery(
      <MergeDialog candidate={CANDIDATE} open onOpenChange={() => {}} onMerged={onMerged} />,
    );
    const dialog = await screen.findByTestId("merge-dialog");
    // Choose business B as the survivor, then keep A's name.
    await user.click(
      within(dialog).getByRole("radio", { name: /Business B: Mama Put Kitchens Ikeja/ }),
    );
    const nameGroup = within(dialog).getByRole("radiogroup", { name: "Name to keep" });
    await user.click(within(nameGroup).getByRole("radio", { name: /Mama Put Kitchen \(Sample\)/ }));
    await user.click(within(dialog).getByRole("button", { name: /Merge businesses/ }));
    await waitFor(() => expect(onMerged).toHaveBeenCalled());
    const body = calls.find((c) => c.method === "POST")!.body;
    expect(body).toEqual({
      survivorId: CANDIDATE.businesses[1]!.id,
      fields: { name: "merged", website: "survivor", location: "survivor" },
    });
  });

  it("explains a MERGE_CONFLICT and does not retry blindly", async () => {
    const user = userEvent.setup();
    stubApi((url, init) => {
      if (url.pathname.endsWith("/merge") && init.method === "POST") {
        return {
          status: 409,
          body: { error: { code: "MERGE_CONFLICT", message: "Changed", requestId: "t" } },
        };
      }
      return undefined;
    });
    renderWithQuery(<MergeDialog candidate={CANDIDATE} open onOpenChange={() => {}} />);
    const dialog = await screen.findByTestId("merge-dialog");
    await user.click(within(dialog).getByRole("button", { name: /Merge businesses/ }));
    expect(
      await within(dialog).findByText("This pair changed since the page loaded"),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /Merge businesses/ })).toBeDisabled();
  });
});

describe("undo merge", () => {
  it("offers force after a MERGE_CONFLICT and sends force: true only when confirmed", async () => {
    const user = userEvent.setup();
    const merge = MERGES[0]!;
    const { calls } = stubApi((url, init) => {
      if (url.pathname === `/dedup/merges/${merge.id}/undo` && init.method === "POST") {
        const body = init.body ? (JSON.parse(String(init.body)) as { force?: boolean }) : {};
        if (!body.force) {
          return {
            status: 409,
            body: {
              error: { code: "MERGE_CONFLICT", message: "Changed after the merge", requestId: "t" },
            },
          };
        }
        return { body: { data: { ...merge, status: "undone", undoForced: true, canUndo: false } } };
      }
      if (url.pathname === `/dedup/candidates/${MERGED_CANDIDATE.id}`)
        return { body: { data: MERGED_CANDIDATE } };
      if (url.pathname === "/organizations/current/members") return { body: page([]) };
      return undefined;
    });
    renderWithQuery(
      <>
        <ul>
          <MergeRecordItem merge={merge} />
        </ul>
        <Toaster />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: /Undo merge/ }));
    const confirm = await screen.findByRole("alertdialog", { name: "Undo this merge?" });
    await user.click(within(confirm).getByRole("button", { name: "Undo merge" }));
    const force = await screen.findByRole("alertdialog", {
      name: "These records changed after the merge",
    });
    expect(force).toHaveTextContent("discards those later changes");
    const undoCalls = () => calls.filter((c) => c.path.endsWith("/undo"));
    expect(undoCalls()).toHaveLength(1);
    expect(undoCalls()[0]!.body).toEqual({});
    await user.click(within(force).getByRole("button", { name: "Undo anyway" }));
    await waitFor(() => expect(undoCalls()).toHaveLength(2));
    expect(undoCalls()[1]!.body).toEqual({ force: true });
    expect(await screen.findByText("Merge undone")).toBeVisible();
  });

  it("explains who may undo when the caller may not", async () => {
    stubApi((url) => {
      if (url.pathname === "/organizations/current/members") return { body: page([]) };
      return undefined;
    });
    renderWithQuery(
      <ul>
        <MergeRecordItem merge={MERGES[1]!} />
      </ul>,
    );
    expect(await screen.findByTestId("undo-not-allowed")).toHaveTextContent(
      "Owners and administrators can undo any merge. The person who merged can undo it within 30 days.",
    );
    expect(screen.queryByRole("button", { name: /Undo merge/ })).toBeNull();
  });
});

describe("directory score filters", () => {
  it("round-trips fit and data confidence ranges and sends them to the API", () => {
    const state = parseDirectoryParams(
      new URLSearchParams("fitMin=50&fitMax=90&dataConfidenceMin=40&sort=fit:desc&fitMax=bad"),
    );
    expect(state.fitMin).toBe(50);
    expect(state.dataConfidenceMin).toBe(40);
    expect(state.sort).toEqual({ field: "fit", direction: "desc" });
    const query = toListQuery(state);
    expect(query).toMatchObject({ fitMin: 50, dataConfidenceMin: 40, sort: "fit:desc" });
    expect(serializeDirectoryState(state).get("fitMin")).toBe("50");
  });
});

describe("bulk suppress", () => {
  it("sends one POST /businesses/suppress with the scope and reason and shows per-outcome counts", async () => {
    const { BulkSuppressDialog } =
      await import("@/components/app/businesses/directory/bulk-suppress-dialog");
    const user = userEvent.setup();
    const ids = [
      "6add8b76520012303c641f9f",
      "6add8b76520012303c641fa0",
      "6add8b76520012303c641fa1",
    ];
    const { calls } = stubApi((url, init) => {
      if (url.pathname === "/businesses/suppress" && init.method === "POST") {
        return {
          body: {
            data: {
              results: [
                {
                  id: ids[0],
                  outcome: "suppressed",
                  value: "mamaput.example.test",
                  entryId: "6add8b76520012303c645001",
                  message: null,
                },
                {
                  id: ids[1],
                  outcome: "already_suppressed",
                  value: "yabatechhub.example.test",
                  entryId: null,
                  message: null,
                },
                {
                  id: ids[2],
                  outcome: "no_value",
                  value: null,
                  entryId: null,
                  message: "No website domain",
                },
              ],
              summary: {
                requested: 3,
                suppressed: 1,
                alreadySuppressed: 1,
                notFound: 0,
                noValue: 1,
                failed: 0,
                businessesAffected: 4,
              },
            },
          },
        };
      }
      return undefined;
    });
    const onDone = vi.fn();
    renderWithQuery(<BulkSuppressDialog ids={ids} open onOpenChange={() => {}} onDone={onDone} />);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("radio", { name: /Their website domains/ }));
    await user.type(within(dialog).getByLabelText(/Reason/), "Asked not to be contacted");
    await user.type(within(dialog).getByLabelText("Confirmation phrase"), "SUPPRESS 3");
    await user.click(within(dialog).getByRole("button", { name: "Suppress 3" }));
    const result = await screen.findByTestId("bulk-suppress-result");
    expect(result).toHaveTextContent("Suppressed: 1");
    expect(result).toHaveTextContent("Already suppressed: 1");
    expect(result).toHaveTextContent("No value for this scope: 1");
    expect(result).toHaveTextContent("4 businesses are now flagged");
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ ids, scope: "domain", reason: "Asked not to be contacted" });
    expect(onDone).toHaveBeenCalledWith([ids[0], ids[1]]);
  });
});
