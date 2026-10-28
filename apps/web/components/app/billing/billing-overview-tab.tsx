"use client";

import type { BillingOverview, SubscriptionView } from "@leadforge/contracts";
import {
  CalendarClock,
  Coins,
  CreditCard,
  ExternalLink,
  Lock,
  ReceiptText,
  RotateCcw,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Progress,
  StatusIndicator,
  cn,
  toast,
} from "@leadforge/ui";
import {
  UNDER_REVIEW_META,
  entitlementSourceLabel,
  formatMoney,
  intervalPer,
  paymentStatusMeta,
  subscriptionActionsReady,
  subscriptionStatusMeta,
  PRICING_NOT_PUBLISHED,
} from "@/lib/billing";
import { friendlyMessage } from "@/lib/errors";
import { isPendingDeletion } from "@/lib/org-lifecycle";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
  plural,
  safeHttpUrl,
} from "@/lib/format";
import {
  goToPaymentPage,
  useCancelSubscription,
  useManageCard,
  useResumeSubscription,
} from "@/lib/hooks/use-billing";
import { isApiError } from "@/lib/api";
import { BUY_CREDITS_HREF, Fact } from "./billing-shared";

/** Footer buttons wrap their labels on the narrowest screens instead of overflowing the card. */
const WRAP = "h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left";

/** Price of the subscribed plan, never a zero or unpublished amount. */
function planPrice(s: SubscriptionView, pricingPublished: boolean): string {
  if (!pricingPublished || s.plan.priceMinor <= 0) return PRICING_NOT_PUBLISHED;
  return `${formatMoney(s.plan.priceMinor, s.plan.currency)} ${intervalPer(s.plan.interval)}`;
}

function subscriptionConflictMessage(err: unknown): string {
  if (isApiError(err) && err.code === "CONFLICT") {
    return err.message || "Paystack is still linking this subscription. Try again in a minute.";
  }
  return friendlyMessage(err);
}

/** The plan card: what the workspace pays for, when it renews, and cancel, resume or card changes. */
function PlanCard({
  overview,
  onSeePlans,
  navigate,
}: {
  overview: BillingOverview;
  onSeePlans: () => void;
  navigate?: (url: string) => void;
}) {
  const s = overview.subscription;
  const cancel = useCancelSubscription();
  const resume = useResumeSubscription();
  const manage = useManageCard(navigate);
  const [confirm, setConfirm] = useState<"cancel" | "resume" | null>(null);
  const ready = s ? subscriptionActionsReady(s) : false;
  const meta = s ? subscriptionStatusMeta(s.status) : null;

  return (
    <Card data-testid="billing-plan-card">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Plan</CardTitle>
          <CardDescription>
            {s
              ? "The workspace's subscription, paid through Paystack."
              : "No paid plan: the free tier applies."}
          </CardDescription>
        </div>
        {meta ? (
          <StatusIndicator
            tone={meta.tone}
            label={meta.label}
            title={meta.description}
            variant="badge"
            data-testid="subscription-status"
          />
        ) : (
          <Badge variant="neutral">Free tier</Badge>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <p className="text-2xl font-normal" data-testid="plan-name">
          {s ? s.plan.name : (overview.entitlements.basis.planName ?? "Free tier")}
        </p>
        {s ? (
          <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[480px]:grid-cols-2">
            <Fact label="Price">{planPrice(s, overview.pricingPublished)}</Fact>
            <Fact label="Credits included">
              {formatNumber(s.plan.includedCredits)} {intervalPer(s.plan.interval)}
            </Fact>
            <Fact label="Current period">
              {s.currentPeriodStart && s.currentPeriodEnd
                ? `${formatDate(s.currentPeriodStart)} to ${formatDate(s.currentPeriodEnd)}`
                : "Starts when the first payment is confirmed"}
            </Fact>
            {s.status === "past_due" ? (
              <Fact label="Payment overdue since">{formatDateTime(s.pastDueAt)}</Fact>
            ) : s.cancelAtPeriodEnd ? (
              <Fact label="Ends on">
                <span data-testid="subscription-ends">{formatDate(s.currentPeriodEnd)}</span>
                <span className="text-muted-foreground block text-xs">Will not renew</span>
              </Fact>
            ) : (
              <Fact label="Renews on">
                <span data-testid="subscription-renews">
                  {s.renewsAt ? formatDate(s.renewsAt) : "Does not renew"}
                </span>
              </Fact>
            )}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            Choose a plan to raise the member and export limits and to get credits every period.
            Credit packs can be bought without a plan.
          </p>
        )}
        {s && !ready && (s.status === "active" || s.status === "past_due") ? (
          <p className="text-muted-foreground text-xs" data-testid="subscription-linking">
            Paystack is still linking this subscription. Cancelling, resuming and the card page
            become available within a minute of the first payment.
          </p>
        ) : null}
        {manage.isError ? (
          <p role="alert" className="text-destructive text-xs">
            Could not open the card page: {subscriptionConflictMessage(manage.error)}
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        {s && (s.status === "active" || s.status === "past_due") ? (
          <>
            {s.status === "past_due" || ready ? (
              <Button
                size="sm"
                className={WRAP}
                variant={s.status === "past_due" ? "primary" : "outline"}
                loading={manage.isPending}
                disabled={!ready}
                onClick={() => manage.mutate()}
              >
                <CreditCard aria-hidden /> Update card
              </Button>
            ) : null}
            {s.cancelAtPeriodEnd ? (
              <Button
                size="sm"
                className={WRAP}
                variant="tonal"
                disabled={!ready}
                onClick={() => setConfirm("resume")}
              >
                <RotateCcw aria-hidden /> Resume renewal…
              </Button>
            ) : s.status === "active" ? (
              <Button
                size="sm"
                className={WRAP}
                variant="outline"
                disabled={!ready}
                onClick={() => setConfirm("cancel")}
              >
                <XCircle aria-hidden /> Cancel at period end…
              </Button>
            ) : null}
          </>
        ) : null}
        <Button size="sm" className={WRAP} variant="text" onClick={onSeePlans}>
          {s ? "Change plan" : "See plans"}
        </Button>
      </CardFooter>

      {s ? (
        <>
          <ConfirmDialog
            open={confirm === "cancel"}
            onOpenChange={(o) => !o && setConfirm(null)}
            destructive
            title="Cancel at the end of the period?"
            description={`${s.plan.name} stays active until ${formatDate(s.currentPeriodEnd)}. It will not renew, and nothing more is charged.`}
            confirmLabel="Cancel at period end"
            cancelLabel="Keep the plan"
            loading={cancel.isPending}
            onConfirm={() =>
              cancel.mutate(undefined, {
                onSuccess: (sub) => {
                  setConfirm(null);
                  toast.success("The plan will not renew", {
                    description: `It stays active until ${formatDate(sub.currentPeriodEnd)}.`,
                  });
                },
                onError: (err) => {
                  setConfirm(null);
                  toast.error("Could not cancel", {
                    description: subscriptionConflictMessage(err),
                  });
                },
              })
            }
          >
            <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm">
              <li>
                Credits already in the balance stay. No new plan credits are added after the period
                ends.
              </li>
              <li>
                After the period ends the free tier's limits apply (
                {plural(overview.entitlements.maxMembers, "member", "members")} today).
              </li>
              <li>You can resume renewal any time before {formatDate(s.currentPeriodEnd)}.</li>
            </ul>
          </ConfirmDialog>
          <ConfirmDialog
            open={confirm === "resume"}
            onOpenChange={(o) => !o && setConfirm(null)}
            title="Resume renewal?"
            description={`${s.plan.name} renews on ${formatDate(s.currentPeriodEnd)} and Paystack charges the card on file then.`}
            confirmLabel="Resume renewal"
            loading={resume.isPending}
            onConfirm={() =>
              resume.mutate(undefined, {
                onSuccess: (sub) => {
                  setConfirm(null);
                  toast.success("Renewal resumed", {
                    description: sub.renewsAt
                      ? `Next charge on ${formatDate(sub.renewsAt)}.`
                      : undefined,
                  });
                },
                onError: (err) => {
                  setConfirm(null);
                  toast.error(
                    isPendingDeletion(err)
                      ? "Plan changes are paused: this organization is scheduled for deletion"
                      : "Could not resume",
                    {
                      description: subscriptionConflictMessage(err),
                    },
                  );
                },
              })
            }
          />
        </>
      ) : null}
    </Card>
  );
}

function CreditsCard({ overview, onBuy }: { overview: BillingOverview; onBuy: () => void }) {
  const c = overview.credits;
  const negative = c.balance < 0;
  return (
    <Card className="h-full" data-testid="billing-credits-card">
      <CardHeader>
        <CardTitle>Credits</CardTitle>
        <CardDescription>From the workspace credit ledger.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <p
          className={cn("text-2xl font-normal tabular-nums", negative && "text-destructive")}
          data-testid="billing-balance"
        >
          {negative ? "−" : ""}
          {formatNumber(Math.abs(c.balance))}
          <span className="text-muted-foreground ml-2 text-sm">available</span>
        </p>
        <p className="text-muted-foreground text-sm">
          {c.held > 0
            ? `${formatNumber(c.held)} held by running jobs.`
            : "Nothing held by running jobs."}
          {negative
            ? " The balance is below zero after a refund, so new discovery jobs and analyses are paused."
            : ""}
        </p>
      </CardContent>
      <CardFooter>
        <Button
          size="sm"
          className={WRAP}
          variant={negative ? "primary" : "outline"}
          onClick={onBuy}
        >
          <Coins aria-hidden /> Buy credits
        </Button>
        <Button asChild size="sm" className={WRAP} variant="text">
          <Link href="/app/usage">
            <Wallet aria-hidden /> Usage and credits
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function SourceNote({ source }: { source: string }) {
  return (
    <span className="text-muted-foreground block text-xs">{entitlementSourceLabel(source)}</span>
  );
}

/** What the workspace may use now (entitlements), each with where the value comes from. */
function LimitsCard({ overview }: { overview: BillingOverview }) {
  const e = overview.entitlements;
  const m = overview.members;
  const used = m.active + m.pendingInvitations;
  return (
    <Card data-testid="billing-limits-card">
      <CardHeader>
        <CardTitle>What this workspace can use</CardTitle>
        <CardDescription>
          {e.basis.kind === "subscription" && e.basis.planName
            ? `Limits of the ${e.basis.planName} plan, plus anything set for this workspace.`
            : "Free tier limits, plus anything set for this workspace."}{" "}
          LeadForge enforces these on the server.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-1.5" data-testid="members-meter">
          <Progress
            label="Members"
            value={Math.min(used, m.cap)}
            max={Math.max(m.cap, 1)}
            valueText={`${formatNumber(used)} of ${formatNumber(m.cap)}`}
            showLabel
            tone={used >= m.cap ? "warning" : undefined}
          />
          <p className="text-muted-foreground text-xs">
            {plural(m.active, "active member", "active members")} and{" "}
            {plural(m.pendingInvitations, "pending invitation", "pending invitations")} count toward
            the limit · {entitlementSourceLabel(e.sources.maxMembers)}
          </p>
        </div>
        <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm min-[480px]:grid-cols-2 xl:grid-cols-4">
          <Fact label="Rows per export">
            {formatNumber(e.exportRowCap)}
            <SourceNote source={e.sources.exportRowCap} />
          </Fact>
          <Fact label="Discovery">
            <StatusIndicator
              tone={e.discoveryEnabled ? "success" : "neutral"}
              size="sm"
              label={e.discoveryEnabled ? "Included" : "Not included"}
            />
            <SourceNote source={e.sources.discoveryEnabled} />
          </Fact>
          <Fact label="Website analysis">
            <StatusIndicator
              tone={e.websiteAnalysisEnabled ? "success" : "neutral"}
              size="sm"
              label={e.websiteAnalysisEnabled ? "Included" : "Not included"}
            />
            <SourceNote source={e.sources.websiteAnalysisEnabled} />
          </Fact>
          <Fact label="Credits included each period">
            {formatNumber(e.monthlyIncludedCredits)}
            <SourceNote source={e.sources.monthlyIncludedCredits} />
          </Fact>
        </dl>
      </CardContent>
    </Card>
  );
}

function LatestPaymentCard({ overview, onAll }: { overview: BillingOverview; onAll: () => void }) {
  const p = overview.latestPayment;
  const meta = p ? paymentStatusMeta(p.status) : null;
  return (
    <Card className="h-full" data-testid="billing-latest-payment">
      <CardHeader>
        <CardTitle>Latest payment</CardTitle>
        <CardDescription>Confirmed with Paystack before anything is granted.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2 text-sm">
        {p && meta ? (
          <>
            <p className="break-words font-medium">{p.description ?? "Payment"}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tabular-nums">{formatMoney(p.amountMinor, p.currency)}</span>
              <StatusIndicator
                tone={meta.tone}
                size="sm"
                label={meta.label}
                title={meta.description}
              />
              {p.underReview ? (
                <StatusIndicator
                  tone={UNDER_REVIEW_META.tone}
                  size="sm"
                  label={UNDER_REVIEW_META.label}
                  title={UNDER_REVIEW_META.description}
                />
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              <time dateTime={p.initiatedAt}>{formatDateTime(p.initiatedAt)}</time> ·{" "}
              {formatRelative(p.initiatedAt)}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">No payments yet.</p>
        )}
      </CardContent>
      <CardFooter>
        <Button size="sm" className={WRAP} variant="text" onClick={onAll}>
          <ReceiptText aria-hidden /> All payments
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * The hosted Paystack page of a pending subscription checkout while LeadForge still offers it
 * (Stage 9: `authorizationUrl` until `authorizationUrlExpiresAt`), else null. Re-renders when the
 * offer lapses, so an expired link is never shown.
 */
export function useResumableCheckout(
  pending: BillingOverview["pendingSubscription"],
): { url: string; until: string } | null {
  const url = safeHttpUrl(pending?.authorizationUrl);
  const until = pending?.authorizationUrlExpiresAt ?? null;
  const expiresAt = until ? Date.parse(until) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(expiresAt)) return;
    const wait = expiresAt - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait + 50, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  if (!url || !until || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { url, until };
}

/** Banners about the payment provider and a checkout waiting for payment. */
export function ProviderBanners({
  overview,
  navigate,
}: {
  overview: Pick<BillingOverview, "provider" | "pendingSubscription">;
  navigate?: (url: string) => void;
}) {
  const p = overview.provider;
  const pending = overview.pendingSubscription;
  const resumable = useResumableCheckout(pending);
  return (
    <>
      {!p.configured ? (
        <Banner
          tone="info"
          icon={Lock}
          title="Payments are not set up yet"
          data-testid="billing-not-configured"
          description="This LeadForge server is not connected to Paystack, so plans and credit packs cannot be bought and nothing will be charged. The limits below still apply."
        />
      ) : p.mode === "test" ? (
        <Banner
          tone="info"
          title="Test mode"
          data-testid="billing-test-mode"
          description="Payments use Paystack's test keys: no real money moves and test cards are accepted."
        />
      ) : null}
      {pending ? (
        <Banner
          tone="info"
          icon={CalendarClock}
          title={`A ${pending.plan.name} checkout is waiting for payment`}
          data-testid="billing-pending-checkout"
          description={
            resumable
              ? `Started ${formatRelative(pending.createdAt)}. Resume it to finish paying on Paystack's page (offered until ${formatDateTime(resumable.until)}); nothing is charged until you pay.`
              : `Started ${formatRelative(pending.createdAt)}. If you closed Paystack's page, choose the plan again to start a new checkout; nothing is charged until you pay.`
          }
          actions={
            resumable ? (
              <Button
                size="sm"
                variant="outline"
                className="h-auto min-h-8 whitespace-normal py-1.5"
                onClick={() => goToPaymentPage(resumable.url, navigate)}
                data-testid="resume-checkout"
              >
                <ExternalLink aria-hidden /> Resume checkout
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </>
  );
}

export function BillingOverviewTab({
  overview,
  onTab,
  navigate,
}: {
  overview: BillingOverview;
  onTab: (tab: "plans" | "payments" | "invoices", hash?: string) => void;
  navigate?: (url: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ProviderBanners overview={overview} navigate={navigate} />
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <PlanCard overview={overview} onSeePlans={() => onTab("plans")} navigate={navigate} />
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <CreditsCard overview={overview} onBuy={() => onTab("plans", "credit-packs")} />
          <LatestPaymentCard overview={overview} onAll={() => onTab("payments")} />
        </div>
      </div>
      <LimitsCard overview={overview} />
      <p className="text-muted-foreground text-xs">
        <Users aria-hidden className="mr-1.5 inline size-3.5 align-[-2px]" />
        Member limits count pending invitations. Manage people on{" "}
        <Link href="/app/team" className="link-inline">
          Team members
        </Link>
        . Credit packs:{" "}
        <Link href={BUY_CREDITS_HREF} className="link-inline">
          buy credits
        </Link>
        .
      </p>
    </div>
  );
}
