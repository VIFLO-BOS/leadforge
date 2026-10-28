"use client";

import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  Database,
  FileUp,
  Globe,
  PencilLine,
  Receipt,
  SearchX,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CircularProgress,
  Code,
  CopyableValue,
  EmptyState,
  ErrorState,
  FIELD_STATE_META,
  FieldStatus,
  JOB_STATE_META,
  JobStatus,
  Kbd,
  PageHeader,
  Progress,
  Separator,
  Skeleton,
  Stat,
  StatusIndicator,
  Stepper,
  Timeline,
  initials,
  type FieldState,
  type JobState,
} from "@leadforge/ui";
import { Demo, GallerySection } from "./section";

export function StatusSection() {
  return (
    <GallerySection
      id="status"
      title="Badges and status"
      description="Status is always an icon plus text. Field states and job states have fixed icons and labels."
    >
      <Demo label="Badge">
        <Badge>Neutral</Badge>
        <Badge variant="primary">Owner</Badge>
        <Badge variant="success">Paid</Badge>
        <Badge variant="warning">Draft</Badge>
        <Badge variant="destructive">Overdue</Badge>
        <Badge variant="info">Beta</Badge>
        <Badge variant="outline">Coming soon</Badge>
      </Demo>
      <Demo label="Field states (inline)">
        {(Object.keys(FIELD_STATE_META) as FieldState[]).map((s) => (
          <FieldStatus key={s} state={s} />
        ))}
      </Demo>
      <Demo label="Field states (badge)">
        {(Object.keys(FIELD_STATE_META) as FieldState[]).map((s) => (
          <FieldStatus key={s} state={s} variant="badge" />
        ))}
      </Demo>
      <Demo label="Job states">
        {(Object.keys(JOB_STATE_META) as JobState[]).map((s) => (
          <JobStatus key={s} state={s} variant="badge" />
        ))}
      </Demo>
      <Demo label="StatusIndicator (generic tones)">
        <StatusIndicator tone="success" label="Active" />
        <StatusIndicator tone="warning" label="Suspended" />
        <StatusIndicator tone="destructive" label="Payment failed" />
        <StatusIndicator tone="info" label="Syncing" live />
        <StatusIndicator tone="neutral" label="Not started" size="sm" />
      </Demo>
    </GallerySection>
  );
}

export function SurfacesSection() {
  return (
    <GallerySection
      id="cards"
      title="Cards and stats"
      description="Tone separates layers first; outline second; shadow last."
    >
      <div className="grid min-w-0 grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Outlined</CardTitle>
            <CardDescription>Default dashboard card.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">Surface plus a decorative outline.</CardContent>
        </Card>
        <Card variant="filled">
          <CardHeader>
            <CardTitle>Filled</CardTitle>
            <CardDescription>Tonal container.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">No outline.</CardContent>
        </Card>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Elevated</CardTitle>
            <CardDescription>Level 1 shadow.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">For content over imagery.</CardContent>
        </Card>
        <Card
          variant="tonal"
          interactive
          tabIndex={0}
          role="group"
          aria-label="Interactive tonal card"
        >
          <CardHeader>
            <CardTitle>Tonal, interactive</CardTitle>
            <CardDescription>Hover lifts 2px.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button size="sm" variant="tonal">
              Action
            </Button>
          </CardFooter>
        </Card>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Discovered businesses (Sample)"
          value="1,284"
          icon={Building2}
          trend={{
            value: "+12%",
            direction: "up",
            sentiment: "positive",
            label: "vs last 30 days (Sample)",
          }}
          footnote="Sample value for the gallery"
        />
        <Stat
          label="Verified contacts (Sample)"
          value="642"
          icon={BadgeCheck}
          trend={{
            value: "-3%",
            direction: "down",
            sentiment: "negative",
            label: "vs last 30 days (Sample)",
          }}
        />
        <Stat
          label="Credits available"
          icon={Receipt}
          value={null}
          hint="Appears once billing is live."
        />
        <Stat label="Active discovery jobs" icon={Workflow} loading />
      </div>
    </GallerySection>
  );
}

export function StructureSection() {
  const [step, setStep] = useState(1);
  const steps = [
    { id: "area", label: "Area", description: "City or radius" },
    { id: "industry", label: "Industry", description: "Categories to find" },
    { id: "sources", label: "Sources", description: "Permitted sources" },
    { id: "review", label: "Review", description: "Cost estimate" },
  ];
  return (
    <GallerySection
      id="structure"
      title="Page structure"
      description="PageHeader, Breadcrumbs, Stepper and Timeline."
    >
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Workspace", href: "#structure" },
              { label: "Businesses", href: "#structure" },
              { label: "Adunni Bakery (Sample)" },
            ]}
            renderLink={(item, className) => (
              <Link href={item.href ?? "#"} className={className}>
                {item.label}
              </Link>
            )}
          />
        }
        eyebrow="Business"
        title="Adunni Bakery (Sample)"
        description="Bakery in Ikeja, Lagos. Sources: Places API (Sample), business website (Sample)."
        actions={
          <>
            <Button variant="outline">Add to list</Button>
            <Button>Analyze website</Button>
          </>
        }
      />
      <Separator />
      <Demo label="Stepper (discovery wizard)" className="flex-col items-stretch">
        <Stepper
          steps={steps}
          current={step}
          onStepSelect={setStep}
          aria-label="Create discovery job"
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </Button>
          <Button
            size="sm"
            disabled={step === steps.length - 1}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </Button>
        </div>
        <Stepper
          steps={[
            { id: "a", label: "Area" },
            { id: "b", label: "Industry" },
            { id: "c", label: "Sources", status: "error", description: "No source enabled" },
            { id: "d", label: "Review" },
          ]}
          current={2}
          orientation="vertical"
          aria-label="Vertical stepper example"
        />
      </Demo>
      <Demo label="Timeline (provenance)" className="flex-col items-stretch">
        <Timeline
          aria-label="Phone number provenance (Sample)"
          items={[
            {
              id: "t1",
              title: "Phone verified",
              timestamp: "2026-10-20T09:30:00Z",
              timestampLabel: "20 Oct 2026, 09:30",
              description:
                "+234 801 234 5678 (Sample) parsed as a valid Nigerian mobile number and seen on the business website.",
              meta: "Method: website match · Confidence 0.9 (Sample)",
              icon: BadgeCheck,
              tone: "success",
            },
            {
              id: "t2",
              title: "Observed on business website",
              timestamp: "2026-10-18T14:05:00Z",
              timestampLabel: "18 Oct 2026, 14:05",
              description: "Found in a tel: link on adunni-bakery.example/contact.",
              meta: "Source: Business website (Sample)",
              icon: Globe,
              tone: "primary",
            },
            {
              id: "t3",
              title: "Discovered",
              timestamp: "2026-10-12T08:00:00Z",
              timestampLabel: "12 Oct 2026, 08:00",
              meta: "Source: Places API (Sample) · Job DJ-0042 (Sample)",
              icon: Database,
            },
            {
              id: "t4",
              title: "Corrected by a team member",
              timestamp: "2026-10-10T11:00:00Z",
              timestampLabel: "10 Oct 2026, 11:00",
              description: "Name spelling updated.",
              meta: "Ada O. (Researcher, Sample)",
              icon: PencilLine,
              tone: "warning",
            },
          ]}
        />
      </Demo>
    </GallerySection>
  );
}

export function FeedbackSection() {
  const [dismissed, setDismissed] = useState(false);
  return (
    <GallerySection
      id="feedback"
      title="Feedback and states"
      description="Banners, progress, empty, error and loading states."
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Banner
          tone="destructive"
          title="Payment failed (Sample)"
          description="Your last subscription payment did not go through. Discovery is paused until billing is updated."
          actions={<Button size="sm">Update payment method</Button>}
        />
        <Banner
          tone="warning"
          title="Credits running low (Sample)"
          description="40 credits left. Jobs larger than your balance cannot be queued."
        />
        <Banner
          tone="success"
          title="Import finished (Sample)"
          description="212 rows imported, 3 skipped."
        />
        {dismissed ? (
          <Button
            variant="text"
            size="sm"
            className="self-start"
            onClick={() => setDismissed(false)}
          >
            Show dismissed banner
          </Button>
        ) : (
          <Banner
            tone="info"
            title="A source was updated"
            description="Coverage notes for the places source changed. Review them on the Sources page."
            onDismiss={() => setDismissed(true)}
          />
        )}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
        <Progress
          label="Discovery job progress (Sample)"
          value={120}
          max={500}
          valueText="120 of 500 records"
          showLabel
        />
        <Progress label="Waiting for the first page" showLabel />
        <Progress label="Credits used (Sample)" value={86} tone="warning" showLabel size="sm" />
        <div className="flex items-center gap-3 text-sm">
          <CircularProgress label="Loading" /> Indeterminate
          <CircularProgress label="Upload progress (Sample)" value={65} size={24} /> 65%
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <EmptyState
          icon={FileUp}
          title="No businesses yet"
          description="Import a CSV or run a discovery job to see businesses here."
          action={<Button>Import CSV</Button>}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <EmptyState
            size="compact"
            icon={SearchX}
            title="No results"
            description="No businesses match these filters."
            action={<Button variant="text">Clear filters</Button>}
          />
          <ErrorState
            message="The server could not complete the request."
            requestId="req_01HZX4K8S2SAMPLE"
            onRetry={() => {}}
          />
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        </div>
      </div>
    </GallerySection>
  );
}

export function ValuesSection() {
  return (
    <GallerySection
      id="values"
      title="Values and identity"
      description="Kbd, Code, CopyableValue and Avatar."
    >
      <Demo label="Kbd and Code">
        <span className="text-sm">
          Press <Kbd>/</Kbd> to search, <Kbd>Esc</Kbd> to close.
        </span>
        <span className="text-sm">
          Domain <Code>adunni-bakery.example</Code>
        </span>
      </Demo>
      <Demo label="CopyableValue (never truncated)" className="flex-col items-stretch">
        <CopyableValue
          value="org_01HZX4K8S2T5Q9W3E7R6Y1U0IP_SAMPLE_LONG_IDENTIFIER"
          label="organization ID"
        />
        <CopyableValue
          value="procurement.department@a-very-long-business-domain-name.example"
          label="email address"
          mono={false}
        />
      </Demo>
      <Demo label="Avatar">
        {["Ada Obi", "Tunde Bakare", "Zainab"].map((n, i) => (
          <Avatar key={n} size={i === 0 ? "sm" : i === 1 ? "md" : "lg"}>
            <AvatarFallback>{initials(n)}</AvatarFallback>
          </Avatar>
        ))}
      </Demo>
    </GallerySection>
  );
}
