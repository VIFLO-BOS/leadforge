"use client";

import { SuppressRequest, type BusinessDetail, type SuppressionScope } from "@leadforge/contracts";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Button,
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
  toast,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { applyServerErrors, schemaResolver, type PathSegment } from "@/lib/forms";
import { useSuppressBusiness } from "@/lib/hooks/use-businesses";

interface SuppressForm {
  scope: SuppressionScope;
  value: string;
  reason: string;
}

function toBody(v: SuppressForm): Record<string, unknown> {
  return {
    scope: v.scope,
    reason: v.reason,
    ...((v.scope === "phone" || v.scope === "email") && v.value ? { value: v.value } : {}),
  };
}

function fieldFor(path: PathSegment[]): { field: keyof SuppressForm } {
  const [head] = path;
  return { field: head === "value" ? "value" : head === "scope" ? "scope" : "reason" };
}

const resolver = schemaResolver<SuppressForm>(SuppressRequest, toBody, fieldFor);

/**
 * Suppress one business, or everything sharing its domain, a phone or an email
 * (POST /businesses/:id/suppress). Suppression entries are checked at import and export.
 */
export function SuppressDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: BusinessDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const suppress = useSuppressBusiness(detail.id);
  const phones = detail.phones.filter((p) => p.e164);
  const emails = detail.emails.filter((e) => e.address);
  const form = useForm<SuppressForm>({
    resolver,
    defaultValues: { scope: "business", value: "", reason: "" },
  });
  const scope = form.watch("scope");
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) {
      form.reset({ scope: "business", value: "", reason: "" });
      suppress.reset();
    }
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await suppress.mutateAsync(SuppressRequest.parse(toBody(values)));
      toast.success(values.scope === "business" ? "Business suppressed" : "Suppression added", {
        description:
          values.scope === "business"
            ? "It is hidden from the directory by default and never exported."
            : "Every business that matches is now suppressed.",
      });
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err, fieldFor);
    }
  });

  const serverError =
    suppress.error && !(isApiError(suppress.error) && suppress.error.code === "VALIDATION_FAILED")
      ? suppress.error
      : null;

  const scopes: {
    value: SuppressionScope;
    label: string;
    description: string;
    disabled?: boolean;
  }[] = [
    {
      value: "business",
      label: "This business only",
      description: "Hide this record and keep it out of exports.",
    },
    {
      value: "domain",
      label: detail.website.domain ? `Everything on ${detail.website.domain}` : "Website domain",
      description: detail.website.domain
        ? "Suppress every business with this website domain, now and in future imports."
        : "This business has no website domain.",
      disabled: !detail.website.domain,
    },
    {
      value: "phone",
      label: "A phone number",
      description: phones.length
        ? "Suppress every business with the chosen number."
        : "This business has no phone number.",
      disabled: phones.length === 0,
    },
    {
      value: "email",
      label: "An email address",
      description: emails.length
        ? "Suppress every business with the chosen address."
        : "This business has no email address.",
      disabled: emails.length === 0,
    },
  ];

  const valueOptions =
    scope === "phone"
      ? phones.map((p) => ({ value: p.e164 ?? "", label: p.international ?? p.e164 ?? "" }))
      : scope === "email"
        ? emails.map((e) => ({ value: e.address ?? "", label: e.address ?? "" }))
        : [];

  return (
    <Dialog open={open} onOpenChange={(o) => (isSubmitting ? undefined : onOpenChange(o))}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Suppress</DialogTitle>
            <DialogDescription>
              Suppressed businesses are hidden from the directory by default, never exported and
              skipped by imports that match them. You can remove the suppression later.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
            <Controller
              control={form.control}
              name="scope"
              render={({ field }) => (
                <fieldset className="flex min-w-0 flex-col">
                  <legend className="mb-3 text-sm font-medium">What to suppress</legend>
                  <RadioGroup
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      const first =
                        v === "phone"
                          ? (phones[0]?.e164 ?? "")
                          : v === "email"
                            ? (emails[0]?.address ?? "")
                            : "";
                      form.setValue("value", first);
                    }}
                    className="flex flex-col gap-3"
                  >
                    {scopes.map((s) => (
                      <ChoiceField
                        key={s.value}
                        id={`supp-scope-${s.value}`}
                        label={s.label}
                        description={s.description}
                        control={<RadioGroupItem value={s.value} disabled={s.disabled} />}
                      />
                    ))}
                  </RadioGroup>
                  {errors.scope?.message ? (
                    <p role="alert" className="text-destructive mt-2 text-xs">
                      {errors.scope.message}
                    </p>
                  ) : null}
                </fieldset>
              )}
            />
            {scope === "phone" || scope === "email" ? (
              <FormField
                id="supp-value"
                label={scope === "phone" ? "Phone number" : "Email address"}
                required
                error={errors.value?.message}
              >
                <Controller
                  control={form.control}
                  name="value"
                  render={({ field }) => (
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <SelectTrigger id="supp-value" className="h-12">
                        <SelectValue placeholder="Choose one" />
                      </SelectTrigger>
                      <SelectContent>
                        {valueOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            ) : null}
            <TextAreaField
              id="supp-reason"
              label="Reason"
              required
              maxLength={500}
              hint="Recorded with the suppression and in the audit log."
              className="min-h-[96px]"
              error={errors.reason?.message}
              {...form.register("reason")}
            />
            {serverError ? (
              <ErrorState
                title="Could not suppress"
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
            <Button type="submit" variant="destructive" loading={isSubmitting}>
              Suppress
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
