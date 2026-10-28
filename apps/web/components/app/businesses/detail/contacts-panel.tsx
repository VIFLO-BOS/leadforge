"use client";

import type {
  BusinessDetail,
  BusinessEmailField,
  BusinessPhoneField,
  FieldState,
  Observation,
} from "@leadforge/contracts";
import { ExternalLink, MailCheck, Pencil, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyableValue,
  FieldStatus,
  Separator,
  StatusIndicator,
} from "@leadforge/ui";
import { MAILBOX_NOTE, MAILBOX_NOT_CONFIRMED, emailCheckMeta } from "@/lib/enrichment";
import { formatDate, formatDateTime, formatRelative, safeHttpUrl } from "@/lib/format";
import { sourceLabel } from "@/lib/labels";
import { WhatsAppIndicator, fullLocation } from "../shared";
import type { CorrectionTarget } from "./correction-dialog";

type FieldMetaLike = {
  state: FieldState;
  observationIds: string[];
  lastObservedAt: string | null;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
};

const PHONE_TYPE: Record<BusinessPhoneField["type"], string> = {
  mobile: "Mobile",
  fixed_line: "Landline",
  fixed_line_or_mobile: "Landline or mobile",
  toll_free: "Toll-free",
  voip: "VoIP",
  other: "Other",
  unknown: "Type unknown",
};

/** Phase 4 actions on contact values. Each is omitted when it does not apply. */
export interface ContactActions {
  /** Opens the refresh confirmation (re-collect from the website, re-analyze it). */
  onRefresh?: () => void;
  /** Why refresh is not offered (no website, suppressed, role), shown instead of a button. */
  refreshUnavailable?: string;
  /** Runs the free email check (syntax, mail server, disposable domain) for one address. */
  onCheckEmail?: (address: string) => void;
  /** Addresses with a check queued or running. */
  checkingEmails?: ReadonlySet<string>;
}

/** Sources behind a value, from the observations the detail response includes. */
export function sourcesFor(ids: string[], observations: Observation[]): string[] {
  const byId = new Map(observations.map((o) => [o.id, o.source]));
  const out = new Set<string>();
  for (const id of ids) {
    const s = byId.get(id);
    if (s) out.add(sourceLabel(s));
  }
  return [...out];
}

/** "Observed 3 days ago via CSV import · verified 12 Oct 2026" */
function Provenance({ meta, observations }: { meta: FieldMetaLike; observations: Observation[] }) {
  const sources = sourcesFor(meta.observationIds, observations);
  const parts: string[] = [];
  if (meta.lastObservedAt) {
    parts.push(
      `Observed ${formatRelative(meta.lastObservedAt)}${sources.length ? ` via ${sources.join(", ")}` : ""}`,
    );
  } else if (sources.length) {
    parts.push(`From ${sources.join(", ")}`);
  }
  if (meta.lastVerifiedAt) parts.push(`verified ${formatDate(meta.lastVerifiedAt)}`);
  if (meta.observationIds.length > 1) parts.push(`${meta.observationIds.length} observations`);
  if (parts.length === 0) return null;
  return (
    <p
      className="text-muted-foreground text-xs"
      title={meta.lastObservedAt ? formatDateTime(meta.lastObservedAt) : undefined}
    >
      {parts.join(" · ")}
    </p>
  );
}

/** The value as a source recorded it, when it differs from every normalized form shown. */
function RawValue({
  raw,
  normalized,
  mono = true,
}: {
  raw: string | null;
  normalized: (string | null | undefined)[];
  mono?: boolean;
}) {
  if (!raw || normalized.includes(raw)) return null;
  return (
    <p className="text-muted-foreground break-anywhere text-xs">
      As observed:{" "}
      <span className={mono ? "text-foreground font-mono" : "text-foreground"}>{raw}</span>
    </p>
  );
}

function ExpiredValue({ meta, actions }: { meta: FieldMetaLike; actions?: ContactActions }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-muted-foreground text-sm">
        Hidden: the source&apos;s retention period ended
        {meta.expiresAt ? ` on ${formatDate(meta.expiresAt)}` : ""}. The record of when it was
        collected is kept.
      </p>
      {actions?.onRefresh ? (
        <div className="flex flex-col items-start gap-1">
          <Button variant="outline" size="sm" onClick={actions.onRefresh}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
          <p className="text-muted-foreground text-xs">
            Collects contacts again from the business&apos;s website (free) and re-analyzes it (1
            credit).
          </p>
        </div>
      ) : actions?.refreshUnavailable ? (
        <p className="text-muted-foreground text-xs" data-testid="refresh-unavailable">
          {actions.refreshUnavailable}
        </p>
      ) : null}
    </div>
  );
}

function CorrectButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="text" size="sm" onClick={onClick} aria-label={label} className="shrink-0">
      <Pencil aria-hidden /> Correct
    </Button>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-[0.06em]">
          {title}
          {typeof count === "number" && count > 1 ? ` (${count})` : ""}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function PhoneRow({
  phone,
  observations,
  onCorrect,
  actions,
}: {
  phone: BusinessPhoneField;
  observations: Observation[];
  onCorrect?: (t: CorrectionTarget) => void;
  actions?: ContactActions;
}) {
  const expired = phone.state === "expired" || !phone.e164;
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2" data-field="phone" data-state={phone.state}>
      <div className="flex min-w-0 flex-wrap items-start justify-end gap-x-2">
        <div className="min-w-[min(100%,11rem)] flex-1">
          {expired ? (
            <ExpiredValue meta={phone} actions={actions} />
          ) : (
            <CopyableValue
              value={phone.e164 ?? ""}
              display={phone.international ?? phone.e164}
              label={`phone number ${phone.international ?? phone.e164}`}
              mono={false}
            />
          )}
        </div>
        {onCorrect && !expired ? (
          <CorrectButton
            label={`Correct phone ${phone.international ?? phone.e164}`}
            onClick={() =>
              onCorrect({ field: "phone", target: phone.e164 ?? undefined, action: "replace" })
            }
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <FieldStatus state={phone.state} size="sm" />
        <WhatsAppIndicator status={phone.whatsapp.status} size="sm" />
        <span className="text-muted-foreground text-xs">
          {PHONE_TYPE[phone.type]}
          {phone.country ? ` · ${phone.country}` : ""}
        </span>
      </div>
      {phone.whatsapp.status === "user_asserted" && phone.whatsapp.assertedAt ? (
        <p className="text-muted-foreground text-xs">
          Marked as WhatsApp by a team member {formatRelative(phone.whatsapp.assertedAt)}
        </p>
      ) : null}
      <RawValue
        raw={phone.rawValue}
        normalized={[phone.international, phone.value, phone.national]}
      />
      <Provenance meta={phone} observations={observations} />
    </li>
  );
}

function EmailRow({
  email,
  observations,
  onCorrect,
  actions,
}: {
  email: BusinessEmailField;
  observations: Observation[];
  onCorrect?: (t: CorrectionTarget) => void;
  actions?: ContactActions;
}) {
  const expired = email.state === "expired" || !email.address;
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2" data-field="email" data-state={email.state}>
      <div className="flex min-w-0 flex-wrap items-start justify-end gap-x-2">
        <div className="min-w-[min(100%,11rem)] flex-1">
          {expired ? (
            <ExpiredValue meta={email} actions={actions} />
          ) : (
            <CopyableValue
              value={email.address ?? ""}
              label={`email ${email.address}`}
              mono={false}
            />
          )}
        </div>
        {onCorrect && !expired ? (
          <CorrectButton
            label={`Correct email ${email.address}`}
            onClick={() =>
              onCorrect({ field: "email", target: email.address ?? undefined, action: "replace" })
            }
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <FieldStatus state={email.state} size="sm" />
        {!expired ? (
          <span
            className="text-muted-foreground text-xs"
            title={MAILBOX_NOTE}
            data-testid="mailbox-not-confirmed"
          >
            {MAILBOX_NOT_CONFIRMED}
          </span>
        ) : null}
        <span
          className="text-muted-foreground text-xs"
          data-email-kind={email.kind}
          title={
            email.kind === "free_mail"
              ? "A consumer mailbox provider (for example gmail.com). It may belong to a person rather than the business; handle it with care under data-protection rules."
              : "An address on the business's own or another organization's domain."
          }
        >
          {email.kind === "free_mail" ? "Free-mail address" : "Business-domain address"}
        </span>
      </div>
      {email.verification ? (
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
          data-testid="email-check"
        >
          <StatusIndicator
            tone={emailCheckMeta(email.verification.result).tone}
            label={emailCheckMeta(email.verification.result).label}
            size="sm"
          />
          <span className="text-muted-foreground text-xs">
            Checked {formatDate(email.verification.checkedAt)}
          </span>
        </div>
      ) : !expired ? (
        <p className="text-muted-foreground text-xs">Email not checked yet.</p>
      ) : null}
      {!expired && email.address && actions?.onCheckEmail ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="text"
            size="sm"
            className="-ml-3"
            loading={actions.checkingEmails?.has(email.address)}
            onClick={() => email.address && actions.onCheckEmail?.(email.address)}
            // The visible text starts the name (label in name, WCAG 2.5.3); the address says which.
            aria-label={`${checkLabel(actions.checkingEmails?.has(email.address), Boolean(email.verification))} ${email.address}`}
          >
            <MailCheck aria-hidden />
            {checkLabel(actions.checkingEmails?.has(email.address), Boolean(email.verification))}
          </Button>
        </div>
      ) : null}
      <RawValue raw={email.rawValue} normalized={[email.address]} />
      <Provenance meta={email} observations={observations} />
    </li>
  );
}

/**
 * Contact details with a FieldStatus on every value, conflicting alternatives listed, the
 * WhatsApp tri-state, the raw value where it differs, and where and when each value came from.
 */
export function ContactsPanel({
  detail,
  onCorrect,
  actions,
}: {
  detail: BusinessDetail;
  /** Omitted for roles without businesses:write. */
  onCorrect?: (t: CorrectionTarget) => void;
  /** Refresh and email checks; omitted for roles without analysis:run. */
  actions?: ContactActions;
}) {
  const observations = detail.provenance.recent;
  const w = detail.website;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact details</CardTitle>
        <CardDescription>
          Each value shows its state, its source and when it was last seen. Values are stale after{" "}
          {detail.freshnessDays} days without a new observation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col">
        <Section
          title="Website"
          action={
            onCorrect && w.state !== "expired" ? (
              <CorrectButton
                label="Correct website"
                onClick={() => onCorrect({ field: "website" })}
              />
            ) : null
          }
        >
          {w.state === "missing" ? (
            <div className="flex flex-col gap-1">
              <FieldStatus state="missing" size="sm" />
              <p className="text-muted-foreground text-sm">No source has provided a website.</p>
            </div>
          ) : w.state === "expired" || !w.value ? (
            <ExpiredValue
              meta={w}
              actions={{
                refreshUnavailable:
                  "A refresh needs a website to fetch, so this value cannot be collected again automatically. Correct the website if you know it.",
              }}
            />
          ) : (
            <div
              className="flex min-w-0 flex-col gap-1.5 py-2"
              data-field="website"
              data-state={w.state}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-end gap-1">
                <CopyableValue
                  value={w.value}
                  display={w.domain ?? w.value}
                  label="website"
                  mono={false}
                  className="min-w-[min(100%,8rem)] flex-1"
                />
                {safeHttpUrl(w.value) ? (
                  <a
                    href={safeHttpUrl(w.value) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`Open ${w.domain ?? w.value} in a new tab`}
                    className="state-layer text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
                  >
                    <ExternalLink aria-hidden className="size-4" />
                  </a>
                ) : null}
              </div>
              <FieldStatus state={w.state} size="sm" />
              <RawValue raw={w.rawValue} normalized={[w.value, w.domain]} />
              <Provenance meta={w} observations={observations} />
            </div>
          )}
          {w.state === "conflicting" && w.alternatives.length ? (
            <Alternatives
              items={w.alternatives.map((a) => ({
                key: a.value,
                value: a.value,
                raw: a.rawValue,
                lastObservedAt: a.lastObservedAt,
                sources: sourcesFor(a.observationIds, observations),
              }))}
            />
          ) : null}
        </Section>
        <Separator />
        <Section
          title="Phone"
          count={detail.phones.length}
          action={
            onCorrect ? (
              <Button
                variant="text"
                size="sm"

                onClick={() => onCorrect({ field: "phone", action: "add" })}
              >
                Add phone
              </Button>
            ) : null
          }
        >
          {detail.phones.length === 0 ? (
            <div className="flex flex-col gap-1">
              <FieldStatus state="missing" size="sm" />
              <p className="text-muted-foreground text-sm">No phone number has been observed.</p>
            </div>
          ) : (
            <ul className="divide-border flex min-w-0 flex-col divide-y">
              {detail.phones.map((p, i) => (
                <PhoneRow
                  key={p.e164 ?? `expired-${i}`}
                  phone={p}
                  observations={observations}
                  onCorrect={onCorrect}
                  actions={actions}
                />
              ))}
            </ul>
          )}
        </Section>
        <Separator />
        <Section
          title="Email"
          count={detail.emails.length}
          action={
            onCorrect ? (
              <Button
                variant="text"
                size="sm"

                onClick={() => onCorrect({ field: "email", action: "add" })}
              >
                Add email
              </Button>
            ) : null
          }
        >
          {detail.emails.length === 0 ? (
            <div className="flex flex-col gap-1">
              <FieldStatus state="missing" size="sm" />
              <p className="text-muted-foreground text-sm">No email address has been observed.</p>
            </div>
          ) : (
            <ul className="divide-border flex min-w-0 flex-col divide-y">
              {detail.emails.map((e, i) => (
                <EmailRow
                  key={e.address ?? `expired-${i}`}
                  email={e}
                  observations={observations}
                  onCorrect={onCorrect}
                  actions={actions}
                />
              ))}
            </ul>
          )}
        </Section>
        {detail.socials.length ? (
          <>
            <Separator />
            <Section title="Social profiles" count={detail.socials.length}>
              <ul className="flex min-w-0 flex-col gap-2 py-1">
                {detail.socials.map((s) => (
                  <li key={s.url} className="flex min-w-0 flex-col gap-1">
                    <CopyableValue
                      value={s.url}
                      display={`${s.platform.charAt(0).toUpperCase()}${s.platform.slice(1)}${s.handle ? ` · ${s.handle}` : ""}`}
                      label={`${s.platform} profile`}
                      mono={false}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <FieldStatus state={s.state} size="sm" />
                    </div>
                    <Provenance meta={s} observations={observations} />
                  </li>
                ))}
              </ul>
            </Section>
          </>
        ) : null}
        <PanelFootnote detail={detail} />
      </CardContent>
    </Card>
  );
}

/** Source and timestamp line every data panel carries. */
export function PanelFootnote({
  detail,
  label = "Record updated",
  showSources = true,
}: {
  detail: BusinessDetail;
  label?: string;
  showSources?: boolean;
}) {
  const sources = showSources ? detail.sources.map((s) => sourceLabel(s.source)) : [];
  return (
    <p className="text-muted-foreground border-border mt-4 border-t pt-3 text-xs">
      {sources.length ? `Sources: ${sources.join(", ")} · ` : ""}
      {label} <time dateTime={detail.updatedAt}>{formatDateTime(detail.updatedAt)}</time>
    </p>
  );
}

function Alternatives({
  items,
}: {
  items: {
    key: string;
    value: string;
    raw: string | null;
    lastObservedAt: string | null;
    sources: string[];
  }[];
}) {
  return (
    <div className="bg-warning-subtle mt-1 flex min-w-0 flex-col gap-2 rounded-md p-3">
      <p className="text-foreground text-xs font-medium">
        Sources disagree. Other observed values:
      </p>
      <ul className="flex min-w-0 flex-col gap-2">
        {items.map((a) => (
          <li key={a.key} className="flex min-w-0 flex-col gap-0.5">
            <span className="break-anywhere text-sm">{a.value}</span>
            <span className="text-muted-foreground text-xs">
              {[
                a.sources.length ? `From ${a.sources.join(", ")}` : null,
                a.lastObservedAt ? `seen ${formatRelative(a.lastObservedAt)}` : null,
                a.raw && a.raw !== a.value ? `as observed “${a.raw}”` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">Correct the field to choose the right value.</p>
    </div>
  );
}

/** Location with its state and any conflicting alternatives. */
export function LocationPanel({
  detail,
  onCorrect,
  actions,
}: {
  detail: BusinessDetail;
  onCorrect?: (t: CorrectionTarget) => void;
  actions?: ContactActions;
}) {
  const loc = detail.location;
  const text = fullLocation(loc.value);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Location</CardTitle>
          <FieldStatus state={loc.state} size="sm" />
        </div>
        {onCorrect && loc.state !== "expired" ? (
          <CorrectButton
            label="Correct location"
            onClick={() => onCorrect({ field: "location" })}
          />
        ) : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2">
        {loc.state === "expired" ? (
          <ExpiredValue meta={loc} actions={actions} />
        ) : text ? (
          <>
            <p className="break-anywhere text-sm">{text}</p>
            <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-xs min-[400px]:grid-cols-2">
              {(
                [
                  ["City or town", loc.value?.locality],
                  ["LGA", loc.value?.lga],
                  ["State or region", loc.value?.region],
                  ["Country", loc.value?.country],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-anywhere">{value ?? "Not recorded"}</dd>
                </div>
              ))}
            </dl>
            <RawValue raw={loc.rawValue} normalized={[text]} mono={false} />
            <Provenance meta={loc} observations={detail.provenance.recent} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No source has provided a location.</p>
        )}
        {loc.state === "conflicting" && loc.alternatives.length ? (
          <Alternatives
            items={loc.alternatives.map((a, i) => ({
              key: `${i}`,
              value: fullLocation(a.value) ?? "Unknown",
              raw: a.rawValue,
              lastObservedAt: a.lastObservedAt,
              sources: sourcesFor(a.observationIds, detail.provenance.recent),
            }))}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function checkLabel(checking: boolean | undefined, checkedBefore: boolean): string {
  return checking ? "Checking" : checkedBefore ? "Check again" : "Check email";
}
