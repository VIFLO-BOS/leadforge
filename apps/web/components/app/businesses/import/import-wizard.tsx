"use client";

import type { ImportJob, ImportPreviewResponse } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FadeIn,
  LiveAnnouncement,
  PageHeader,
  Skeleton,
  type StepItem,
  Stepper,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { isPendingDeletion } from "@/lib/org-lifecycle";
import { PendingDeletionNotice } from "@/components/app/pending-deletion-notice";
import { plural } from "@/lib/format";
import {
  isImportActive,
  useCommitImport,
  useImportJob,
  usePreviewImport,
} from "@/lib/hooks/use-imports";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { queryKeys } from "@/lib/query-keys";
import { renderBreadcrumbLink } from "../shared";
import {
  MappingStep,
  entriesFromMapping,
  mappingFromEntries,
  type ColumnMapping,
} from "./mapping-step";
import { RecentImports } from "./recent-imports";
import { ProgressStep, ResultsStep } from "./results-step";
import { ReviewStep } from "./review-step";
import { UploadStep } from "./upload-step";
import { IMPORT_STATUS_LABELS } from "@/lib/labels";

/** Rows the preview validates (the API allows up to 200). */
export const PREVIEW_ROWS = 100;

interface ImportUrl {
  id: string | null;
  step: "review" | null;
}

const parseUrl = (p: URLSearchParams): ImportUrl => {
  const id = p.get("id");
  return {
    id: id && /^[a-f0-9]{24}$/i.test(id) ? id : null,
    step: p.get("step") === "review" ? "review" : null,
  };
};
const serializeUrl = (s: ImportUrl) => {
  const out = new URLSearchParams();
  if (s.id) out.set("id", s.id);
  if (s.id && s.step) out.set("step", s.step);
  return out;
};

const STEPS: StepItem[] = [
  { id: "upload", label: "Upload" },
  { id: "map", label: "Map columns" },
  { id: "review", label: "Check rows" },
  { id: "import", label: "Import" },
  { id: "results", label: "Results" },
];

const STEP_TEXT = [
  {
    title: "Upload a CSV file",
    description: "Rows stay staged and nothing is imported until you confirm.",
  },
  {
    title: "Map columns to business fields",
    description:
      "We suggested a mapping from the column headers. Check it and change anything that is wrong.",
  },
  {
    title: "Check rows before importing",
    description:
      "Each row is normalized and checked against your existing businesses. Nothing has been imported yet.",
  },
  { title: "Importing", description: "Progress updates every few seconds from the worker." },
  { title: "Import results", description: "What happened to every row." },
];

function stepFor(job: ImportJob | undefined, url: ImportUrl, hasPreview: boolean): number {
  if (!url.id) return 0;
  if (!job) return 1;
  if (job.status === "uploaded") return url.step === "review" && hasPreview ? 2 : 1;
  if (isImportActive(job)) return 3;
  return 4;
}

/**
 * CSV import (/app/businesses/import): upload, column mapping, row check, commit (202), live
 * progress and results. The import id lives in the URL (`?id=`), so a refresh or a shared link
 * resumes an in-progress import or reopens its results.
 */
export function ImportWizard() {
  const { org } = useWorkspace();
  const { canWriteBusinesses } = usePermissions();
  const queryClient = useQueryClient();
  const [url, setUrl] = useUrlState(parseUrl, serializeUrl);
  const job = useImportJob(url.id);
  const preview = usePreviewImport(url.id ?? "");
  const commit = useCommitImport(url.id ?? "");

  const [mapping, setMapping] = useState<{ id: string; value: ColumnMapping } | null>(null);
  const [country, setCountry] = useState(org.country ?? "NG");
  const [previewData, setPreviewData] = useState<{
    id: string;
    data: ImportPreviewResponse;
  } | null>(null);
  const [attested, setAttested] = useState(false);

  const jobData = job.data && job.data.id === url.id ? job.data : undefined;

  // Seed the mapping from the saved draft (or the API's suggestion) when an import loads.
  useEffect(() => {
    if (!jobData || mapping?.id === jobData.id) return;
    setMapping({
      id: jobData.id,
      value: mappingFromEntries(
        jobData.headers.length,
        jobData.mapping ?? jobData.suggestedMapping,
      ),
    });
    if (jobData.defaultCountry) setCountry(jobData.defaultCountry);
  }, [jobData, mapping?.id]);

  const currentPreview = previewData && previewData.id === url.id ? previewData.data : null;
  const step = stepFor(jobData, url, Boolean(currentPreview));

  // After a step change (not on first load) the old step's controls unmount, so focus would fall
  // to <body>. Move it to the new step's heading, unless the user has focused something else.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const previousStep = useRef<number | null>(null);
  useEffect(() => {
    if (previousStep.current !== null && previousStep.current !== step) {
      const active = document.activeElement;
      if (!active || active === document.body || cardRef.current?.contains(active)) {
        titleRef.current?.focus();
      }
    }
    previousStep.current = step;
  }, [step]);

  const columnMapping = mapping && mapping.id === url.id ? mapping.value : [];

  const startOver = () => {
    setUrl({ id: null, step: null }, { push: true });
    setPreviewData(null);
    setAttested(false);
    preview.reset();
    commit.reset();
  };

  const runPreview = () => {
    if (!url.id) return;
    preview.mutate(
      { mapping: entriesFromMapping(columnMapping), defaultCountry: country, limit: PREVIEW_ROWS },
      {
        onSuccess: (data) => {
          setPreviewData({ id: url.id ?? "", data });
          setAttested(false);
          setUrl({ id: url.id, step: "review" }, { push: true });
        },
      },
    );
  };

  const runCommit = () => {
    if (!url.id || !attested) return;
    commit.mutate(
      {
        mapping: entriesFromMapping(columnMapping),
        defaultCountry: country,
        attestLawfulBasis: true,
      },
      {
        onSuccess: () => setUrl({ id: url.id, step: null }),
        onError: (err) => {
          // Already committed (another tab or a double click): show the live status instead.
          if (isApiError(err) && err.code === "CONFLICT" && url.id) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.imports.detail(org.id, url.id),
            });
          }
        },
      },
    );
  };

  const header = (
    <PageHeader
      breadcrumbs={
        <Breadcrumbs
          items={[{ label: "Businesses", href: "/app/businesses" }, { label: "Import CSV" }]}
          renderLink={renderBreadcrumbLink}
        />
      }
      title="Import businesses"
      description="Upload a CSV, map its columns, check the rows, then import. Every imported value is recorded with this import as its source."
    />
  );

  if (!canWriteBusinesses && !url.id) {
    return (
      <div className="flex min-w-0 flex-col gap-8">
        {header}
        <EmptyState
          icon={FileUp}
          title="Your role cannot import businesses"
          description="Owners, administrators and researchers can import CSV files. You can still open the results of past imports below."
          action={
            <Button asChild variant="outline">
              <Link href="/app/businesses">
                <ArrowLeft aria-hidden /> Back to businesses
              </Link>
            </Button>
          }
        />
        <RecentImports />
      </div>
    );
  }

  let body: React.ReactNode;
  if (url.id && job.isPending) {
    body = (
      <div
        className="flex flex-col gap-3"
        role="status"
        aria-busy="true"
        aria-label="Loading import"
      >
        <Skeleton className="h-5 w-64 max-w-full" />
        <Skeleton className="h-40" />
      </div>
    );
  } else if (url.id && job.isError && !jobData) {
    const notFound =
      isApiError(job.error) && (job.error.status === 404 || job.error.status === 400);
    body = notFound ? (
      <EmptyState
        size="compact"
        icon={FileUp}
        title="Import not found"
        description="It may belong to another workspace, or its staged rows were removed after 30 days."
        action={<Button onClick={startOver}>Start a new import</Button>}
      />
    ) : (
      <ErrorState
        title="Could not load this import"
        message={friendlyMessage(job.error)}
        requestId={requestIdOf(job.error)}
        onRetry={() => void job.refetch()}
      />
    );
  } else if (step === 0) {
    body = (
      <UploadStep
        onUploaded={(j) => {
          setMapping({ id: j.id, value: mappingFromEntries(j.headers.length, j.suggestedMapping) });
          setPreviewData(null);
          setUrl({ id: j.id, step: null }, { push: true });
        }}
      />
    );
  } else if (jobData && step === 1) {
    body = canWriteBusinesses ? (
      <MappingStep
        job={jobData}
        mapping={columnMapping}
        onMappingChange={(value) => setMapping({ id: jobData.id, value })}
        defaultCountry={country}
        onDefaultCountryChange={setCountry}
        onBack={startOver}
        onContinue={runPreview}
        continuing={preview.isPending}
        previewRows={PREVIEW_ROWS}
        error={
          preview.isError ? (
            <ErrorState
              title="Could not check the rows"
              message={friendlyMessage(preview.error)}
              requestId={requestIdOf(preview.error)}
            />
          ) : null
        }
      />
    ) : (
      <EmptyState
        size="compact"
        icon={FileUp}
        title="Waiting for the column mapping"
        description="This file was uploaded but not imported yet. The person who uploaded it can finish the import."
      />
    );
  } else if (jobData && step === 2 && currentPreview) {
    body = (
      <ReviewStep
        job={jobData}
        preview={currentPreview}
        attested={attested}
        onAttestedChange={setAttested}
        onBack={() => setUrl({ id: jobData.id, step: null }, { push: true })}
        onCommit={runCommit}
        committing={commit.isPending}
        error={
          isPendingDeletion(commit.error) ? (
            <PendingDeletionNotice error={commit.error} outcome="No rows were imported." />
          ) : commit.isError && !(isApiError(commit.error) && commit.error.code === "CONFLICT") ? (
            <ErrorState
              title="Could not start the import"
              message={friendlyMessage(commit.error)}
              requestId={requestIdOf(commit.error)}
            />
          ) : null
        }
      />
    );
  } else if (jobData && step === 3) {
    body = <ProgressStep job={jobData} />;
  } else if (jobData && step === 4) {
    body = <ResultsStep job={jobData} onImportAnother={startOver} />;
  }

  const steps = STEPS.map((s, i) =>
    i === 3 && jobData?.status === "failed" ? { ...s, status: "error" as const } : s,
  );
  const canGoBack = jobData?.status === "uploaded" || !url.id;
  const text = STEP_TEXT[step] ?? STEP_TEXT[0];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {header}
      <Stepper
        aria-label="Import steps"
        collapseOnNarrow
        steps={steps}
        current={step}
        onStepSelect={
          canGoBack
            ? (i) => {
                if (i === 0) startOver();
                else if (i === 1 && url.id) setUrl({ id: url.id, step: null }, { push: true });
              }
            : undefined
        }
      />
      <Card ref={cardRef}>
        <CardHeader>
          <CardTitle ref={titleRef} tabIndex={-1} className="outline-none">
            {text?.title}
          </CardTitle>
          <CardDescription>
            {step === 3 && jobData
              ? `${jobData.fileName}: ${plural(jobData.rowCount, "row", "rows")}. ${text?.description ?? ""}`
              : text?.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FadeIn key={`${url.id ?? "new"}-${step}`} duration={0.45}>
            {body}
          </FadeIn>
        </CardContent>
      </Card>
      <LiveAnnouncement
        data-testid="import-live-region"
        message={
          jobData && step >= 3
            ? `Import ${IMPORT_STATUS_LABELS[jobData.status] ?? jobData.status}`
            : ""
        }
      />
      {step === 0 ? <RecentImports /> : null}
    </div>
  );
}
