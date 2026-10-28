"use client";

import { DISCOVERY_LIMITS, type DiscoveryLocationOptions } from "@leadforge/contracts";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Chip, Combobox, FormField, TextField, type ComboboxOption } from "@leadforge/ui";
import { splitList } from "@/lib/forms";
import { formatNumber } from "@/lib/format";
import { NIGERIAN_STATES, countryName } from "@/lib/geo";
import { useDiscoveryCategories, useDiscoveryLocations } from "@/lib/hooks/use-discovery";
import {
  placeRequirement,
  type StepErrors,
  type WizardSupport,
  type WizardValues,
} from "./wizard-model";

/**
 * Common business categories offered as one-tap suggestions when no selected source has a
 * category catalogue. A convenience only: any category or keyword can be typed.
 */
const STATIC_SUGGESTIONS = [
  "Restaurant",
  "Pharmacy",
  "Bakery",
  "Supermarket",
  "Hotel",
  "Hospital",
  "School",
  "Hair salon",
  "Car repair",
  "Fashion designer",
];

const STATIC_STATES: ComboboxOption[] = NIGERIAN_STATES.map((s) => ({ value: s, label: s }));

function placesText(n: number | null | undefined): string | undefined {
  if (n === null || n === undefined) return undefined;
  return `${formatNumber(n)} ${n === 1 ? "place" : "places"}`;
}

export function CategoryInput({
  value,
  onChange,
  error,
  catalogSource,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  /** Source whose category catalogue drives the suggestions; null for free text only. */
  catalogSource: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(draft.trim()), 250);
    return () => window.clearTimeout(t);
  }, [draft]);
  const catalog = useDiscoveryCategories(catalogSource, query);
  const full = value.length >= DISCOVERY_LIMITS.maxCategories;
  const taken = (label: string) => value.some((v) => v.toLowerCase() === label.toLowerCase());

  const add = (raw: string) => {
    const next = [...value];
    for (const part of splitList(raw)) {
      if (next.length >= DISCOVERY_LIMITS.maxCategories) break;
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next);
    setDraft("");
  };

  const fromCatalog = Boolean(catalogSource && catalog.data);
  // A catalogue can list the same label twice (a curated entry and a taxonomy entry); show it once.
  const seen = new Set<string>();
  const suggestions: { label: string; count?: string }[] = fromCatalog
    ? (catalog.data ?? [])
        .filter((c) => {
          const k = c.label.toLowerCase();
          if (taken(c.label) || seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 12)
        .map((c) => ({ label: c.label, count: placesText(c.places) }))
    : STATIC_SUGGESTIONS.filter(
        (s) => !taken(s) && (!query || s.toLowerCase().startsWith(query.toLowerCase())),
      ).map((label) => ({ label }));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2 min-[360px]:flex-row min-[360px]:items-start">
        <TextField
          id="discovery-category"
          label="Category"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              if (draft.trim()) add(draft);
            }
          }}
          disabled={full}
          hint={
            full
              ? `That is the maximum of ${DISCOVERY_LIMITS.maxCategories}. Remove one to add another.`
              : "A business category or keyword. Press Enter to add; each runs one search per source."
          }
          error={error}
          containerClassName="min-w-0 flex-1"
          autoComplete="off"
        />
        <Button
          variant="tonal"
          className="min-[360px]:mt-2"
          onClick={() => add(draft)}
          disabled={!draft.trim() || full}
        >
          <Plus aria-hidden /> Add
        </Button>
      </div>
      {value.length ? (
        <ul aria-label="Categories to search" className="flex min-w-0 flex-wrap gap-2">
          {value.map((c) => (
            <li key={c.toLowerCase()} className="min-w-0 max-w-full">
              <Chip
                variant="input"
                onRemove={() => onChange(value.filter((v) => v !== c))}
                removeLabel={`Remove category ${c}`}
              >
                {c}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
      {suggestions.length && !full ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-muted-foreground text-xs" id="discovery-category-suggestions">
            {fromCatalog
              ? query
                ? `Categories matching “${query}”, with places available nationwide`
                : "Categories the source can match, with places available nationwide"
              : "Suggestions"}
          </p>
          <ul
            aria-labelledby="discovery-category-suggestions"
            className="flex min-w-0 flex-wrap gap-2"
            aria-busy={catalog.isFetching || undefined}
          >
            {suggestions.map((s) => (
              <li key={s.label} className="min-w-0 max-w-full">
                <Chip variant="suggestion" size="sm" onClick={() => add(s.label)}>
                  {s.label}
                  {s.count ? (
                    <span className="text-muted-foreground ml-1 font-normal">· {s.count}</span>
                  ) : null}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function stateOptions(locations: DiscoveryLocationOptions | undefined): ComboboxOption[] {
  if (!locations?.states.length) return STATIC_STATES;
  return locations.states.map((s) => ({
    value: s.name,
    label: s.name,
    description: placesText(s.places),
  }));
}

function lgaOptions(
  locations: DiscoveryLocationOptions | undefined,
  region: string,
): ComboboxOption[] | null {
  if (!locations) return null;
  const state = locations.states.find((s) => s.name.toLowerCase() === region.trim().toLowerCase());
  if (!state) return null;
  return state.lgas.map((l) => ({
    value: l.name,
    label: l.name,
    description: placesText(l.places),
  }));
}

export interface TargetStepProps {
  values: WizardValues;
  errors: StepErrors;
  country: string;
  support: WizardSupport;
  onChange: <K extends keyof WizardValues>(field: K, value: WizardValues[K]) => void;
  suggestedName: string;
}

/**
 * Step 2: what to find (categories or keywords) and where. The place fields are the ones the
 * selected sources honour (`specSupport.location`); a source with catalogues supplies category
 * suggestions, states and LGAs with place counts.
 */
export function TargetStep({
  values,
  errors,
  country,
  support,
  onChange,
  suggestedName,
}: TargetStepProps) {
  const locations = useDiscoveryLocations(support.catalogSource);
  const locs = locations.data;
  const states = useMemo(() => stateOptions(locs), [locs]);
  const lgas = useMemo(() => lgaOptions(locs, values.region), [locs, values.region]);
  const has = (f: WizardSupport["location"][number]) => support.location.includes(f);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">What to find</legend>
        <CategoryInput
          value={values.categories}
          onChange={(next) => onChange("categories", next)}
          error={errors.categories}
          catalogSource={support.catalogSource}
        />
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-2 text-sm font-medium">Where</legend>
        <p className="text-muted-foreground -mt-1 text-xs">
          Country: <span className="text-foreground">{countryName(country)}</span>.{" "}
          {placeRequirement(support)} The more specific the place, the more relevant the results.
        </p>
        <div className="grid min-w-0 grid-cols-1 gap-4 min-[640px]:grid-cols-2">
          {has("region") ? (
            <FormField id="discovery-region" label="State" error={errors.region}>
              <Combobox
                id="discovery-region"
                options={states}
                value={values.region || null}
                onValueChange={(v) => {
                  onChange("region", v ?? "");
                  if (values.lga) onChange("lga", "");
                }}
                placeholder="Any state"
                searchPlaceholder="Search states"
                clearable
                invalid={Boolean(errors.region)}
              />
            </FormField>
          ) : null}
          {has("lga") ? (
            lgas ? (
              <FormField
                id="discovery-lga"
                label="LGA (local government area)"
                error={errors.lga}
                hint={values.region ? undefined : "Choose a state to list its LGAs"}
              >
                <Combobox
                  id="discovery-lga"
                  options={lgas}
                  value={values.lga || null}
                  onValueChange={(v) => onChange("lga", v ?? "")}
                  placeholder="Any LGA"
                  searchPlaceholder="Search LGAs"
                  emptyMessage="No LGA matches"
                  clearable
                  invalid={Boolean(errors.lga)}
                />
              </FormField>
            ) : (
              <TextField
                id="discovery-lga"
                label="LGA"
                value={values.lga}
                onChange={(e) => onChange("lga", e.target.value)}
                error={errors.lga}
                hint={
                  support.catalogSource && !values.region
                    ? "Local government area. Choose a state to list them, or type one"
                    : "Local government area, for example Eti Osa or Ikeja"
                }
                autoComplete="off"
              />
            )
          ) : null}
          {has("locality") ? (
            <TextField
              id="discovery-locality"
              label="City or town"
              value={values.locality}
              onChange={(e) => onChange("locality", e.target.value)}
              error={errors.locality}
              hint="For example Ikeja or Wuse"
              autoComplete="off"
            />
          ) : null}
          {has("query") ? (
            <TextField
              id="discovery-area"
              label="Area or street (optional)"
              value={values.area}
              onChange={(e) => onChange("area", e.target.value)}
              error={errors.area}
              hint="Added to every search, for example Allen Avenue"
              autoComplete="off"
              containerClassName="min-[640px]:col-span-2"
            />
          ) : null}
        </div>
        {locs ? (
          <p className="text-muted-foreground text-xs">
            States and LGAs from the loaded snapshot
            {locs.release ? ` (release ${locs.release})` : ""}. {locs.boundariesAttribution}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Job name</legend>
        <TextField
          id="discovery-name"
          label="Name"
          value={values.name}
          onChange={(e) => {
            onChange("name", e.target.value);
            onChange(
              "nameEdited",
              e.target.value.trim() !== "" && e.target.value !== suggestedName,
            );
          }}
          error={errors.name}
          hint={
            values.nameEdited
              ? "Shown in the job list and in notifications."
              : "Suggested from the categories and place. Edit it if you like."
          }
          maxLength={120}
          autoComplete="off"
        />
      </fieldset>
    </div>
  );
}
