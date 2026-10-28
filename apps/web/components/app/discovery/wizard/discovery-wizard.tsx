"use client";

import type { DiscoverySourceOption } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Compass } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PageHeader,
  Stepper,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { renderBreadcrumbLink } from "@/components/app/businesses/shared";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { retryAtFor, useCountdown } from "@/lib/hooks/use-countdown";
import {
  useCreateDiscoveryJob,
  useDiscoveryEstimate,
  useDiscoverySources,
} from "@/lib/hooks/use-discovery";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { queryKeys } from "@/lib/query-keys";
import { EstimateProblems, EstimateStep } from "./estimate-step";
import { LimitsStep } from "./limits-step";
import { CreateError, ReviewStep } from "./review-step";
import { SourceStep, unavailableReason } from "./source-step";
import { TargetStep } from "./target-step";
import {
  WIZARD_STEPS,
  defaultValues,
  fieldForPath,
  newIdempotencyKey,
  specFingerprint,
  stepOfField,
  suggestName,
  supportFor,
  toSpec,
  validateThrough,
  type StepErrors,
  type WizardField,
  type WizardStepId,
  type WizardValues,
} from "./wizard-model";

const STEP_IDS = WIZARD_STEPS.map((s) => s.id);

const parseStep = (p: URLSearchParams): number => {
  const i = STEP_IDS.indexOf(p.get("step") as WizardStepId);
  return i < 0 ? 0 : i;
};
const serializeStep = (i: number) =>
  new URLSearchParams(i <= 0 ? {} : { step: STEP_IDS[i] ?? "source" });

const STEP_TEXT: Record<WizardStepId, { title: string; description: string }> = {
  source: {
    title: "Choose where to search",
    description:
      "Only sources that can run right now can be selected. Each shows what it provides, the attribution its results need and how long its data may be kept.",
  },
  target: {
    title: "What to find, and where",
    description:
      "Add the business categories or keywords to search for and the place to search in.",
  },
  limits: {
    title: "Set limits",
    description: "The record limit caps the job and the credits held while it runs.",
  },
  estimate: {
    title: "Check the estimate",
    description:
      "What the job will ask each source for and the most it can cost. Nothing has run yet.",
  },
  review: {
    title: "Review and create",
    description: "Nothing runs until you create the job.",
  },
};

interface Draft {
  values: WizardValues;
  /** Idempotency key of the last submission and the spec it was sent with. */
  submission: { key: string; fingerprint: string } | null;
}

const draftKey = (orgId: string) => `lf.discoveryDraft.${orgId}`;

function readDraft(orgId: string): Draft {
  const empty: Draft = { values: defaultValues(), submission: null };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.sessionStorage.getItem(draftKey(orgId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const v = (parsed.values ?? {}) as Partial<WizardValues>;
    const base = defaultValues();
    const str = (x: unknown, d: string) => (typeof x === "string" ? x : d);
    const arr = (x: unknown, d: string[]) =>
      Array.isArray(x) && x.every((i) => typeof i === "string") ? (x as string[]) : d;
    return {
      values: {
        sources: arr(v.sources, base.sources),
        categories: arr(v.categories, base.categories),
        region: str(v.region, base.region),
        lga: str(v.lga, base.lga),
        locality: str(v.locality, base.locality),
        area: str(v.area, base.area),
        name: str(v.name, base.name),
        nameEdited: typeof v.nameEdited === "boolean" ? v.nameEdited : false,
        maxRecords: str(v.maxRecords, base.maxRecords),
        priorityFields: arr(
          v.priorityFields,
          base.priorityFields,
        ) as WizardValues["priorityFields"],
        confidence: v.confidence === "high" ? "high" : "standard",
        requireContact: typeof v.requireContact === "boolean" ? v.requireContact : true,
        domainsInclude: str(v.domainsInclude, ""),
        domainsExclude: str(v.domainsExclude, ""),
      },
      submission:
        parsed.submission &&
        typeof parsed.submission.key === "string" &&
        typeof parsed.submission.fingerprint === "string"
          ? parsed.submission
          : null,
    };
  } catch {
    return empty;
  }
}

function writeDraft(orgId: string, draft: Draft | null) {
  try {
    if (draft) window.sessionStorage.setItem(draftKey(orgId), JSON.stringify(draft));
    else window.sessionStorage.removeItem(draftKey(orgId));
  } catch {
    /* storage unavailable: the draft lasts for this visit only */
  }
}

/** Selected sources that cannot run (switched off or unconfigured since they were chosen). */
function sourceErrors(
  selected: string[],
  options: DiscoverySourceOption[] | undefined,
): StepErrors {
  if (!options) return {};
  for (const key of selected) {
    const option = options.find((o) => o.key === key);
    if (!option) return { sources: "A selected source is no longer offered. Choose another." };
    const reason = unavailableReason(option);
    if (reason) return { sources: `${option.name} cannot run: ${reason}` };
  }
  return {};
}

const FIELD_INPUT_ID: Partial<Record<WizardField, string>> = {
  categories: "discovery-category",
  region: "discovery-region",
  lga: "discovery-lga",
  locality: "discovery-locality",
  area: "discovery-area",
  name: "discovery-name",
  maxRecords: "discovery-max-records",
  domainsInclude: "discovery-domains-include",
  domainsExclude: "discovery-domains-exclude",
};

/**
 * Discovery job wizard (/app/discovery/new): source, what to find, limits, estimate, review. Built
 * on the import wizard's pattern: a page (not a dialog), the step in the URL so the back button
 * moves between steps, `Stepper collapseOnNarrow` above one Card per step, step content entering
 * with FadeIn. Inputs are kept as a session draft so a refresh resumes. Every step validates the
 * request with the contracts' DiscoveryJobSpec; nothing about the sources is hard-coded.
 */
export function DiscoveryWizard() {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  const canRun = can("discovery:run");
  const router = useRouter();
  const queryClient = useQueryClient();
  const country = org.country || "NG";
  const [requestedStep, setStep] = useUrlState(parseStep, serializeStep);
  const sources = useDiscoverySources();
  const [draft, setDraft] = useState<Draft>(() => readDraft(org.id));
  const values = draft.values;
  const [errors, setErrors] = useState<StepErrors>({});
  const [createErrorAt, setCreateErrorAt] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<number | null>(null);
  const autoSelected = useRef(false);
  // True once the source list arrived and any preselection is applied; the step clamp waits for it.
  const [sourcesSettled, setSourcesSettled] = useState(false);
  const create = useCreateDiscoveryJob();

  useEffect(() => writeDraft(org.id, draft), [org.id, draft]);

  const suggestedName = suggestName(values);
  const selectedSources = useMemo(
    () => (sources.data ?? []).filter((s) => values.sources.includes(s.key)),
    [sources.data, values.sources],
  );
  const support = useMemo(() => supportFor(selectedSources), [selectedSources]);

  const update = useCallback(<K extends keyof WizardValues>(field: K, value: WizardValues[K]) => {
    setDraft((d) => {
      const next = { ...d.values, [field]: value };
      // The name follows the categories and place until the user writes their own.
      if (!next.nameEdited && field !== "name" && field !== "nameEdited") {
        next.name = suggestName(next);
      }
      return { ...d, values: next };
    });
    setErrors((e) => (e[field as WizardField] ? { ...e, [field]: undefined } : e));
  }, []);

  // One runnable source and nothing chosen yet: preselect it (once), so the common case is one click.
  useEffect(() => {
    if (autoSelected.current || !sources.data) return;
    autoSelected.current = true;
    const runnable = sources.data.filter((s) => s.runnable);
    if (runnable.length === 1 && values.sources.length === 0) update("sources", [runnable[0]!.key]);
    setSourcesSettled(true);
  }, [sources.data, values.sources.length, update]);

  const errorsThrough = useCallback(
    (index: number): StepErrors => ({
      ...validateThrough(index, values, country, support),
      ...(index >= 0 ? sourceErrors(values.sources, sources.data) : {}),
    }),
    [values, country, sources.data, support],
  );

  // A deep link or refresh cannot land past the first step that is not complete yet.
  const firstBlocked = useMemo(() => {
    for (let i = 0; i < requestedStep; i++) {
      const own = Object.keys(errorsThrough(i)) as WizardField[];
      if (own.some((f) => stepOfField(f) === i)) return i;
    }
    return -1;
  }, [requestedStep, errorsThrough]);
  const step = firstBlocked >= 0 && sourcesSettled ? firstBlocked : requestedStep;
  useEffect(() => {
    if (firstBlocked >= 0 && sourcesSettled) setStep(firstBlocked);
  }, [firstBlocked, setStep, sourcesSettled]);

  // Move focus to the step heading after a step change (not on first load).
  useEffect(() => {
    if (previousStep.current !== null && previousStep.current !== step) titleRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  const specValid = Object.keys(validateThrough(2, values, country, support)).length === 0;
  const spec = useMemo(
    () => (specValid ? toSpec(values, country, support) : null),
    [specValid, values, country, support],
  );
  const estimate = useDiscoveryEstimate(step >= 3 ? spec : null);
  const estimateData = estimate.data;
  const estimateRetryIn = useCountdown(retryAtFor(estimate.error, estimate.errorUpdatedAt));
  const createRetryIn = useCountdown(retryAtFor(create.error, createErrorAt));

  const goTo = (index: number) => {
    setErrors({});
    setStep(index, { push: true });
  };

  const focusField = (field: WizardField) => {
    const id = FIELD_INPUT_ID[field];
    window.setTimeout(() => {
      const el = id ? document.getElementById(id) : null;
      (el ?? titleRef.current)?.focus();
    }, 50);
  };

  const next = () => {
    const found = errorsThrough(step);
    const fields = Object.keys(found).filter((k) => found[k as WizardField]) as WizardField[];
    if (fields.length) {
      setErrors(found);
      const firstStep = Math.min(...fields.map(stepOfField));
      if (firstStep !== step) setStep(firstStep, { push: true });
      // Focus the first invalid field on screen (FIELD_INPUT_ID lists fields in display order).
      const order = Object.keys(FIELD_INPUT_ID);
      const rank = (f: WizardField) => (order.includes(f) ? order.indexOf(f) : order.length);
      const first = fields
        .filter((f) => stepOfField(f) === firstStep)
        .sort((a, b) => rank(a) - rank(b))[0];
      if (first) focusField(first);
      return;
    }
    goTo(step + 1);
  };

  const blocked =
    !estimateData ||
    estimateData.blockers.length > 0 ||
    !estimateData.credits.sufficient ||
    !estimateData.estimateAvailable;

  const submit = () => {
    if (!spec || blocked || create.isPending || createRetryIn > 0) return;
    const fingerprint = specFingerprint(spec);
    // One key per submission of this spec: a retry after a network failure replays it (the API
    // returns the same job); any change to the spec gets a new key.
    const key =
      draft.submission?.fingerprint === fingerprint ? draft.submission.key : newIdempotencyKey();
    setDraft((d) => ({ ...d, submission: { key, fingerprint } }));
    create.mutate(
      { spec, idempotencyKey: key },
      {
        onSuccess: (job) => {
          writeDraft(org.id, null);
          toast.success("Discovery job created", {
            description: "It is queued. Progress appears on the job page.",
          });
          router.push(`/app/discovery/${job.id}`);
        },
        onError: (err) => {
          setCreateErrorAt(Date.now());
          if (!isApiError(err)) return;
          if (err.code === "CONFLICT") {
            setDraft((d) => ({ ...d, submission: null }));
          } else if (err.code === "VALIDATION_FAILED") {
            const mapped: StepErrors = {};
            for (const d of err.details ?? []) {
              if (d.path.toLowerCase() === "idempotency-key") {
                setDraft((dr) => ({ ...dr, submission: null }));
                continue;
              }
              const segments = d.path.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
              const { field, prefix = "" } = fieldForPath(segments);
              if (!mapped[field]) mapped[field] = `${prefix}${d.message}`;
            }
            const fields = Object.keys(mapped) as WizardField[];
            if (fields.length) {
              setErrors(mapped);
              const firstStep = Math.min(...fields.map(stepOfField));
              setStep(firstStep, { push: true });
              toast.error("Some details need attention", {
                description: "The fields that need a change are marked.",
              });
            }
          } else if (err.code === "SOURCE_NOT_CONFIGURED" || err.code === "SOURCE_DISABLED") {
            void queryClient.invalidateQueries({ queryKey: queryKeys.discovery.sources(org.id) });
            void estimate.refetch();
          } else if (
            err.code === "INSUFFICIENT_CREDITS" ||
            err.code === "CREDIT_BALANCE_NEGATIVE" ||
            err.code === "ENTITLEMENT_REQUIRED"
          ) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.credits.all(org.id) });
            void estimate.refetch();
          }
        },
      },
    );
  };

  const header = (
    <PageHeader
      breadcrumbs={
        <Breadcrumbs
          items={[{ label: "Discovery", href: "/app/discovery" }, { label: "New job" }]}
          renderLink={renderBreadcrumbLink}
        />
      }
      title="Create a discovery job"
      description="Search the sources enabled for this workspace for businesses in a category and a place. You see the estimate before anything runs, and only records the job produces are charged."
    />
  );

  if (!canRun) {
    return (
      <div className="flex min-w-0 flex-col gap-8">
        {header}
        <EmptyState
          icon={Compass}
          title="Your role cannot create discovery jobs"
          description="Owners, administrators and researchers can create discovery jobs. You can still follow existing jobs and their results."
          action={
            <Button asChild variant="outline">
              <Link href="/app/discovery">
                <ArrowLeft aria-hidden /> Back to discovery jobs
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const stepId = STEP_IDS[step] ?? "source";
  const text = STEP_TEXT[stepId];
  const noneRunnable = sources.data ? !sources.data.some((s) => s.runnable) : false;

  let body: React.ReactNode = null;
  if (stepId === "source") {
    body = (
      <SourceStep
        sources={sources.data}
        loading={sources.isPending}
        error={sources.isError ? sources.error : null}
        onRetry={() => void sources.refetch()}
        selected={values.sources}
        onToggle={(key, on) =>
          update(
            "sources",
            on
              ? [...values.sources.filter((k) => k !== key), key]
              : values.sources.filter((k) => k !== key),
          )
        }
        fieldError={errors.sources}
        canManageSources={can("settings:sources")}
      />
    );
  } else if (stepId === "target") {
    body = (
      <TargetStep
        values={values}
        errors={errors}
        country={country}
        support={support}
        onChange={update}
        suggestedName={suggestedName}
      />
    );
  } else if (stepId === "limits") {
    body = (
      <LimitsStep
        values={values}
        errors={errors}
        onChange={update}
        selectedSources={selectedSources}
        support={support}
      />
    );
  } else if (stepId === "estimate") {
    body = (
      <EstimateStep
        estimate={estimateData}
        loading={estimate.isPending && spec !== null}
        fetching={estimate.isFetching}
        error={estimate.isError ? estimate.error : null}
        retryIn={estimateRetryIn}
        updatedAt={estimate.dataUpdatedAt}
        sources={sources.data}
        onRefresh={() => void estimate.refetch()}
        onGoToStep={goTo}
      />
    );
  } else if (spec) {
    body = (
      <ReviewStep
        spec={spec}
        sources={sources.data}
        estimate={estimateData}
        onGoToStep={goTo}
        error={
          create.isError ? (
            <CreateError
              error={create.error}
              retryIn={createRetryIn}
              sources={sources.data}
              onGoToStep={goTo}
            />
          ) : estimateData ? (
            <EstimateProblems estimate={estimateData} sources={sources.data} onGoToStep={goTo} />
          ) : estimate.isError ? (
            <ErrorState
              title="Could not check the estimate"
              message={friendlyMessage(estimate.error)}
              requestId={requestIdOf(estimate.error)}
              onRetry={estimateRetryIn > 0 ? undefined : () => void estimate.refetch()}
            />
          ) : null
        }
      />
    );
  }

  const isLast = step === STEP_IDS.length - 1;
  const continueDisabled =
    (stepId === "source" && (sources.isPending || noneRunnable)) ||
    (stepId === "estimate" && (estimate.isPending || blocked));
  const createDisabled = blocked || estimate.isPending || createRetryIn > 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {header}
      <Stepper
        aria-label="Discovery job steps"
        collapseOnNarrow
        steps={WIZARD_STEPS.map((s) => ({ id: s.id, label: s.label }))}
        current={step}
        onStepSelect={(i) => i < step && goTo(i)}
      />
      <Card>
        <CardHeader>
          <CardTitle ref={titleRef} tabIndex={-1} className="outline-none">
            {text.title}
          </CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-6">
          <FadeIn key={stepId} duration={0.45}>
            {body}
          </FadeIn>
          <div className="border-border flex min-w-0 flex-col-reverse gap-2 border-t pt-4 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
            {step > 0 ? (
              <Button variant="text" onClick={() => goTo(step - 1)}>
                <ArrowLeft aria-hidden /> Back
              </Button>
            ) : (
              <Button asChild variant="text">
                <Link href="/app/discovery">Cancel</Link>
              </Button>
            )}
            {isLast ? (
              <Button
                onClick={submit}
                loading={create.isPending}
                disabled={createDisabled}
                aria-describedby={createDisabled ? "discovery-create-hint" : undefined}
              >
                Create discovery job
              </Button>
            ) : (
              <Button onClick={next} disabled={continueDisabled}>
                Continue <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
          {isLast && createDisabled ? (
            <p
              id="discovery-create-hint"
              className="text-muted-foreground -mt-3 text-xs min-[360px]:text-right"
            >
              {createRetryIn > 0
                ? `You can create the job again in ${createRetryIn}s.`
                : estimate.isPending
                  ? "Checking the estimate…"
                  : "Resolve the items in the estimate before creating the job."}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
