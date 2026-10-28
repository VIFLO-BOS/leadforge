"use client";

import { CorrectionRequest, type BusinessDetail, type CorrectionField } from "@leadforge/contracts";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Banner,
  Button,
  Checkbox,
  ChoiceField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextAreaField,
  TextField,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { applyServerErrors, schemaResolver, splitList, type PathSegment } from "@/lib/forms";
import { useCorrectBusiness } from "@/lib/hooks/use-businesses";

export type CorrectionAction = "add" | "replace" | "remove";

export interface CorrectionForm {
  field: CorrectionField;
  action: CorrectionAction;
  target: string;
  value: string;
  removeWebsite: boolean;
  whatsapp: "user_asserted" | "unknown";
  country: string;
  categories: string;
  street: string;
  locality: string;
  lga: string;
  region: string;
  postalCode: string;
  locationCountry: string;
  note: string;
}

export interface CorrectionTarget {
  field: CorrectionField;
  /** E.164 phone or email address to replace, remove or mark. */
  target?: string;
  action?: CorrectionAction;
}

const FIELD_OPTIONS: { value: CorrectionField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "website", label: "Website" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "categories", label: "Categories" },
  { value: "location", label: "Location" },
];

const LOCATION_KEYS = ["street", "locality", "lga", "region", "postalCode"] as const;

/** Form values to the contracts' CorrectionRequest body (one field per request). */
export function toCorrectionRequest(v: CorrectionForm): Record<string, unknown> {
  const note = v.note.trim() ? { note: v.note.trim() } : {};
  switch (v.field) {
    case "name":
      return { field: "name", value: v.value, ...note };
    case "website":
      return { field: "website", value: v.removeWebsite ? null : v.value, ...note };
    case "phone":
    case "email": {
      const body: Record<string, unknown> = {
        field: v.field,
        value: v.action === "remove" ? null : v.value,
        ...note,
      };
      if (v.action !== "add") body.target = v.target || undefined;
      if (v.field === "phone" && v.country.trim() && v.action !== "remove") {
        body.country = v.country.trim();
      }
      return body;
    }
    case "whatsapp":
      return { field: "whatsapp", target: v.target, value: v.whatsapp, ...note };
    case "categories":
      return { field: "categories", value: splitList(v.categories), ...note };
    case "location": {
      const value: Record<string, string | null> = {};
      for (const key of LOCATION_KEYS) value[key] = v[key].trim() || null;
      value.country = v.locationCountry.trim() || null;
      return { field: "location", value, ...note };
    }
  }
}

/** Maps schema and API paths (value, target, value.region, value.1) onto the inputs. */
export function correctionFieldFor(field: CorrectionField) {
  return (path: PathSegment[]): { field: keyof CorrectionForm; prefix?: string } => {
    const [head, second] = path;
    if (head === "target") return { field: "target" };
    if (head === "note") return { field: "note" };
    if (head === "country") return { field: "country" };
    if (head === "value") {
      if (field === "categories") {
        return {
          field: "categories",
          prefix: typeof second === "number" ? `Category ${second + 1}: ` : "",
        };
      }
      if (field === "location") {
        if (second === "country") return { field: "locationCountry" };
        if (typeof second === "string" && (LOCATION_KEYS as readonly string[]).includes(second)) {
          return { field: second as keyof CorrectionForm };
        }
        return { field: "street" };
      }
      if (field === "whatsapp") return { field: "whatsapp" };
      return { field: "value" };
    }
    return { field: "value" };
  };
}

function defaults(
  detail: BusinessDetail,
  target: CorrectionTarget,
  orgCountry: string,
): CorrectionForm {
  const loc = detail.location.value;
  const firstPhone = detail.phones.find((p) => p.e164)?.e164 ?? "";
  const firstEmail = detail.emails.find((e) => e.address)?.address ?? "";
  const field = target.field;
  const action: CorrectionAction =
    target.action ??
    (field === "phone" && detail.phones.length === 0
      ? "add"
      : field === "email" && detail.emails.length === 0
        ? "add"
        : target.target
          ? "replace"
          : "add");
  const currentTarget =
    target.target ??
    (field === "email" ? firstEmail : field === "phone" || field === "whatsapp" ? firstPhone : "");
  const currentValue =
    field === "name"
      ? (detail.name.value ?? "")
      : field === "website"
        ? (detail.website.value ?? "")
        : field === "phone" && action === "replace"
          ? (detail.phones.find((p) => p.e164 === currentTarget)?.international ?? "")
          : field === "email" && action === "replace"
            ? currentTarget
            : "";
  return {
    field,
    action,
    target: currentTarget,
    value: currentValue,
    removeWebsite: false,
    whatsapp:
      detail.phones.find((p) => p.e164 === currentTarget)?.whatsapp.status === "user_asserted"
        ? "unknown"
        : "user_asserted",
    country: loc?.country ?? orgCountry,
    categories: detail.categories.map((c) => c.value).join(", "),
    street: loc?.street ?? "",
    locality: loc?.locality ?? "",
    lga: loc?.lga ?? "",
    region: loc?.region ?? "",
    postalCode: loc?.postalCode ?? "",
    locationCountry: loc?.country ?? orgCountry,
    note: "",
  };
}

export interface CorrectionDialogProps {
  detail: BusinessDetail;
  /** Field (and value) to correct; null closes the dialog. */
  target: CorrectionTarget | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Corrections, one field per PATCH /businesses/:id. Validation uses the contracts'
 * CorrectionRequest schema; the server's 400 details land on the same inputs. Not optimistic:
 * the response (normalized value, new state, provenance) replaces the cached detail.
 */
export function CorrectionDialog({ detail, target, onOpenChange }: CorrectionDialogProps) {
  const { org } = useWorkspace();
  const correct = useCorrectBusiness(detail.id);
  const open = target !== null;
  const form = useForm<CorrectionForm>({
    defaultValues: defaults(detail, target ?? { field: "name" }, org.country ?? "NG"),
    resolver: (values, ctx, opts) =>
      schemaResolver<CorrectionForm>(
        CorrectionRequest,
        toCorrectionRequest,
        correctionFieldFor(values.field),
      )(values, ctx, opts),
  });

  useEffect(() => {
    if (open && target) {
      form.reset(defaults(detail, target, org.country ?? "NG"));
      correct.reset();
    }
    // Reset when the dialog opens for a target, not on every detail refetch.
  }, [open, target?.field, target?.target, target?.action]);

  const field = form.watch("field");
  const action = form.watch("action");
  const removeWebsite = form.watch("removeWebsite");
  const { errors, isSubmitting } = form.formState;

  const phones = detail.phones.filter((p) => p.e164);
  const emails = detail.emails.filter((e) => e.address);

  const submit = form.handleSubmit(async (values) => {
    try {
      await correct.mutateAsync(CorrectionRequest.parse(toCorrectionRequest(values)));
      toast.success("Correction saved", {
        description: "Recorded as a manual observation. The value stays unverified until checked.",
      });
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err, correctionFieldFor(values.field));
    }
  });

  const serverError =
    correct.error && !(isApiError(correct.error) && correct.error.code === "VALIDATION_FAILED")
      ? correct.error
      : null;

  const reg = (name: keyof CorrectionForm) => ({
    ...form.register(name),
    error: errors[name]?.message,
  });

  const targetSelect = (label: string, options: { value: string; label: string }[]) => (
    <FormField id="corr-target" label={label} required error={errors.target?.message}>
      <Controller
        control={form.control}
        name="target"
        render={({ field: f }) => (
          <Select value={f.value || undefined} onValueChange={f.onChange}>
            <SelectTrigger
              id="corr-target"
              className="h-12"
              aria-invalid={Boolean(errors.target) || undefined}
            >
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FormField>
  );

  const multiAction = (noun: string, count: number) => (
    <Controller
      control={form.control}
      name="action"
      render={({ field: f }) => (
        <fieldset className="flex min-w-0 flex-col">
          <legend className="mb-2 text-sm font-medium">What do you want to do?</legend>
          <RadioGroup
            aria-label={`Change to the ${noun}`}
            value={f.value}
            onValueChange={(v) => {
              f.onChange(v);
              if (v === "add") form.setValue("value", "");
            }}
            className="flex flex-row flex-wrap gap-x-6 gap-y-2"
          >
            {(
              [
                { value: "add", label: "Add" },
                { value: "replace", label: "Replace", disabled: count === 0 },
                { value: "remove", label: "Remove", disabled: count === 0 },
              ] as const
            ).map((o) => (
              <ChoiceField
                key={o.value}
                id={`corr-action-${o.value}`}
                label={o.label}
                control={
                  <RadioGroupItem value={o.value} disabled={"disabled" in o ? o.disabled : false} />
                }
              />
            ))}
          </RadioGroup>
        </fieldset>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (isSubmitting ? undefined : onOpenChange(o))}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Correct details</DialogTitle>
            <DialogDescription>
              One field at a time. Each correction is saved as a manual observation in the
              provenance trail; the corrected value is unverified until a check confirms it.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
            <FormField id="corr-field" label="Field">
              <Controller
                control={form.control}
                name="field"
                render={({ field: f }) => (
                  <Select
                    value={f.value}
                    onValueChange={(v) => {
                      const next = defaults(
                        detail,
                        { field: v as CorrectionField },
                        org.country ?? "NG",
                      );
                      form.reset({ ...next, note: form.getValues("note") });
                    }}
                  >
                    <SelectTrigger id="corr-field" className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            {field === "name" ? (
              <TextField
                id="corr-value"
                label="Business name"
                required
                autoComplete="off"
                {...reg("value")}
              />
            ) : null}

            {field === "website" ? (
              <>
                <TextField
                  id="corr-value"
                  label="Website"
                  inputMode="url"
                  autoComplete="off"
                  disabled={removeWebsite}
                  hint="Domain or full address. Social profile links are not accepted."
                  {...reg("value")}
                />
                <Controller
                  control={form.control}
                  name="removeWebsite"
                  render={({ field: f }) => (
                    <ChoiceField
                      id="corr-remove-website"
                      label="Remove the website"
                      description="Use when the business has no website or the one listed is wrong."
                      control={
                        <Checkbox
                          checked={f.value}
                          onCheckedChange={(v) => f.onChange(v === true)}
                        />
                      }
                    />
                  )}
                />
              </>
            ) : null}

            {field === "phone" ? (
              <>
                {multiAction("phone numbers", phones.length)}
                {action !== "add"
                  ? targetSelect(
                      action === "remove" ? "Number to remove" : "Number to replace",
                      phones.map((p) => ({
                        value: p.e164 ?? "",
                        label: p.international ?? p.e164 ?? "",
                      })),
                    )
                  : null}
                {action !== "remove" ? (
                  <>
                    <TextField
                      id="corr-value"
                      label={action === "add" ? "Phone number" : "New number"}
                      required
                      inputMode="tel"
                      autoComplete="off"
                      {...reg("value")}
                    />
                    <TextField
                      id="corr-country"
                      label="Country for numbers without a code"
                      maxLength={2}
                      autoComplete="off"
                      hint="Two-letter code, for example NG."
                      {...reg("country")}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {field === "email" ? (
              <>
                {multiAction("email addresses", emails.length)}
                {action !== "add"
                  ? targetSelect(
                      action === "remove" ? "Address to remove" : "Address to replace",
                      emails.map((e) => ({ value: e.address ?? "", label: e.address ?? "" })),
                    )
                  : null}
                {action !== "remove" ? (
                  <TextField
                    id="corr-value"
                    label={action === "add" ? "Email address" : "New address"}
                    required
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    {...reg("value")}
                  />
                ) : null}
              </>
            ) : null}

            {field === "whatsapp" ? (
              phones.length === 0 ? (
                <Banner
                  tone="info"
                  title="Add a phone number first"
                  description="WhatsApp status belongs to a phone number on this business."
                />
              ) : (
                <>
                  {targetSelect(
                    "Phone number",
                    phones.map((p) => ({
                      value: p.e164 ?? "",
                      label: p.international ?? p.e164 ?? "",
                    })),
                  )}
                  <Controller
                    control={form.control}
                    name="whatsapp"
                    render={({ field: f }) => (
                      <fieldset className="flex min-w-0 flex-col gap-3">
                        <legend className="mb-2 text-sm font-medium">WhatsApp status</legend>
                        <RadioGroup
                          value={f.value}
                          onValueChange={f.onChange}
                          className="flex flex-col gap-3"
                        >
                          <ChoiceField
                            id="corr-wa-asserted"
                            label="Uses WhatsApp (team-asserted)"
                            description="You or a teammate confirmed it in conversation. Shown as team-asserted, not confirmed."
                            control={<RadioGroupItem value="user_asserted" />}
                          />
                          <ChoiceField
                            id="corr-wa-unknown"
                            label="Unknown"
                            description="Clears a team assertion."
                            control={<RadioGroupItem value="unknown" />}
                          />
                        </RadioGroup>
                        <p className="text-muted-foreground text-xs">
                          Confirmed needs evidence, such as a wa.me link on the business&apos;s own
                          website, and cannot be set by hand.
                        </p>
                      </fieldset>
                    )}
                  />
                </>
              )
            ) : null}

            {field === "categories" ? (
              <TextField
                id="corr-categories"
                label="Categories"
                autoComplete="off"
                hint="Separate with commas. Replaces the whole list; up to 10."
                {...reg("categories")}
              />
            ) : null}

            {field === "location" ? (
              <div className="flex min-w-0 flex-col gap-4">
                <TextField
                  id="corr-street"
                  label="Street address"
                  autoComplete="off"
                  {...reg("street")}
                />
                <div className="grid min-w-0 grid-cols-1 gap-4 min-[480px]:grid-cols-2">
                  <TextField
                    id="corr-locality"
                    label="City or town"
                    autoComplete="off"
                    {...reg("locality")}
                  />
                  <TextField id="corr-lga" label="LGA" autoComplete="off" {...reg("lga")} />
                  <TextField
                    id="corr-region"
                    label="State or region"
                    autoComplete="off"
                    {...reg("region")}
                  />
                  <TextField
                    id="corr-postal"
                    label="Postal code"
                    autoComplete="off"
                    {...reg("postalCode")}
                  />
                </div>
                <TextField
                  id="corr-location-country"
                  label="Country"
                  maxLength={2}
                  autoComplete="off"
                  hint="Two-letter code, for example NG."
                  {...reg("locationCountry")}
                />
              </div>
            ) : null}

            <TextAreaField
              id="corr-note"
              label="Note"
              hint="Optional. Why you made the change, for example “Called and confirmed the new line”."
              maxLength={500}
              className="min-h-[88px]"
              {...reg("note")}
            />

            {serverError ? (
              <ErrorState
                title="Could not save the correction"
                message={friendlyMessage(serverError)}
                requestId={requestIdOf(serverError)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="text"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={field === "whatsapp" && phones.length === 0}
              variant={
                (field === "phone" || field === "email") && action === "remove"
                  ? "destructive"
                  : "primary"
              }
            >
              {(field === "phone" || field === "email") && action === "remove"
                ? "Remove"
                : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
