"use client";

import type { BusinessFacets, SourceKey, WhatsAppStatus } from "@leadforge/contracts";
import {
  FIELD_STATE_META,
  FilterBar,
  FilterMenu,
  FilterRange,
  MEDIA,
  describeRange,
  SearchField,
  useMediaQuery,
  type ActiveFilter,
  type FilterMenuOption,
} from "@leadforge/ui";
import { useEffect, useRef, useState } from "react";
import {
  clearedFilters,
  contactChoice,
  withContactChoice,
  type ContactChoice,
  type DirectoryState,
} from "@/lib/business-filters";
import { FIELD_FILTER_STATES, WHATSAPP_LABELS, sourceLabel } from "@/lib/labels";

const CONTACT_FIELDS = [
  { field: "website", label: "Website" },
  { field: "phone", label: "Phone" },
  { field: "email", label: "Email" },
] as const;

const SUPPRESSION_OPTIONS: FilterMenuOption[] = [
  { value: "include", label: "Include suppressed" },
  { value: "only", label: "Only suppressed" },
];

function contactOptions(field: "website" | "phone" | "email", noun: string): FilterMenuOption[] {
  return [
    { value: "has", label: `Has a ${noun}` },
    { value: "none", label: `No ${noun}` },
    ...FIELD_FILTER_STATES[field].map((s) => ({ value: s, label: FIELD_STATE_META[s].label })),
  ];
}

function bucketOptions(buckets: BusinessFacets["categories"] | undefined): FilterMenuOption[] {
  return (buckets ?? []).map((b) => ({ value: b.value, label: b.label, count: b.count }));
}

/** Facet buckets plus any value already applied from the URL that the top 25 does not list. */
function withApplied(options: FilterMenuOption[], applied: string[]): FilterMenuOption[] {
  const missing = applied.filter((v) => !options.some((o) => o.value === v));
  return [...options, ...missing.map((v) => ({ value: v, label: v }))];
}

export interface DirectoryFiltersProps {
  state: DirectoryState;
  onChange: (next: DirectoryState) => void;
  facets: BusinessFacets | undefined;
  facetsLoading: boolean;
  /** Label for an import filter chip, for example the file name. */
  importLabel?: string | null;
}

/**
 * Directory toolbar: debounced search plus filter chips driven by GET /businesses/facets.
 * Inline chips from 768px; below that the same filters sit in a sheet as labelled fields.
 */
export function DirectoryFilters({
  state,
  onChange,
  facets,
  facetsLoading,
  importLabel,
}: DirectoryFiltersProps) {
  const compact = useMediaQuery(MEDIA.belowMd);
  const appearance = compact ? "field" : "chip";

  // The search box seeds from the URL only when the URL changes from outside (back button,
  // shared link), so a debounced write never rewrites what the user is typing.
  const [searchSeed, setSearchSeed] = useState(state.q ?? "");
  const lastSent = useRef(state.q ?? "");
  useEffect(() => {
    const q = state.q ?? "";
    if (q !== lastSent.current) {
      lastSent.current = q;
      setSearchSeed(q);
    }
  }, [state.q]);

  const set = (patch: Partial<DirectoryState>) => onChange({ ...state, ...patch });

  const facetLabel = (buckets: BusinessFacets["categories"] | undefined, value: string) =>
    buckets?.find((b) => b.value === value)?.label ?? value;

  const chips: ActiveFilter[] = [
    ...state.category.map((v) => ({
      id: `category:${v}`,
      label: `Category: ${facetLabel(facets?.categories, v)}`,
      onRemove: () => set({ category: state.category.filter((x) => x !== v) }),
    })),
    ...state.region.map((v) => ({
      id: `region:${v}`,
      label: `Region: ${facetLabel(facets?.regions, v)}`,
      onRemove: () => set({ region: state.region.filter((x) => x !== v) }),
    })),
    ...state.locality.map((v) => ({
      id: `locality:${v}`,
      label: `City or town: ${facetLabel(facets?.localities, v)}`,
      onRemove: () => set({ locality: state.locality.filter((x) => x !== v) }),
    })),
    ...CONTACT_FIELDS.flatMap(({ field, label }) => {
      const choice = contactChoice(state, field);
      if (!choice) return [];
      const states = state[`${field}State`];
      const text =
        choice === "has"
          ? "has a value"
          : choice === "none"
            ? "no value"
            : choice === "custom"
              ? states.map((s) => FIELD_STATE_META[s].label.toLowerCase()).join(" or ") || "custom"
              : FIELD_STATE_META[choice].label.toLowerCase();
      return [
        {
          id: `contact:${field}`,
          label: `${label}: ${text}`,
          onRemove: () => onChange(withContactChoice(state, field, "")),
        },
      ];
    }),
    ...state.whatsapp.map((v) => ({
      id: `whatsapp:${v}`,
      label: `WhatsApp: ${WHATSAPP_LABELS[v]}`,
      onRemove: () => set({ whatsapp: state.whatsapp.filter((x) => x !== v) }),
    })),
    ...state.source.map((v) => ({
      id: `source:${v}`,
      label: `Source: ${sourceLabel(v)}`,
      onRemove: () => set({ source: state.source.filter((x) => x !== v) }),
    })),
    ...(state.suppression !== "exclude"
      ? [
          {
            id: "suppression",
            label: state.suppression === "only" ? "Only suppressed" : "Including suppressed",
            onRemove: () => set({ suppression: "exclude" }),
          },
        ]
      : []),
    ...(state.fitMin !== undefined || state.fitMax !== undefined
      ? [
          {
            id: "fit",
            label: `Fit: ${describeRange({ min: state.fitMin, max: state.fitMax })}`,
            onRemove: () => set({ fitMin: undefined, fitMax: undefined }),
          },
        ]
      : []),
    ...(state.dataConfidenceMin !== undefined || state.dataConfidenceMax !== undefined
      ? [
          {
            id: "dataConfidence",
            label: `Data confidence: ${describeRange({ min: state.dataConfidenceMin, max: state.dataConfidenceMax })}`,
            onRemove: () => set({ dataConfidenceMin: undefined, dataConfidenceMax: undefined }),
          },
        ]
      : []),
    ...(state.importId
      ? [
          {
            id: "import",
            label: `Import: ${importLabel ?? state.importId}`,
            onRemove: () => set({ importId: undefined }),
          },
        ]
      : []),
  ];

  const whatsappOptions: FilterMenuOption[] = (
    ["confirmed", "user_asserted", "unknown"] as const
  ).map((v) => ({
    value: v,
    label: WHATSAPP_LABELS[v],
    count: facets?.whatsapp.find((b) => b.value === v)?.count,
  }));
  const sourceOptions: FilterMenuOption[] = withApplied(
    (facets?.sources ?? []).map((b) => ({
      value: b.value,
      label: sourceLabel(b.value),
      count: b.count,
    })),
    state.source,
  );

  return (
    <FilterBar
      filters={chips}
      onClearAll={() => onChange(clearedFilters(state))}
      sheetTitle="Filter businesses"
      sheetDescription="Counts come from your workspace's non-suppressed businesses."
      search={
        <SearchField
          label="Search businesses"
          placeholder="Search name, phone, email, domain or place"
          value={searchSeed}
          onDebouncedChange={(v) => {
            lastSent.current = v;
            set({ q: v || undefined });
          }}
        />
      }
    >
      <FilterMenu
        label="Category"
        appearance={appearance}
        loading={facetsLoading}
        emptyMessage="No categories yet"
        sections={[
          {
            id: "category",
            type: "multiple",
            options: withApplied(bucketOptions(facets?.categories), state.category),
            value: state.category,
            onValueChange: (category) => set({ category }),
          },
        ]}
      />
      <FilterMenu
        label="Region"
        appearance={appearance}
        loading={facetsLoading}
        emptyMessage="No regions yet"
        sections={[
          {
            id: "region",
            type: "multiple",
            options: withApplied(bucketOptions(facets?.regions), state.region),
            value: state.region,
            onValueChange: (region) => set({ region }),
          },
        ]}
      />
      <FilterMenu
        label="City or town"
        appearance={appearance}
        loading={facetsLoading}
        emptyMessage="No cities or towns yet"
        sections={[
          {
            id: "locality",
            type: "multiple",
            options: withApplied(bucketOptions(facets?.localities), state.locality),
            value: state.locality,
            onValueChange: (locality) => set({ locality }),
          },
        ]}
      />
      <FilterMenu
        label="Contact data"
        appearance={appearance}
        summary={summarizeContact(state)}
        sections={CONTACT_FIELDS.map(({ field, label }) => {
          const choice = contactChoice(state, field);
          return {
            id: field,
            label,
            type: "single" as const,
            anyLabel: `Any ${label.toLowerCase()}`,
            options: contactOptions(field, label.toLowerCase()),
            value: choice && choice !== "custom" ? [choice] : [],
            onValueChange: (v: string[]) =>
              onChange(withContactChoice(state, field, (v[0] ?? "") as ContactChoice)),
          };
        })}
      />
      <FilterMenu
        label="WhatsApp"
        appearance={appearance}
        sections={[
          {
            id: "whatsapp",
            type: "multiple",
            options: whatsappOptions,
            value: state.whatsapp,
            onValueChange: (v) => set({ whatsapp: v as WhatsAppStatus[] }),
          },
        ]}
      />
      <FilterMenu
        label="Source"
        appearance={appearance}
        loading={facetsLoading}
        emptyMessage="No sources yet"
        sections={[
          {
            id: "source",
            type: "multiple",
            options: sourceOptions,
            value: state.source,
            onValueChange: (v) => set({ source: v as SourceKey[] }),
          },
        ]}
      />
      <FilterRange
        label="Lead score"
        appearance={appearance}
        sections={[
          { id: "fit", label: "Fit score", value: { min: state.fitMin, max: state.fitMax } },
          {
            id: "dataConfidence",
            label: "Data confidence",
            value: { min: state.dataConfidenceMin, max: state.dataConfidenceMax },
          },
        ]}
        onApply={(v) =>
          set({
            fitMin: v.fit?.min,
            fitMax: v.fit?.max,
            dataConfidenceMin: v.dataConfidence?.min,
            dataConfidenceMax: v.dataConfidence?.max,
          })
        }
      />
      <FilterMenu
        label="Suppressed"
        appearance={appearance}
        summary={
          state.suppression === "only"
            ? "Only"
            : state.suppression === "include"
              ? "Included"
              : undefined
        }
        sections={[
          {
            id: "suppression",
            type: "single",
            anyLabel: "Hide suppressed",
            options: SUPPRESSION_OPTIONS,
            value: state.suppression === "exclude" ? [] : [state.suppression],
            onValueChange: (v) =>
              set({
                suppression: (v[0] as DirectoryState["suppression"] | undefined) ?? "exclude",
              }),
          },
        ]}
      />
    </FilterBar>
  );
}

function summarizeContact(state: DirectoryState): string | undefined {
  const n = CONTACT_FIELDS.filter(({ field }) => contactChoice(state, field) !== "").length;
  return n === 0 ? undefined : n === 1 ? "1 rule" : `${n} rules`;
}
