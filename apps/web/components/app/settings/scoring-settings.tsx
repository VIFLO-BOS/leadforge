"use client";

import {
  DEFAULT_SCORING_WEIGHTS,
  SCORE_EXPLANATION,
  type ScoringProfile,
  type ScoringSignal,
} from "@leadforge/contracts";
import { Gauge, MapPin, Plus, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  Combobox,
  type ComboboxOption,
  ErrorState,
  Input,
  LiveAnnouncement,
  Progress,
  Skeleton,
  StatusIndicator,
  TextField,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { isApiError } from "@/lib/api";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { countryName, NIGERIAN_STATES } from "@/lib/geo";
import {
  useDiscoveryCategories,
  useDiscoveryLocations,
  useDiscoverySources,
} from "@/lib/hooks/use-discovery";
import {
  isRecomputeActive,
  useRecomputeScores,
  useScoringProfile,
  useUpdateScoringProfile,
} from "@/lib/hooks/use-scoring";
import {
  SCORING_SIGNALS,
  SCORING_SIGNAL_LABELS,
  SIGNAL_DESCRIPTIONS,
  draftFromWeights,
  validateWeights,
  weightErrorsFromServer,
  type WeightDraft,
} from "@/lib/scoring";

type IcpLocationDraft = { country: string | null; region: string | null; locality: string | null };

const MAX_ICP = 50;

function locationText(l: IcpLocationDraft): string {
  return [l.locality, l.region, l.country ? countryName(l.country) : null]
    .filter(Boolean)
    .join(", ");
}

function sameLocation(a: IcpLocationDraft, b: IcpLocationDraft): boolean {
  const n = (v: string | null) => (v ?? "").trim().toLowerCase();
  return (
    n(a.country) === n(b.country) && n(a.region) === n(b.region) && n(a.locality) === n(b.locality)
  );
}

/** Body field for a location: only the parts that are set. */
function toIcpLocation(l: IcpLocationDraft) {
  return {
    ...(l.country ? { country: l.country } : {}),
    ...(l.region ? { region: l.region } : {}),
    ...(l.locality ? { locality: l.locality } : {}),
  };
}

/**
 * Settings, Scoring tab: the seven fit-score weights (whole numbers adding up to 100, validated
 * live with the contracts' schema), the ideal customer profile (categories and locations from
 * the discovery catalogues), optimistic concurrency on `version` and recompute progress.
 * Owners and administrators edit; everyone else reads.
 */
export function ScoringSettings({ canEdit }: { canEdit: boolean }) {
  const profile = useScoringProfile();
  if (profile.isPending) {
    return (
      <div
        className="flex flex-col gap-4"
        role="status"
        aria-busy="true"
        aria-label="Loading scoring settings"
      >
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (profile.isError && !profile.data) {
    return (
      <ErrorState
        title="Could not load the scoring profile"
        message={friendlyMessage(profile.error)}
        requestId={requestIdOf(profile.error)}
        onRetry={() => void profile.refetch()}
      />
    );
  }
  return (
    <ScoringForm profile={profile.data} canEdit={canEdit} onReload={() => profile.refetch()} />
  );
}

function ScoringForm({
  profile,
  canEdit,
  onReload,
}: {
  profile: ScoringProfile;
  canEdit: boolean;
  onReload: () => Promise<unknown>;
}) {
  const { org } = useWorkspace();
  const ids = useId();
  const update = useUpdateScoringProfile();
  const recompute = useRecomputeScores();
  // The editor works on the version it loaded; a newer version only replaces the draft on reload.
  const [loaded, setLoaded] = useState(profile);
  const [weights, setWeights] = useState<WeightDraft>(() => draftFromWeights(profile.weights));
  const [categories, setCategories] = useState<string[]>(profile.icp.categories);
  const [locations, setLocations] = useState<IcpLocationDraft[]>(profile.icp.locations);
  const [serverErrors, setServerErrors] = useState<ReturnType<
    typeof weightErrorsFromServer
  > | null>(null);
  const [stale, setStale] = useState(false);
  const [touched, setTouched] = useState(false);

  const reset = (p: ScoringProfile) => {
    setLoaded(p);
    setWeights(draftFromWeights(p.weights));
    setCategories(p.icp.categories);
    setLocations(p.icp.locations);
    setServerErrors(null);
    setStale(false);
    setTouched(false);
  };

  const validation = validateWeights(weights);
  const fieldError = (s: ScoringSignal) =>
    validation.fieldErrors[s] ?? serverErrors?.fieldErrors[s];
  const totalError = validation.totalError ?? serverErrors?.totalError ?? null;

  const dirty =
    SCORING_SIGNALS.some((s) => String(loaded.weights[s]) !== weights[s].trim()) ||
    JSON.stringify(categories) !== JSON.stringify(loaded.icp.categories) ||
    JSON.stringify(locations) !== JSON.stringify(loaded.icp.locations);

  const save = () => {
    setTouched(true);
    if (!validation.weights) return;
    setServerErrors(null);
    update.mutate(
      {
        version: loaded.version,
        weights: validation.weights,
        icp: { categories, locations: locations.map(toIcpLocation) },
      },
      {
        onSuccess: (p) => {
          reset(p);
          toast.success("Scoring profile saved", {
            description:
              "Every score is being recomputed with the new profile. Progress shows below.",
          });
        },
        onError: (err) => {
          if (isApiError(err) && err.code === "CONFLICT") {
            setStale(true);
            return;
          }
          if (isApiError(err) && err.code === "VALIDATION_FAILED") {
            setServerErrors(weightErrorsFromServer(err.details));
            return;
          }
          toast.error(
            isForbidden(err)
              ? "Your role cannot change scoring"
              : "Could not save the scoring profile",
            {
              description: friendlyMessage(err),
            },
          );
        },
      },
    );
  };

  const disabled = !canEdit || update.isPending;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="scoring-settings">
      {!canEdit ? (
        <Banner
          tone="info"
          title="Read only"
          description="Owners and administrators change the scoring profile. You can see how scores are weighted."
        />
      ) : null}
      {stale ? (
        <Banner
          tone="warning"
          title="Someone else changed the scoring profile"
          description="It was saved by another session after you opened this page, so your changes were not saved. Reload to see the latest version, then make your changes again."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void onReload().then((res) => {
                  const data = (res as { data?: ScoringProfile }).data;
                  if (data) reset(data);
                })
              }
            >
              <RotateCcw aria-hidden /> Reload latest
            </Button>
          }
          data-testid="scoring-conflict"
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Fit score weights</CardTitle>
          <CardDescription>
            The fit score is the sum of each signal (0 to 1) times its weight. Weights are whole
            numbers that add up to 100. Data confidence is scored separately and never uses these
            weights. {SCORE_EXPLANATION}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-5">
          <ul className="flex min-w-0 flex-col gap-4" aria-label="Signal weights">
            {SCORING_SIGNALS.map((s) => {
              const id = `${ids}-${s}`;
              const err =
                touched || weights[s] !== String(loaded.weights[s]) ? fieldError(s) : undefined;
              return (
                <li
                  key={s}
                  className="grid min-w-0 grid-cols-1 gap-2 min-[480px]:grid-cols-[minmax(0,1fr)_7rem] min-[480px]:items-start"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <label htmlFor={id} className="text-sm font-medium">
                      {SCORING_SIGNAL_LABELS[s]}
                    </label>
                    <span id={`${id}-desc`} className="text-muted-foreground text-xs">
                      {SIGNAL_DESCRIPTIONS[s]} Default {DEFAULT_SCORING_WEIGHTS[s]}.
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Input
                      id={id}
                      inputMode="numeric"
                      autoComplete="off"
                      value={weights[s]}
                      disabled={disabled}
                      invalid={Boolean(err)}
                      aria-describedby={[
                        `${id}-desc`,
                        err ? `${id}-error` : null,
                        totalError ? `${ids}-total-error` : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onChange={(e) => {
                        setWeights({ ...weights, [s]: e.target.value });
                        setServerErrors(null);
                      }}
                      className="tabular-nums"
                    />
                    {err ? (
                      <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
                        {err}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div
            className="border-border flex min-w-0 flex-col gap-2 border-t pt-4"
            data-testid="weights-total"
          >
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Total</span>
              <span className="tabular-nums" aria-live="polite">
                {formatNumber(validation.sum)} of 100
              </span>
            </div>
            <Progress
              value={Math.min(validation.sum, 100)}
              max={100}
              label="Weights total"
              valueText={`${validation.sum} of 100`}
              tone={validation.sum === 100 ? "success" : "warning"}
              size="sm"
            />
            {totalError ? (
              <p
                id={`${ids}-total-error`}
                role="alert"
                className="text-destructive text-xs"
                data-testid="weights-error"
              >
                {totalError}
              </p>
            ) : (
              <StatusIndicator tone="success" size="sm" label="Weights add up to 100" />
            )}
          </div>
          {canEdit ? (
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button
                variant="text"
                size="sm"
                disabled={disabled}
                onClick={() => setWeights(draftFromWeights(DEFAULT_SCORING_WEIGHTS))}
              >
                Reset to defaults
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ideal customer profile</CardTitle>
          <CardDescription>
            Industry match and location match score 1 when a business is in one of these categories
            or places, and 0 when none is set. Up to {MAX_ICP} of each.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-6">
          <IcpCategories value={categories} onChange={setCategories} disabled={disabled} />
          <IcpLocations
            value={locations}
            onChange={setLocations}
            disabled={disabled}
            country={org.country ?? "NG"}
          />
          {serverErrors?.other.length ? (
            <Banner
              tone="destructive"
              title="Some values need attention"
              description={serverErrors.other.join(" ")}
            />
          ) : null}
        </CardContent>
      </Card>

      {canEdit ? (
        <div className="flex min-w-0 flex-col items-stretch gap-3 min-[360px]:flex-row min-[360px]:flex-wrap min-[360px]:items-center">
          <Button
            onClick={save}
            loading={update.isPending}
            disabled={!dirty || stale}
            className="h-auto min-h-10 whitespace-normal py-2"
          >
            <Save aria-hidden /> Save and recompute scores
          </Button>
          {dirty ? (
            <Button variant="text" onClick={() => reset(loaded)} disabled={update.isPending}>
              Discard changes
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">No unsaved changes</span>
          )}
        </div>
      ) : null}

      <RecomputeCard
        profile={profile}
        canEdit={canEdit}
        pending={recompute.isPending}
        onRecompute={() =>
          recompute.mutate(undefined, {
            onSuccess: () =>
              toast.success("Recompute queued", {
                description: "Every score is being recomputed.",
              }),
            onError: (err) =>
              toast.error("Could not start a recompute", { description: friendlyMessage(err) }),
          })
        }
      />
    </div>
  );
}

function IcpCategories({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const sources = useDiscoverySources();
  const catalogSource = sources.data?.find((s) => s.specSupport.catalog)?.key ?? null;
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(draft.trim()), 250);
    return () => window.clearTimeout(t);
  }, [draft]);
  const catalog = useDiscoveryCategories(catalogSource, query);
  const full = value.length >= MAX_ICP;
  const taken = (label: string) => value.some((v) => v.toLowerCase() === label.toLowerCase());
  const add = (raw: string) => {
    const label = raw.trim();
    if (label.length < 2 || taken(label) || full) return;
    onChange([...value, label]);
    setDraft("");
  };
  const seen = new Set<string>();
  const suggestions = (catalog.data ?? [])
    .filter((c) => {
      const k = c.label.toLowerCase();
      if (taken(c.label) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 10);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="text-sm font-medium">Categories</h3>
      {!disabled ? (
        <div className="flex min-w-0 flex-col gap-2 min-[360px]:flex-row min-[360px]:items-start">
          <TextField
            id="icp-category"
            label="Category"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              }
            }}
            disabled={full}
            hint={
              full
                ? `That is the maximum of ${MAX_ICP}.`
                : "Matched case-insensitively against business categories. Press Enter to add."
            }
            containerClassName="min-w-0 flex-1"
            autoComplete="off"
          />
          <Button
            variant="tonal"
            className="min-[360px]:mt-2"
            onClick={() => add(draft)}
            disabled={draft.trim().length < 2 || full}
          >
            <Plus aria-hidden /> Add
          </Button>
        </div>
      ) : null}
      {value.length ? (
        <ul aria-label="Ideal customer categories" className="flex min-w-0 flex-wrap gap-2">
          {value.map((c) => (
            <li key={c.toLowerCase()} className="min-w-0 max-w-full">
              {disabled ? (
                <Badge variant="neutral">{c}</Badge>
              ) : (
                <Chip
                  variant="input"
                  onRemove={() => onChange(value.filter((v) => v !== c))}
                  removeLabel={`Remove category ${c}`}
                >
                  {c}
                </Chip>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No categories set: industry match scores 0 for every business.
        </p>
      )}
      {!disabled && suggestions.length && !full ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">
            {query
              ? `Categories matching “${query}” from the discovery catalogue`
              : "Suggestions from the discovery catalogue"}
          </p>
          <ul className="flex min-w-0 flex-wrap gap-2" aria-label="Category suggestions">
            {suggestions.map((c) => (
              <li key={c.key} className="min-w-0 max-w-full">
                <Chip variant="suggestion" icon={<Plus aria-hidden />} onClick={() => add(c.label)}>
                  {c.label}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function IcpLocations({
  value,
  onChange,
  disabled,
  country,
}: {
  value: IcpLocationDraft[];
  onChange: (v: IcpLocationDraft[]) => void;
  disabled: boolean;
  country: string;
}) {
  const sources = useDiscoverySources();
  const catalogSource = sources.data?.find((s) => s.specSupport.catalog)?.key ?? null;
  const catalog = useDiscoveryLocations(catalogSource);
  const [region, setRegion] = useState<string | null>(null);
  const [locality, setLocality] = useState("");
  const [error, setError] = useState<string | null>(null);
  const states: ComboboxOption[] = useMemo(() => {
    const fromCatalog = catalog.data?.states ?? [];
    if (fromCatalog.length) {
      return fromCatalog.map((s) => ({
        value: s.name,
        label: s.name,
        description:
          s.places !== null && s.places !== undefined
            ? `${formatNumber(s.places)} places`
            : undefined,
      }));
    }
    return NIGERIAN_STATES.map((s) => ({ value: s, label: s }));
  }, [catalog.data]);
  const full = value.length >= MAX_ICP;

  const add = () => {
    const next: IcpLocationDraft = {
      country,
      region: region?.trim() || null,
      locality: locality.trim() || null,
    };
    if (next.locality && next.locality.length < 2) {
      setError("A city or town needs at least 2 characters");
      return;
    }
    if (value.some((l) => sameLocation(l, next))) {
      setError("That location is already in the list");
      return;
    }
    onChange([...value, next]);
    setRegion(null);
    setLocality("");
    setError(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="text-sm font-medium">Locations</h3>
      {!disabled ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[640px]:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="icp-region" className="text-sm font-medium">
                State
              </label>
              <Combobox
                id="icp-region"
                options={states}
                value={region}
                onValueChange={setRegion}
                placeholder={`Any state in ${countryName(country)}`}
                searchPlaceholder="Search states"
                clearable
                disabled={full}
              />
            </div>
            <TextField
              id="icp-locality"
              label="City or town (optional)"
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
              error={error ?? undefined}
              disabled={full}
              autoComplete="off"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="tonal" onClick={add} disabled={full}>
              <MapPin aria-hidden /> Add location
            </Button>
            <span className="text-muted-foreground text-xs">
              Every part you set must match. Leave both empty to match all of {countryName(country)}
              .
            </span>
          </div>
          {catalog.data?.boundariesAttribution ? (
            <p className="text-muted-foreground text-xs">{catalog.data.boundariesAttribution}</p>
          ) : null}
        </div>
      ) : null}
      {value.length ? (
        <ul aria-label="Ideal customer locations" className="flex min-w-0 flex-wrap gap-2">
          {value.map((l, i) => {
            const text = locationText(l) || "Any location";
            return (
              <li key={`${text}-${i}`} className="min-w-0 max-w-full">
                {disabled ? (
                  <Badge variant="neutral">{text}</Badge>
                ) : (
                  <Chip
                    variant="input"
                    onRemove={() => onChange(value.filter((_, j) => j !== i))}
                    removeLabel={`Remove location ${text}`}
                  >
                    {text}
                  </Chip>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No locations set: location match scores 0 for every business.
        </p>
      )}
    </div>
  );
}

const RECOMPUTE_LABELS: Record<ScoringProfile["recompute"]["status"], string> = {
  idle: "No recompute has run yet",
  queued: "Recompute queued",
  running: "Recomputing scores",
  completed: "Scores are up to date",
  failed: "The last recompute failed",
};

function RecomputeCard({
  profile,
  canEdit,
  pending,
  onRecompute,
}: {
  profile: ScoringProfile;
  canEdit: boolean;
  pending: boolean;
  onRecompute: () => void;
}) {
  const r = profile.recompute;
  const active = isRecomputeActive(profile);
  const forCurrent = r.profileVersion === profile.version;
  return (
    <Card data-testid="recompute">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Recompute</CardTitle>
          <CardDescription>
            Saving the profile recomputes every score. Scores also update when a business&apos;s
            data changes, and daily.
          </CardDescription>
        </div>
        {canEdit ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRecompute}
            loading={pending}
            disabled={active}
          >
            <RefreshCw aria-hidden /> Recompute now
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <StatusIndicator
          tone={
            r.status === "failed"
              ? "destructive"
              : r.status === "completed"
                ? "success"
                : active
                  ? "info"
                  : "neutral"
          }
          icon={active ? RefreshCw : Gauge}
          label={RECOMPUTE_LABELS[r.status] ?? r.status}
          data-testid="recompute-status"
        />
        <LiveAnnouncement message={`Score recompute: ${RECOMPUTE_LABELS[r.status] ?? r.status}`} />
        {active ? (
          <Progress
            value={r.total ? r.processed : undefined}
            max={r.total ?? undefined}
            label="Recompute progress"
            valueText={
              r.total
                ? `${formatNumber(r.processed)} of ${formatNumber(r.total)} businesses`
                : "Starting"
            }
            showLabel
            size="sm"
          />
        ) : null}
        <dl className="grid min-w-0 grid-cols-1 gap-2 text-sm min-[480px]:grid-cols-2">
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground text-xs">Profile version</dt>
            <dd className="tabular-nums">
              {profile.version}
              {r.profileVersion !== null && !forCurrent
                ? ` (last recompute used version ${r.profileVersion})`
                : ""}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground text-xs">Businesses processed</dt>
            <dd className="tabular-nums">
              {r.total !== null
                ? `${formatNumber(r.processed)} of ${formatNumber(r.total)}`
                : formatNumber(r.processed)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground text-xs">Requested</dt>
            <dd>{r.requestedAt ? formatDateTime(r.requestedAt) : "Never"}</dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground text-xs">Finished</dt>
            <dd>
              {r.finishedAt ? formatDateTime(r.finishedAt) : active ? "Still running" : "Not yet"}
            </dd>
          </div>
        </dl>
        {r.error ? <p className="text-destructive break-anywhere text-xs">{r.error}</p> : null}
        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          Profile last changed {formatDateTime(profile.updatedAt)}
          {active ? " · refreshing every 2 seconds" : ""}
        </p>
      </CardContent>
    </Card>
  );
}
