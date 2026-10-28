import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Building2, Database } from "lucide-react";
import {
  Banner,
  ConfirmDialog,
  CopyableValue,
  EmptyState,
  ErrorState,
  FIELD_STATE_META,
  FieldStatus,
  JOB_STATE_META,
  JobStatus,
  Progress,
  Skeleton,
  Stat,
  StatusIndicator,
  Stepper,
  Timeline,
  type FieldState,
  type JobState,
} from "@leadforge/ui";
import { Chart } from "@leadforge/ui/charts";
import { NARROW, mockMatchMedia } from "./helpers";

describe("ConfirmDialog", () => {
  it("focuses Cancel when no phrase is required", async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Sign out this session?"
        confirmLabel="Sign out session"
        onConfirm={() => {}}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Sign out this session?" });
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" })),
    );
  });

  it("gates a destructive bulk action behind the typed phrase and lists consequences", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Suppress 24 businesses?"
        confirmLabel="Suppress 24"
        confirmPhrase="SUPPRESS 24"
        destructive
        onConfirm={onConfirm}
      >
        <p>Suppressed businesses are excluded from discovery and export.</p>
      </ConfirmDialog>,
    );
    expect(screen.getByText(/excluded from discovery/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Suppress 24" });
    expect(confirm).toBeDisabled();
    const field = screen.getByRole("textbox", { name: "Confirmation phrase" });
    await user.type(field, "suppress 24");
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, "SUPPRESS 24");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not close while the action is running", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Remove member?"
        loading
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("Progress", () => {
  it("reports determinate progress with value text", () => {
    render(
      <Progress
        label="Discovery job progress"
        value={120}
        max={500}
        valueText="120 of 500 records"
        showLabel
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Discovery job progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "120");
    expect(bar).toHaveAttribute("aria-valuemax", "500");
    expect(bar).toHaveAttribute("aria-valuetext", "120 of 500 records");
    expect(screen.getByText("120 of 500 records")).toBeInTheDocument();
  });

  it("defaults the value text to a percentage and clamps", () => {
    render(<Progress label="Upload" value={140} />);
    const bar = screen.getByRole("progressbar", { name: "Upload" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "100%");
  });

  it("omits aria-valuenow when indeterminate", () => {
    render(<Progress label="Analysis" />);
    const bar = screen.getByRole("progressbar", { name: "Analysis" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuetext", "In progress");
  });
});

describe("Banner", () => {
  it("announces destructive banners assertively and keeps them undismissable by default", () => {
    render(
      <Banner
        tone="destructive"
        title="Your last payment failed"
        description="Discovery is paused until the payment method is updated."
        actions={<button type="button">Update payment method</button>}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Your last payment failed");
    expect(
      within(alert).getByRole("button", { name: "Update payment method" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("uses a polite status role for other tones and can be dismissed", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Banner tone="info" title="Credits are running low" onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("Credits are running low");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Status indicators", () => {
  it("renders an icon and text for every field state", () => {
    for (const state of Object.keys(FIELD_STATE_META) as FieldState[]) {
      const { container, unmount } = render(<FieldStatus state={state} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveTextContent(FIELD_STATE_META[state].label);
      expect(root).toHaveAttribute("data-state", state);
      expect(root.querySelector("svg")).not.toBeNull();
      expect(root).toHaveAttribute("title", FIELD_STATE_META[state].description);
      unmount();
    }
    expect(Object.keys(FIELD_STATE_META).sort()).toEqual([
      "conflicting",
      "expired",
      "missing",
      "stale",
      "unverified",
      "verified",
    ]);
  });

  it("renders an icon and text for every job state", () => {
    for (const state of Object.keys(JOB_STATE_META) as JobState[]) {
      const { container, unmount } = render(<JobStatus state={state} variant="badge" />);
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveTextContent(JOB_STATE_META[state].label);
      expect(root.querySelector("svg")).not.toBeNull();
      unmount();
    }
    expect(Object.keys(JOB_STATE_META).sort()).toEqual([
      "cancelled",
      "completed",
      "completed_with_warnings",
      "draft",
      "failed",
      "queued",
      "running",
    ]);
  });

  it("labels the running state and allows label overrides", () => {
    render(
      <>
        <JobStatus state="running" />
        <JobStatus state="completed_with_warnings" />
        <FieldStatus state="verified" label="Verified by MX check" />
      </>,
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Completed with warnings")).toBeInTheDocument();
    expect(screen.getByText("Verified by MX check")).toBeInTheDocument();
  });

  it("generic StatusIndicator always shows the label beside an icon", () => {
    const { container } = render(<StatusIndicator tone="warning" label="Suspended" />);
    expect(screen.getByText("Suspended")).toBeVisible();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("CopyableValue", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  it("shows the full value, copies it and announces the result", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const id = "0b9f6a52-7c1d-4c55-9a7e-3d1f2b8c4e10";
    render(<CopyableValue value={id} label="organization ID" />);
    expect(screen.getByText(id)).toBeInTheDocument();
    screen.getByRole("button", { name: "Copy organization ID" }).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(id));
    expect(await screen.findByText("Copied organization ID")).toBeInTheDocument();
  });

  it("announces a failure when the clipboard is unavailable", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyableValue value="example.test" label="domain" mono={false} />);
    screen.getByRole("button", { name: "Copy domain" }).click();
    expect(await screen.findByText("Could not copy domain")).toBeInTheDocument();
  });
});

describe("Stat", () => {
  it("says No data yet instead of inventing a number", () => {
    render(<Stat label="Verified contacts" value={null} icon={Database} />);
    expect(screen.getByText("Verified contacts")).toBeInTheDocument();
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("shows a real value with its trend text and footnote", () => {
    render(
      <Stat
        label="Businesses"
        value="1,284"
        trend={{ value: "+12", direction: "up", sentiment: "positive", label: "vs last 30 days" }}
        footnote="From discovery jobs (Sample)"
      />,
    );
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("vs last 30 days")).toBeInTheDocument();
    expect(screen.getByText("From discovery jobs (Sample)")).toBeInTheDocument();
  });

  it("marks itself busy while loading", () => {
    const { container } = render(<Stat label="Credits" value="500" loading />);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("500")).toBeNull();
  });
});

describe("Stepper", () => {
  const steps = [
    { id: "define", label: "Define the job" },
    { id: "sources", label: "Choose sources" },
    { id: "review", label: "Review and estimate" },
  ];

  it("marks the current step and lets completed steps be revisited", async () => {
    const user = userEvent.setup();
    const onStepSelect = vi.fn();
    render(
      <Stepper
        aria-label="Discovery job steps"
        steps={steps}
        current={1}
        onStepSelect={onStepSelect}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Discovery job steps" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    await user.click(within(items[0]!).getByRole("button", { name: /Define the job/ }));
    expect(onStepSelect).toHaveBeenCalledWith(0);
    expect(within(items[2]!).queryByRole("button")).toBeNull();
    expect(within(items[2]!).getByText("Not started")).toBeInTheDocument();
  });

  it("shows an error step", () => {
    render(
      <Stepper
        steps={[...steps.slice(0, 2), { id: "x", label: "Payment", status: "error" }]}
        current={1}
      />,
    );
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });
});

describe("Timeline", () => {
  it("renders each event with a machine-readable time", () => {
    const { container } = render(
      <Timeline
        aria-label="Provenance"
        items={[
          {
            id: "o1",
            title: "Phone observed",
            timestamp: "2026-10-01T09:30:00.000Z",
            timestampLabel: "1 Oct 2026",
            meta: "Official places API (Sample)",
            tone: "success",
            icon: Building2,
          },
          { id: "o2", title: "Email verified", timestamp: "2026-10-02T10:00:00.000Z" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Provenance" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const times = container.querySelectorAll("time");
    expect(times[0]).toHaveAttribute("dateTime", "2026-10-01T09:30:00.000Z");
    expect(times[0]).toHaveTextContent("1 Oct 2026");
    expect(screen.getByText("Official places API (Sample)")).toBeInTheDocument();
  });
});

describe("EmptyState, ErrorState and Skeleton", () => {
  it("EmptyState explains and offers the first action", () => {
    render(
      <EmptyState
        icon={Building2}
        title="No businesses yet"
        description="Discovery jobs add businesses here."
        action={<button type="button">Import a CSV</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No businesses yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import a CSV" })).toBeInTheDocument();
  });

  it("ErrorState is an alert with retry and the request ID", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState
        message="The server could not complete the request."
        requestId="req_123"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("req_123")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("Skeleton is hidden from assistive technology", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
  });
});

describe("Chart", () => {
  const data = [
    { source: "Places API (Sample)", leads: 1200 },
    { source: "CSV import (Sample)", leads: 340 },
  ];

  it("offers an accessible table view with formatted values", async () => {
    const user = userEvent.setup();
    render(
      <Chart
        type="bar"
        title="Leads by source"
        description="Last 30 days"
        data={data}
        xKey="source"
        xLabel="Source"
        series={[{ key: "leads", label: "Leads" }]}
        valueFormatter={(v) => v.toLocaleString("en-US")}
        footnote="Source: discovery jobs (Sample)"
      />,
    );
    expect(screen.getByRole("figure", { name: "Leads by source" })).toBeInTheDocument();
    const view = screen.getByRole("radiogroup", { name: "Leads by source: view as" });
    await user.click(within(view).getByRole("radio", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Leads by source" });
    expect(within(table).getByRole("columnheader", { name: "Source" })).toBeInTheDocument();
    expect(
      within(table).getByRole("rowheader", { name: "Places API (Sample)" }),
    ).toBeInTheDocument();
    expect(within(table).getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("Source: discovery jobs (Sample)")).toBeInTheDocument();
  });

  it("starts in table view when asked and shows a legend only for multiple series in chart view", () => {
    const multi = [{ day: "Mon", a: 1, b: 2 }];
    const { rerender } = render(
      <Chart
        type="line"
        title="Jobs"
        data={multi}
        xKey="day"
        series={[
          { key: "a", label: "Completed" },
          { key: "b", label: "Failed" },
        ]}
      />,
    );
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("Completed");
    rerender(
      <Chart
        type="line"
        title="Jobs"
        data={multi}
        xKey="day"
        defaultView="table"
        series={[{ key: "a", label: "Completed" }]}
      />,
    );
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it("renders the compact variant under 480px", () => {
    mockMatchMedia([NARROW]);
    render(
      <Chart
        type="area"
        title="Records per day"
        data={data}
        xKey="source"
        series={[{ key: "leads", label: "Leads" }]}
      />,
    );
    expect(screen.getByRole("figure", { name: "Records per day" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Table" })).toBeInTheDocument();
  });

  it("shows the empty message without data", () => {
    render(
      <Chart type="bar" title="Quality" data={[]} xKey="x" series={[{ key: "y", label: "Y" }]} />,
    );
    expect(screen.getByText("No data for this period yet.")).toBeInTheDocument();
  });
});
