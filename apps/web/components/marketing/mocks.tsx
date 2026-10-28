/**
 * Product interface mocks for the marketing site, built from the app's own components.
 * Every record is fictional and labelled "(Sample)"; mocks are inert (not focusable, hidden from
 * assistive technology) and each one is wrapped by a <MockFigure> whose caption says so.
 */
import {
  Building2,
  Compass,
  Database,
  Globe,
  Home,
  Kanban,
  ListChecks,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Badge,
  FieldStatus,
  JobStatus,
  Progress,
  Stepper,
  Timeline,
  cn,
  type FieldState,
} from "@leadforge/ui";

export const SAMPLE_BUSINESSES: {
  name: string;
  industry: string;
  area: string;
  phone: FieldState;
  email: FieldState;
  website: FieldState;
  score: number;
}[] = [
  {
    name: "Corner Bakery (Sample)",
    industry: "Bakery",
    area: "Ikeja, Lagos",
    phone: "verified",
    email: "unverified",
    website: "missing",
    score: 82,
  },
  {
    name: "Bright Smile Dental (Sample)",
    industry: "Dental clinic",
    area: "Lekki, Lagos",
    phone: "verified",
    email: "verified",
    website: "verified",
    score: 74,
  },
  {
    name: "Fresh Fold Laundry (Sample)",
    industry: "Laundry",
    area: "Yaba, Lagos",
    phone: "stale",
    email: "missing",
    website: "unverified",
    score: 61,
  },
  {
    name: "Quick Fix Autos (Sample)",
    industry: "Auto repair",
    area: "Wuse, Abuja",
    phone: "conflicting",
    email: "missing",
    website: "missing",
    score: 55,
  },
  {
    name: "Green Leaf Pharmacy (Sample)",
    industry: "Pharmacy",
    area: "GRA, Port Harcourt",
    phone: "unverified",
    email: "verified",
    website: "expired",
    score: 47,
  },
];

/** Figure wrapper: inert mock plus a visible-to-AT caption stating it is sample data. */
export function MockFigure({
  caption,
  children,
  className,
  frameClassName,
  ...rest
}: {
  caption: string;
  children: React.ReactNode;
  className?: string;
  frameClassName?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <figure className={cn("min-w-0", className)} {...rest}>
      <div inert className={cn("@container min-w-0 select-none", frameClassName)}>
        {children}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

export function SampleBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("bg-surface h-5 px-2 text-[11px]", className)}>
      Sample data
    </Badge>
  );
}

/** The app frame: tinted shell plane, top app bar with search, rail, rounded content panel. */
export function AppFrameMock({
  children,
  active = "Businesses",
  className,
  showRail = true,
}: {
  children: React.ReactNode;
  active?: string;
  className?: string;
  showRail?: boolean;
}) {
  const rail = [
    { icon: Home, label: "Overview" },
    { icon: Building2, label: "Businesses" },
    { icon: Compass, label: "Discovery" },
    { icon: ListChecks, label: "Lists" },
    { icon: Kanban, label: "Pipeline" },
    { icon: Users, label: "Team" },
    { icon: Settings, label: "Settings" },
  ];
  return (
    <div className={cn("bg-surface-tint flex min-w-0 flex-col rounded-[inherit]", className)}>
      <div className="@2xl:h-14 @2xl:px-4 flex h-11 min-w-0 items-center gap-2 px-3">
        <span className="bg-primary text-primary-foreground @2xl:size-7 flex size-6 shrink-0 items-center justify-center rounded-[7px]">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden>
            <path
              d="M7 5.5v9.25A3.25 3.25 0 0 0 10.25 18H17"
              stroke="currentColor"
              strokeWidth="2.8"
              strokeLinecap="round"
            />
            <circle cx="16.25" cy="8.25" r="2.75" fill="currentColor" />
          </svg>
        </span>
        <span className="@md:inline hidden text-sm font-medium">LeadForge</span>
        <span className="bg-surface-container-high text-muted-foreground @lg:flex @2xl:h-9 mx-auto hidden h-8 w-full min-w-0 max-w-sm items-center gap-2 rounded-full px-3 text-xs">
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Search businesses, lists and jobs</span>
        </span>
        <span className="bg-secondary text-secondary-foreground @xl:flex ml-auto hidden h-7 items-center rounded-full px-3 text-[11px] font-medium">
          Agency workspace (Sample)
        </span>
        <span className="bg-primary-container text-primary-container-foreground @xl:ml-0 ml-auto flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
          AO
        </span>
      </div>
      <div className="@2xl:px-3 @2xl:pb-3 flex min-w-0 flex-1 gap-2 px-2 pb-2">
        {showRail ? (
          <div className="@3xl:flex hidden w-14 shrink-0 flex-col items-center gap-1 pt-1">
            {rail.map(({ icon: Icon, label }) => (
              <div key={label} className="flex w-full flex-col items-center gap-0.5 py-1">
                <span
                  className={cn(
                    "flex h-7 w-11 items-center justify-center rounded-full",
                    label === active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <span
                  className={cn(
                    "text-[9px]",
                    label === active ? "text-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="bg-surface @2xl:rounded-[18px] min-w-0 flex-1 rounded-[14px]">
          {children}
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="bg-surface-container-highest @2xl:block relative hidden h-1.5 w-14 overflow-hidden rounded-full">
        <span
          className="bg-primary absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="text-foreground w-6 text-right tabular-nums">{value}</span>
    </span>
  );
}

/** Business directory: filter chips, rows with field states and fit score, source footer. */
export function DirectoryMock({
  rows = SAMPLE_BUSINESSES,
  compact = false,
}: {
  rows?: typeof SAMPLE_BUSINESSES;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="@2xl:p-5 flex min-w-0 flex-col gap-3 p-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="@2xl:text-lg truncate text-sm font-normal leading-tight">Businesses</p>
            <p className="text-muted-foreground @2xl:text-xs truncate text-[11px]">
              5 records (Sample)
            </p>
          </div>
          <SampleBadge />
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {["Lagos", "Bakery, Dental, Laundry", "Has phone"].map((c, i) => (
            <span
              key={c}
              className={cn(
                "inline-flex h-6 max-w-full items-center truncate rounded-full border px-2.5 text-[11px] font-medium",
                i === 0
                  ? "bg-secondary text-secondary-foreground border-transparent"
                  : "border-border-strong text-muted-foreground",
                i === 1 && "@md:inline-flex hidden",
              )}
            >
              {c}
            </span>
          ))}
        </div>
      </div>
      {/* Wide: table rows. Narrow: stacked cards, like the real DataTable mobile layout. */}
      <div className="@xl:block hidden min-w-0">
        <div className="bg-surface-container-low text-muted-foreground border-border @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)] gap-3 border-y px-5 py-2 text-[11px] font-medium">
          <span>Business</span>
          <span className="@3xl:block hidden">Location</span>
          <span>Phone</span>
          <span>Email</span>
          <span className="text-right">Fit</span>
        </div>
        {rows.slice(0, compact ? 3 : rows.length).map((r, i) => (
          <div
            key={r.name}
            className={cn(
              "border-border @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)] items-center gap-3 border-b px-5 py-2.5 text-xs",
              i === 0 && "bg-primary-subtle",
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{r.name}</span>
              <span className="text-muted-foreground truncate text-[11px]">{r.industry}</span>
            </span>
            <span className="text-muted-foreground @3xl:block hidden truncate">{r.area}</span>
            <FieldStatus state={r.phone} size="sm" />
            <FieldStatus state={r.email} size="sm" />
            <ScoreBar value={r.score} />
          </div>
        ))}
      </div>
      <ul className="@xl:hidden flex min-w-0 flex-col gap-2 px-3 pb-1">
        {rows.slice(0, 3).map((r) => (
          <li
            key={r.name}
            className="border-border flex min-w-0 flex-col gap-1.5 rounded-xl border p-2.5"
          >
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-xs font-medium">{r.name}</span>
              <span className="text-xs tabular-nums">{r.score}</span>
            </span>
            <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              <FieldStatus state={r.phone} size="sm" label={`Phone ${FIELD_LABEL[r.phone]}`} />
              <FieldStatus state={r.email} size="sm" label={`Email ${FIELD_LABEL[r.email]}`} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground @2xl:px-5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-3 text-[11px]">
        <Database className="size-3.5 shrink-0" aria-hidden />
        <span>Sources: official places API, business websites. Collected 12 Oct 2026 (Sample)</span>
      </p>
    </div>
  );
}

const FIELD_LABEL: Record<FieldState, string> = {
  verified: "verified",
  unverified: "unverified",
  stale: "stale",
  expired: "expired",
  missing: "missing",
  conflicting: "conflicting",
};

/** Field provenance panel: value, state, and the observations behind it. */
export function ProvenanceMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-surface-elevated shadow-3 flex min-w-0 flex-col gap-3 rounded-2xl p-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[11px]">Phone (Sample)</p>
          <p className="truncate font-mono text-[13px]">+234 801 ••• 0142</p>
        </div>
        <FieldStatus state="verified" variant="badge" size="sm" />
      </div>
      <Timeline
        density="compact"
        items={[
          {
            id: "a",
            title: "Observed on the business website",
            timestamp: "2026-10-12T09:14:00Z",
            timestampLabel: "12 Oct",
            meta: "tel: link on /contact (Sample)",
            icon: Globe,
            tone: "primary",
          },
          {
            id: "b",
            title: "Matched official places API",
            timestamp: "2026-10-12T09:02:00Z",
            timestampLabel: "12 Oct",
            meta: "Confidence 0.92 (Sample)",
            icon: Database,
            tone: "neutral",
          },
          {
            id: "c",
            title: "Parsed as a valid Nigerian mobile number",
            timestamp: "2026-10-12T09:15:00Z",
            timestampLabel: "12 Oct",
            icon: ShieldCheck,
            tone: "success",
          },
        ]}
      />
    </div>
  );
}

/** Discovery job wizard: stepper, job definition and the credit estimate before anything runs. */
export function JobWizardMock() {
  return (
    <div className="@2xl:gap-5 @2xl:p-6 flex min-w-0 flex-col gap-4 p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="@2xl:text-lg truncate text-sm">New discovery job</p>
        <SampleBadge />
      </div>
      <div className="@lg:block hidden">
        <Stepper
          orientation="horizontal"
          current={2}
          steps={[
            { id: "where", label: "Where" },
            { id: "what", label: "What" },
            { id: "review", label: "Review" },
          ]}
        />
      </div>
      <dl className="@md:grid-cols-2 grid min-w-0 grid-cols-1 gap-2">
        {[
          ["Location", "Ikeja, Lagos (Sample)"],
          ["Industry", "Bakeries (Sample)"],
          ["Sources", "Official places API"],
          ["Record limit", "200"],
        ].map(([k, v]) => (
          <div key={k} className="border-input flex min-w-0 flex-col rounded-lg border px-3 py-2">
            <dt className="text-muted-foreground text-[11px]">{k}</dt>
            <dd className="truncate text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="bg-primary-subtle @md:flex-row @md:items-center @md:justify-between flex min-w-0 flex-col gap-1 rounded-xl p-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Estimate: up to 200 credits</p>
          <p className="text-muted-foreground text-[11px]">
            Reserved when queued. Settled against records produced.
          </p>
        </div>
        <span className="bg-primary text-primary-foreground @md:self-auto inline-flex h-8 shrink-0 items-center self-start rounded-full px-4 text-xs font-medium">
          Create discovery job
        </span>
      </div>
    </div>
  );
}

/** A running job with per-source outcomes. */
export function JobProgressMock({
  state = "running" as const,
}: {
  state?: "running" | "completed_with_warnings";
}) {
  const running = state === "running";
  return (
    <div className="@2xl:p-6 flex min-w-0 flex-col gap-4 p-4">
      <div className="@md:flex-row @md:items-center @md:justify-between flex min-w-0 flex-col gap-1">
        <p className="@2xl:text-lg truncate text-sm">Bakeries in Ikeja (Sample)</p>
        <JobStatus state={state} variant="badge" size="sm" />
      </div>
      <Progress
        label="Job progress"
        value={running ? 132 : 200}
        max={200}
        showLabel
        valueText={running ? "132 of 200 records" : "200 of 200 records"}
      />
      <div className="@lg:grid-cols-4 grid min-w-0 grid-cols-2 gap-2">
        {[
          ["Created", running ? "96" : "141"],
          ["Updated", running ? "21" : "33"],
          ["Duplicates", running ? "11" : "19"],
          ["Failed", running ? "4" : "7"],
        ].map(([k, v]) => (
          <div
            key={k}
            className="bg-surface-container-low flex min-w-0 flex-col rounded-lg px-3 py-2"
          >
            <span className="text-muted-foreground text-[11px]">{k}</span>
            <span className="text-lg tabular-nums">{v}</span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-[11px]">
        {running
          ? "Per-source rate limits applied. Cancel at any time."
          : "7 items failed. Retry only the failed items."}{" "}
        (Sample)
      </p>
    </div>
  );
}

const SIGNALS = [
  ["Contact completeness", 20, 0.75],
  ["Contact verification", 15, 0.67],
  ["Website opportunity", 20, 0.9],
  ["Industry match", 15, 1],
  ["Location match", 15, 1],
  ["Freshness", 10, 0.8],
  ["Source reliability", 5, 0.6],
] as const;

/** Fit score with its signal-by-signal explanation. */
export function ScoreBreakdownMock({ rows = 7 }: { rows?: number }) {
  return (
    <div className="@2xl:p-6 flex min-w-0 flex-col gap-4 p-4">
      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">Fit score (Sample)</p>
          <p className="text-4xl font-normal leading-none tracking-[-0.02em]">82</p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground text-xs">Data confidence</p>
          <p className="text-lg">High (Sample)</p>
        </div>
      </div>
      <ul className="flex min-w-0 flex-col gap-2.5">
        {SIGNALS.slice(0, rows).map(([label, weight, signal]) => (
          <li key={label} className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 justify-between gap-2 text-xs">
              <span className="truncate">{label}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {Math.round(weight * signal)} / {weight}
              </span>
            </span>
            <span className="bg-surface-container-highest relative h-1.5 overflow-hidden rounded-full">
              <span
                className="bg-primary absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${signal * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground border-border border-t pt-3 text-[11px]">
        Score reflects fit with your configured criteria. It is not a prediction of purchase intent.
      </p>
    </div>
  );
}

/** Contact field cards for the enrichment tabs. */
export function ContactFieldMock({ kind }: { kind: "phone" | "email" | "website" | "whatsapp" }) {
  const data = {
    phone: {
      icon: Phone,
      label: "Phone",
      raw: "0801 ••• 0142",
      value: "+234 801 ••• 0142",
      state: "verified" as FieldState,
      method: "Parsed as a valid Nigerian mobile number and observed on the business's own site",
      source: "Business website, /contact",
    },
    email: {
      icon: Mail,
      label: "Email",
      raw: "Hello@Corner-Bakery.example",
      value: "hello@corner-bakery.example",
      state: "unverified" as FieldState,
      method: "Syntax valid and MX records found. Mailbox not confirmed",
      source: "Official places API",
    },
    website: {
      icon: Globe,
      label: "Website",
      raw: "http://corner-bakery.example/home",
      value: "corner-bakery.example",
      state: "stale" as FieldState,
      method: "Last reachable 212 days ago, older than the 180-day freshness window",
      source: "Official places API",
    },
    whatsapp: {
      icon: MessageCircle,
      label: "WhatsApp",
      raw: "wa.me link on the home page",
      value: "Confirmed",
      state: "verified" as FieldState,
      method:
        "Explicit wa.me link on the business's own website. Never inferred from a phone number",
      source: "Business website, /",
    },
  }[kind];
  const Icon = data.icon;
  return (
    <div className="@2xl:p-6 flex min-w-0 flex-col gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="bg-primary-container text-primary-container-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs">{data.label} (Sample)</p>
          <p className="break-anywhere font-mono text-sm">{data.value}</p>
        </div>
        <span className="@sm:block hidden">
          <FieldStatus state={data.state} variant="badge" size="sm" />
        </span>
      </div>
      <span className="@sm:hidden">
        <FieldStatus state={data.state} variant="badge" size="sm" />
      </span>
      <dl className="@md:grid-cols-2 grid min-w-0 grid-cols-1 gap-3 text-xs">
        <div className="bg-surface-container-low min-w-0 rounded-lg p-3">
          <dt className="text-muted-foreground">As observed</dt>
          <dd className="break-anywhere mt-0.5 font-mono">{data.raw}</dd>
        </div>
        <div className="bg-surface-container-low min-w-0 rounded-lg p-3">
          <dt className="text-muted-foreground">Source</dt>
          <dd className="mt-0.5">{data.source}</dd>
        </div>
        <div className="bg-surface-container-low @md:col-span-2 min-w-0 rounded-lg p-3">
          <dt className="text-muted-foreground">Verification</dt>
          <dd className="mt-0.5">{data.method}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Pipeline board with sample leads. */
export function PipelineMock() {
  const columns = [
    { title: "New", items: ["Corner Bakery (Sample)", "Green Leaf Pharmacy (Sample)"] },
    { title: "Qualified", items: ["Bright Smile Dental (Sample)"] },
    { title: "Contacted", items: ["Fresh Fold Laundry (Sample)"] },
  ];
  return (
    <div className="@2xl:p-6 flex min-w-0 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="@2xl:text-lg truncate text-sm">Lead pipeline</p>
        <SampleBadge />
      </div>
      <div className="@md:grid-cols-3 grid min-w-0 grid-cols-1 gap-2">
        {columns.map((col, ci) => (
          <div
            key={col.title}
            className={cn(
              "bg-surface-container-low flex min-w-0 flex-col gap-2 rounded-xl p-2",
              ci > 0 && "@md:flex hidden",
            )}
          >
            <p className="text-muted-foreground px-1 text-[11px] font-medium">
              {col.title} <span className="tabular-nums">{col.items.length}</span>
            </p>
            {col.items.map((item) => (
              <div key={item} className="bg-surface flex min-w-0 flex-col gap-1.5 rounded-lg p-2.5">
                <span className="truncate text-xs font-medium">{item}</span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="text-muted-foreground truncate text-[11px]">
                    Owner: Ada (Sample)
                  </span>
                  <span className="bg-primary-container text-primary-container-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium">
                    AO
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-[11px]">
        Call logged 14 Oct, WhatsApp message 15 Oct (Sample)
      </p>
    </div>
  );
}

/** Audit log rows. */
export function AuditMock() {
  const rows = [
    ["Export created", "Ada (Owner)", "250 rows"],
    ["Member invited", "Tunde (Admin)", "Researcher role"],
    ["Removal request honoured", "System", "1 business suppressed"],
  ];
  return (
    <div className="@2xl:p-5 flex min-w-0 flex-col p-4">
      <p className="mb-3 text-[13px] font-medium">Audit log (Sample)</p>
      <ul className="flex min-w-0 flex-col">
        {rows.map(([a, b, c]) => (
          <li
            key={a}
            className="border-border flex min-w-0 flex-col gap-0.5 border-t py-2.5 text-xs"
          >
            <span className="font-medium">{a}</span>
            <span className="text-muted-foreground truncate">
              {b} · {c}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tenant isolation: two workspaces, a blocked cross-organization request. */
export function IsolationMock() {
  return (
    <div className="@2xl:p-5 flex min-w-0 flex-col gap-3 p-4">
      {["Agency workspace (Sample)", "Clinic group workspace (Sample)"].map((w, i) => (
        <div
          key={w}
          className="border-border flex min-w-0 items-center gap-3 rounded-xl border p-3"
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              i === 0
                ? "bg-primary-container text-primary-container-foreground"
                : "bg-tertiary-container text-tertiary-container-foreground",
            )}
          >
            <Building2 className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{w}</span>
            <span className="text-muted-foreground block truncate text-[11px]">
              org_{i === 0 ? "7f3a" : "c91e"}… (Sample)
            </span>
          </span>
        </div>
      ))}
      <div className="bg-destructive-subtle flex min-w-0 items-start gap-2 rounded-xl p-3 text-xs">
        <ShieldCheck className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0">Cross-organization read blocked at the data layer (Sample)</span>
      </div>
    </div>
  );
}
