"use client";

import {
  CRM_LIMITS,
  CreateActivityRequest,
  LogOutreachAttemptRequest,
  type ActivityOutcome,
  type LoggableActivityType,
  type OutreachRecord,
} from "@leadforge/contracts";
import {
  CalendarClock,
  Mail,
  MessageCircle,
  Phone,
  ShieldAlert,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm, type FieldErrors, type Resolver } from "react-hook-form";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  Heading,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextAreaField,
  TextField,
  cn,
  toast,
} from "@leadforge/ui";
import {
  LOGGABLE_TYPES,
  activityNoun,
  activityTypeLabel,
  channelLabel,
  fromLocalInput,
  hasDirection,
  isContactSuppressed,
  isContactType,
  outcomeError,
  outcomeLabel,
  outcomesFor,
  toLocalInput,
} from "@/lib/crm";
import { friendlyMessage, requestIdOf, validationDetails } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useCreateActivity, useLogOutreachAttempt } from "@/lib/hooks/use-activities";

export interface ActivityTarget {
  id: string;
  name: string;
  suppressed: boolean;
  /** Phone numbers on record (E.164 or display form) offered as quick picks. */
  phones: string[];
  emails: string[];
}

export const TYPE_ICONS: Record<string, LucideIcon> = {
  note: StickyNote,
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: CalendarClock,
};

const NO_OUTCOME = "__none";

export interface ActivityFormValues {
  type: LoggableActivityType;
  direction: "outbound" | "inbound";
  outcome: string;
  body: string;
  target: string;
  occurredAt: string;
  overrideReason: string;
}

type FieldName = keyof ActivityFormValues;

/** Request body for POST /activities from the form (the override reason only on the second step). */
export function activityBody(
  businessId: string,
  v: ActivityFormValues,
  withOverride: boolean,
): Record<string, unknown> {
  const contact = isContactType(v.type);
  return {
    businessId,
    type: v.type,
    body: v.body.trim() || undefined,
    outcome: v.outcome && v.outcome !== NO_OUTCOME ? v.outcome : undefined,
    direction: hasDirection(v.type) ? v.direction : undefined,
    occurredAt: fromLocalInput(v.occurredAt),
    target: contact && v.type !== "meeting" ? v.target.trim() || undefined : undefined,
    suppressionOverride: withOverride ? { reason: v.overrideReason.trim() } : undefined,
  };
}

function fieldForPath(path: (string | number)[]): FieldName {
  const head = String(path[0] ?? "");
  if (head === "suppressionOverride") return "overrideReason";
  if (
    head === "body" ||
    head === "outcome" ||
    head === "target" ||
    head === "occurredAt" ||
    head === "direction" ||
    head === "type"
  ) {
    return head as FieldName;
  }
  return "body";
}

const PLAIN: Partial<Record<FieldName, string>> = {
  target: "Enter a phone number or email address of at least 3 characters.",
  overrideReason: "Give a reason of at least 10 characters (at most 500).",
  occurredAt: "Enter a valid date and time.",
};

/**
 * Validates with the contracts' request schema (CreateActivityRequest, or the outreach attempt
 * schema) plus the rules the API enforces beyond it: notes need text, and each type accepts only
 * its own outcomes.
 */
export function activityResolver(
  businessId: string,
  mode: "activity" | "attempt",
  withOverride: () => boolean,
): Resolver<ActivityFormValues> {
  return async (values) => {
    const errors: Partial<Record<FieldName, { type: string; message: string }>> = {};
    const set = (f: FieldName, message: string) => {
      if (!errors[f]) errors[f] = { type: "validation", message };
    };
    const body = activityBody(businessId, values, withOverride());
    const schema = mode === "attempt" ? LogOutreachAttemptRequest : CreateActivityRequest;
    const toCheck =
      mode === "attempt"
        ? {
            outcome: body.outcome,
            body: body.body,
            occurredAt: body.occurredAt,
            target: body.target,
            suppressionOverride: body.suppressionOverride,
          }
        : body;
    const parsed = schema.safeParse(toCheck);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const f = fieldForPath(issue.path as (string | number)[]);
        set(f, PLAIN[f] ?? issue.message);
      }
    }
    const outcome = outcomeError(values.type, body.outcome as string | undefined);
    if (outcome) set("outcome", outcome);
    if (values.type === "note" && !values.body.trim()) set("body", "Write the note.");
    if (values.occurredAt && !fromLocalInput(values.occurredAt))
      set("occurredAt", PLAIN.occurredAt!);
    const at = fromLocalInput(values.occurredAt);
    if (at && new Date(at).getTime() > Date.now() + 5 * 60_000) {
      set("occurredAt", "Use a time that has passed (at most 5 minutes ahead).");
    }
    if (Object.keys(errors).length)
      return { values: {}, errors: errors as FieldErrors<ActivityFormValues> };
    return { values, errors: {} };
  };
}

/**
 * Logs a note, call, WhatsApp message, email or meeting on a business (POST /activities), or an
 * attempt on an outreach record (POST /outreach/:id/attempts). Outcomes come from the contracts'
 * per-type list. Contact with a suppressed business or contact is refused with 409
 * CONTACT_SUPPRESSED; the dialog then asks for a reason, which is stored and audited, and logs
 * it with `suppressionOverride`.
 */
export function LogActivityDialog({
  open,
  onOpenChange,
  business,
  defaultType = "note",
  outreach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business: ActivityTarget;
  defaultType?: LoggableActivityType;
  /** Log an attempt on this outreach record (its channel fixes the type). */
  outreach?: OutreachRecord | null;
}) {
  const id = useId();
  const create = useCreateActivity();
  const attempt = useLogOutreachAttempt();
  const mode = outreach ? "attempt" : "activity";
  const [step, setStep] = useState<"form" | "override">("form");
  const stepRef = useRef(step);
  stepRef.current = step;
  const overrideHeading = useRef<HTMLHeadingElement>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const fixedType = outreach ? (outreach.channel as LoggableActivityType) : null;

  const defaults = (): ActivityFormValues => ({
    type: fixedType ?? defaultType,
    direction: "outbound",
    outcome: NO_OUTCOME,
    body: "",
    target: outreach?.target ?? "",
    occurredAt: toLocalInput(new Date()),
    overrideReason: "",
  });

  const form = useForm<ActivityFormValues>({
    defaultValues: defaults(),
    resolver: activityResolver(business.id, mode, () => stepRef.current === "override"),
    shouldFocusError: true,
  });

  useEffect(() => {
    if (open) {
      form.reset(defaults());
      setStep("form");
      setFailure(null);
    }
    // Reset only when the dialog opens (defaults and form are stable for an open dialog).
  }, [open]);

  useEffect(() => {
    if (step === "override") overrideHeading.current?.focus();
  }, [step]);

  const type = form.watch("type");
  const outcome = form.watch("outcome");
  const options = outcomesFor(type);
  // A type change can leave an outcome the new type does not accept: clear it.
  useEffect(() => {
    if (outcome !== NO_OUTCOME && !options.includes(outcome as ActivityOutcome)) {
      form.setValue("outcome", NO_OUTCOME);
    }
  }, [type]);

  const pending = create.isPending || attempt.isPending;
  const contact = isContactType(type);
  const { errors } = form.formState;
  const label = activityTypeLabel(type);

  const onSuccess = (res: { outreach: OutreachRecord | null }) => {
    onOpenChange(false);
    toast.success(`${label} logged`, {
      description: res.outreach
        ? `Counted as attempt ${res.outreach.attempts} on the ${channelLabel(res.outreach.channel)} outreach record.`
        : undefined,
    });
  };
  const onError = (err: unknown) => {
    if (isContactSuppressed(err)) {
      setFailure(null);
      setStep("override");
      return;
    }
    const details = validationDetails(err);
    const paths = Object.keys(details);
    if (paths.length) {
      for (const p of paths) {
        form.setError(fieldForPath(p.split(".")), { type: "server", message: details[p]! });
      }
      if (paths.some((p) => p.startsWith("suppressionOverride"))) setStep("override");
      return;
    }
    setFailure(err);
  };

  const submit = form.handleSubmit((v) => {
    setFailure(null);
    const body = activityBody(business.id, v, stepRef.current === "override");
    if (outreach) {
      attempt.mutate(
        {
          id: outreach.id,
          body: {
            outcome: body.outcome as ActivityOutcome | undefined,
            body: body.body as string | undefined,
            occurredAt: body.occurredAt as string | undefined,
            target: body.target as string | undefined,
            suppressionOverride: body.suppressionOverride as { reason: string } | undefined,
          },
        },
        { onSuccess, onError },
      );
    } else {
      create.mutate(body as CreateActivityRequest, { onSuccess, onError });
    }
  });

  const targetLabel = type === "email" ? "Email address" : "Phone number";
  const picks =
    type === "email"
      ? business.emails
      : type === "call" || type === "whatsapp"
        ? business.phones
        : [];
  const values = form.getValues();

  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      <DialogContent data-testid="log-activity-dialog">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>
              {outreach
                ? `Log a ${channelLabel(outreach.channel).toLowerCase()} attempt`
                : "Log activity"}
            </DialogTitle>
            <DialogDescription>
              {step === "override"
                ? `${business.name} is suppressed.`
                : `On ${business.name}. Activities are visible to everyone in the workspace.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
            {step === "override" ? (
              <div className="flex min-w-0 flex-col gap-4" data-testid="suppression-override">
                <Heading
                  ref={overrideHeading}
                  tabIndex={-1}
                  className="text-base font-medium outline-none"
                >
                  Log contact with a suppressed business?
                </Heading>
                <Banner
                  tone="warning"
                  icon={ShieldAlert}
                  title="This business or contact is suppressed"
                  description="Suppressed businesses, numbers and addresses are not to be contacted. If this contact already happened, or the business asked you to get in touch, give the reason. It is stored with the activity and the outreach record, and written to the audit log with your name."
                />
                <p className="text-muted-foreground text-sm">
                  Logging: {label}
                  {values.outcome && values.outcome !== NO_OUTCOME
                    ? ` · ${outcomeLabel(values.outcome)}`
                    : ""}
                  {values.occurredAt && fromLocalInput(values.occurredAt)
                    ? ` · ${formatDateTime(fromLocalInput(values.occurredAt)!)}`
                    : ""}
                </p>
                <TextAreaField
                  id={`${id}-reason`}
                  label="Reason for logging this contact"
                  required
                  rows={3}
                  maxLength={500}
                  hint="For example: the business called us back and asked for a quote. 10 to 500 characters."
                  error={errors.overrideReason?.message}
                  {...form.register("overrideReason")}
                />
              </div>
            ) : (
              <>
                {fixedType ? null : (
                  <div className="flex min-w-0 flex-col gap-2">
                    <p id={`${id}-type-label`} className="text-sm font-medium">
                      Type
                    </p>
                    <Controller
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <RadioGroup
                          value={field.value}
                          onValueChange={(v) => field.onChange(v as LoggableActivityType)}
                          aria-labelledby={`${id}-type-label`}
                          className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3"
                        >
                          {LOGGABLE_TYPES.map((t) => {
                            const Icon = TYPE_ICONS[t] ?? StickyNote;
                            const checked = field.value === t;
                            return (
                              <label
                                key={t}
                                htmlFor={`${id}-type-${t}`}
                                className={cn(
                                  "state-layer transition-ui flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm",
                                  checked ? "border-primary bg-primary-subtle" : "border-input",
                                )}
                              >
                                <RadioGroupItem id={`${id}-type-${t}`} value={t} />
                                <Icon
                                  aria-hidden
                                  className="text-muted-foreground size-4 shrink-0"
                                />
                                <span className="min-w-0 break-words">{activityTypeLabel(t)}</span>
                              </label>
                            );
                          })}
                        </RadioGroup>
                      )}
                    />
                  </div>
                )}

                {business.suppressed && contact ? (
                  <Banner
                    tone="warning"
                    icon={ShieldAlert}
                    title="This business is suppressed"
                    description="Logging contact with it needs a reason, which is recorded and audited. You will be asked when you save."
                  />
                ) : null}

                {hasDirection(type) && !fixedType ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    <p id={`${id}-dir-label`} className="text-sm font-medium">
                      Direction
                    </p>
                    <Controller
                      control={form.control}
                      name="direction"
                      render={({ field }) => (
                        <RadioGroup
                          value={field.value}
                          onValueChange={field.onChange}
                          aria-labelledby={`${id}-dir-label`}
                          aria-describedby={`${id}-dir-hint`}
                          className="flex flex-wrap gap-x-6 gap-y-2"
                        >
                          {(["outbound", "inbound"] as const).map((d) => (
                            <label
                              key={d}
                              htmlFor={`${id}-dir-${d}`}
                              className="flex items-center gap-2 text-sm"
                            >
                              <RadioGroupItem id={`${id}-dir-${d}`} value={d} />
                              {d === "outbound" ? "We contacted them" : "They contacted us"}
                            </label>
                          ))}
                        </RadioGroup>
                      )}
                    />
                    <p id={`${id}-dir-hint`} className="text-muted-foreground text-xs">
                      Outbound contact counts as an attempt on the business&apos;s outreach record
                      for this channel; inbound contact marks it replied.
                    </p>
                  </div>
                ) : null}

                {type !== "note" ? (
                  <FormField id={`${id}-outcome`} label="Outcome" error={errors.outcome?.message}>
                    <Controller
                      control={form.control}
                      name="outcome"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            id={`${id}-outcome`}
                            className="h-12"
                            aria-invalid={errors.outcome ? true : undefined}
                            aria-describedby={errors.outcome ? `${id}-outcome-error` : undefined}
                            ref={field.ref}
                          >
                            <SelectValue placeholder="Choose an outcome" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_OUTCOME}>No outcome recorded</SelectItem>
                            {options.map((o) => (
                              <SelectItem key={o} value={o}>
                                {outcomeLabel(o)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </FormField>
                ) : null}

                {contact && type !== "meeting" ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    <TextField
                      id={`${id}-target`}
                      label={`${targetLabel} (optional)`}
                      type={type === "email" ? "email" : "tel"}
                      autoComplete="off"
                      hint="Checked against the suppression list."
                      error={errors.target?.message}
                      {...form.register("target")}
                    />
                    {picks.length ? (
                      <div
                        className="flex min-w-0 flex-wrap items-center gap-1.5"
                        aria-label={`${targetLabel}s on record`}
                        role="group"
                      >
                        {picks.slice(0, 4).map((p) => (
                          <Button
                            key={p}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="max-w-full"
                            onClick={() => form.setValue("target", p, { shouldValidate: false })}
                          >
                            <span className="truncate">Use {p}</span>
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <TextAreaField
                  id={`${id}-body`}
                  label={type === "note" ? "Note" : "Notes (optional)"}
                  required={type === "note"}
                  rows={4}
                  maxLength={CRM_LIMITS.activityBodyMax}
                  hint={`Plain text, up to ${CRM_LIMITS.activityBodyMax.toLocaleString()} characters.`}
                  error={errors.body?.message}
                  {...form.register("body")}
                />

                <TextField
                  id={`${id}-when`}
                  label="When"
                  type="datetime-local"
                  hint="Defaults to now. Your local time."
                  error={errors.occurredAt?.message}
                  {...form.register("occurredAt")}
                />
              </>
            )}
            {failure ? (
              <ErrorState
                title={`Could not log the ${activityNoun(type)}`}
                message={friendlyMessage(failure)}
                requestId={requestIdOf(failure)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            {step === "override" ? (
              <Button
                type="button"
                variant="text"
                disabled={pending}
                onClick={() => setStep("form")}
              >
                Back
              </Button>
            ) : (
              <Button
                type="button"
                variant="text"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" loading={pending}>
              {step === "override" ? "Log with override" : `Log ${activityNoun(type)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { NO_OUTCOME };
