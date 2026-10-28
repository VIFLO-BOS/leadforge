"use client";

import {
  DISCOVERY_LIMITS,
  DiscoveryPriorityField,
  type DiscoverySourceOption,
} from "@leadforge/contracts";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Checkbox, RadioGroup, RadioGroupItem, TextAreaField, TextField, cn } from "@leadforge/ui";
import { formatNumber } from "@/lib/format";
import type { Confidence, StepErrors, WizardSupport, WizardValues } from "./wizard-model";

const CONFIDENCE: { value: Confidence; label: string; description: string }[] = [
  {
    value: "standard",
    label: "Standard",
    description:
      "Places the source is reasonably sure exist. More results. The score is about whether a place exists, not whether its contacts work.",
  },
  {
    value: "high",
    label: "High",
    description: "Only places the source is most sure exist. Fewer, more reliable results.",
  },
];

const PRIORITY_META: Record<DiscoveryPriorityField, { label: string; description: string }> = {
  phone: { label: "Phone numbers", description: "Requested from sources that provide them." },
  website: {
    label: "Website",
    description: "The business's own site, used later for website analysis and contact checks.",
  },
  email: {
    label: "Email addresses",
    description: "Only from sources that publish them; often found later on the business website.",
  },
  whatsapp: {
    label: "WhatsApp",
    description:
      "Only from explicit evidence. LeadForge never assumes a phone number uses WhatsApp.",
  },
};

export interface LimitsStepProps {
  values: WizardValues;
  errors: StepErrors;
  onChange: <K extends keyof WizardValues>(field: K, value: WizardValues[K]) => void;
  selectedSources: DiscoverySourceOption[];
  support: WizardSupport;
}

/**
 * Most records the selected sources can return for this many categories, from their metadata.
 * Null when any selected source has no per-query cap (`maxResultsPerQuery` 0): only the estimate
 * knows then.
 */
export function sourceCeiling(sources: DiscoverySourceOption[], categories: number): number | null {
  if (!sources.length || sources.some((s) => s.maxResultsPerQuery <= 0)) return null;
  return sources.reduce((sum, s) => sum + s.maxResultsPerQuery * Math.max(categories, 0), 0);
}

/**
 * Step 3: record limit (also the credit hold), the quality filters and contact fields the selected
 * sources honour, and domain rules.
 */
export function LimitsStep({
  values,
  errors,
  onChange,
  selectedSources,
  support,
}: LimitsStepProps) {
  const [showDomains, setShowDomains] = useState(
    Boolean(values.domainsInclude.trim() || values.domainsExclude.trim()),
  );
  const ceiling = sourceCeiling(selectedSources, values.categories.length);
  const provided = new Set(selectedSources.flatMap((s) => s.providesFields));
  const sourceNames = selectedSources.map((s) => s.name).join(" and ");
  const domainsOpen = showDomains || Boolean(errors.domainsInclude || errors.domainsExclude);
  const confidenceSources = selectedSources
    .filter((s) => s.specSupport?.confidence)
    .map((s) => s.name);
  const contactSources = selectedSources
    .filter((s) => s.specSupport?.requireContact)
    .map((s) => s.name);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Record limit</legend>
        <TextField
          id="discovery-max-records"
          label="Maximum records"
          type="number"
          inputMode="numeric"
          min={1}
          max={DISCOVERY_LIMITS.maxRecords}
          step={1}
          value={values.maxRecords}
          onChange={(e) => onChange("maxRecords", e.target.value)}
          error={errors.maxRecords}
          hint={`1 to ${formatNumber(DISCOVERY_LIMITS.maxRecords)}. The job stops at this many billable records, and this many credits are held while it runs.`}
          containerClassName="max-w-sm"
        />
        {ceiling !== null && ceiling > 0 ? (
          <p className="text-muted-foreground text-xs" data-testid="source-ceiling">
            For{" "}
            {values.categories.length === 1
              ? "1 category"
              : `${values.categories.length} categories`}
            , {sourceNames} can return at most {formatNumber(ceiling)} records, so the hold is the
            smaller of the two. The estimate on the next step confirms it.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            The estimate on the next step counts the matching places and confirms the hold.
          </p>
        )}
      </fieldset>

      {support.confidence || support.requireContact ? (
        <fieldset className="flex min-w-0 flex-col gap-4">
          <legend className="mb-2 text-sm font-medium">Quality filters</legend>
          {support.confidence ? (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-sm" id="discovery-confidence-label">
                Place confidence{" "}
                <span className="text-muted-foreground text-xs">
                  ({confidenceSources.join(", ")})
                </span>
              </p>
              <RadioGroup
                value={values.confidence}
                onValueChange={(v) => onChange("confidence", v as Confidence)}
                aria-labelledby="discovery-confidence-label"
                className="flex min-w-0 flex-col gap-3"
              >
                {CONFIDENCE.map((c) => (
                  <label
                    key={c.value}
                    htmlFor={`discovery-confidence-${c.value}`}
                    className="flex min-w-0 items-start gap-3"
                  >
                    <span className="flex h-5 shrink-0 items-center pl-1">
                      <RadioGroupItem id={`discovery-confidence-${c.value}`} value={c.value} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">{c.label}</span>
                      <span className="text-muted-foreground text-xs">{c.description}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          ) : null}
          {support.requireContact ? (
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-5 shrink-0 items-center pl-1">
                <Checkbox
                  id="discovery-require-contact"
                  checked={values.requireContact}
                  onCheckedChange={(v) => onChange("requireContact", v === true)}
                  aria-describedby="discovery-require-contact-description"
                />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <label
                  htmlFor="discovery-require-contact"
                  className="text-sm font-medium leading-5"
                >
                  Only places with a way to contact them
                </label>
                <span
                  id="discovery-require-contact-description"
                  className="text-muted-foreground text-xs"
                >
                  At least a phone, an email or a real website (not only a social profile). Places
                  without any contact are never offered or charged. Applies to{" "}
                  {contactSources.join(", ")}.
                </span>
              </span>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {support.priorityFields ? (
        <fieldset
          className="flex min-w-0 flex-col gap-3"
          aria-describedby={
            errors.priorityFields
              ? "discovery-priority-hint discovery-priority-error"
              : "discovery-priority-hint"
          }
        >
          <legend className="mb-2 text-sm font-medium">Contact fields to request</legend>
          <p id="discovery-priority-hint" className="text-muted-foreground -mt-1 text-xs">
            Some sources charge more for contact fields; the estimate shows what is requested.
          </p>
          <ul className="flex min-w-0 flex-col gap-3">
            {DiscoveryPriorityField.options.map((f) => {
              const id = `discovery-priority-${f}`;
              const checked = values.priorityFields.includes(f);
              const notProvided = selectedSources.length > 0 && !provided.has(f);
              return (
                <li key={f} className="flex min-w-0 items-start gap-3">
                  <span className="flex h-5 shrink-0 items-center pl-1">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(v) =>
                        onChange(
                          "priorityFields",
                          v === true
                            ? [...values.priorityFields, f]
                            : values.priorityFields.filter((x) => x !== f),
                        )
                      }
                      aria-describedby={`${id}-description`}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <label htmlFor={id} className="text-sm font-medium leading-5">
                      {PRIORITY_META[f].label}
                    </label>
                    <span id={`${id}-description`} className="text-muted-foreground text-xs">
                      {PRIORITY_META[f].description}
                      {notProvided ? ` Not provided by ${sourceNames}.` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {errors.priorityFields ? (
            <p id="discovery-priority-error" role="alert" className="text-destructive text-sm">
              {errors.priorityFields}
            </p>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-muted-foreground text-xs">
          {sourceNames || "The selected sources"} return every contact field they hold, so there are
          no contact fields to choose.
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-3">
        <button
          type="button"
          className="state-layer text-foreground -mx-2 inline-flex items-center gap-2 self-start rounded-full px-2 py-1.5 text-left text-sm font-medium"
          aria-expanded={domainsOpen}
          aria-controls="discovery-domain-rules"
          onClick={() => setShowDomains((s) => !s)}
        >
          Website domain rules (optional)
          <ChevronDown
            aria-hidden
            className={cn(
              "ease-emphasized size-4 transition-transform duration-200 motion-reduce:transition-none",
              domainsOpen && "rotate-180",
            )}
          />
        </button>
        {domainsOpen ? (
          <div
            id="discovery-domain-rules"
            className="grid min-w-0 grid-cols-1 gap-4 min-[768px]:grid-cols-2"
          >
            <TextAreaField
              id="discovery-domains-include"
              label="Only keep websites on these domains"
              value={values.domainsInclude}
              onChange={(e) => onChange("domainsInclude", e.target.value)}
              error={errors.domainsInclude}
              hint={`Bare domains, comma or line separated, up to ${DISCOVERY_LIMITS.maxDomains}.`}
              className="min-h-24"
            />
            <TextAreaField
              id="discovery-domains-exclude"
              label="Skip websites on these domains"
              value={values.domainsExclude}
              onChange={(e) => onChange("domainsExclude", e.target.value)}
              error={errors.domainsExclude}
              hint="For example a chain's domain, so its branches are skipped."
              className="min-h-24"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
