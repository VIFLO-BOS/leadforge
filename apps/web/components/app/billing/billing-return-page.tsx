"use client";

import { PaymentReference, type PaymentView } from "@leadforge/contracts";
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  Clock,
  CreditCard,
  RotateCcw,
  SearchX,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  Banner,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyableValue,
  EmptyState,
  ErrorState,
  LiveAnnouncement,
  PageHeader,
  Progress,
  StatusIndicator,
  type StatusTone,
} from "@leadforge/ui";
import { renderBreadcrumbLink } from "@/components/app/businesses/shared";
import {
  RETURN_POLL_MS,
  UNDER_REVIEW_META,
  cardSummary,
  formatMoney,
  paymentStatusMeta,
  purposeLabel,
  returnAnnouncement,
  type ReturnPhase,
} from "@/lib/billing";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useBillingReturn } from "@/lib/hooks/use-billing";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { BUY_CREDITS_HREF, Fact } from "./billing-shared";

/** `reference` (or Paystack's `trxref`) from the return URL, when it looks like a reference. */
export function referenceFrom(params: URLSearchParams): string | null {
  const raw = params.get("reference") ?? params.get("trxref");
  const parsed = PaymentReference.safeParse(raw ?? "");
  return parsed.success ? parsed.data : null;
}

const PHASE_VIEW: Record<ReturnPhase, { title: string; tone: StatusTone; label: string }> = {
  missing_reference: { title: "Payment not found", tone: "warning", label: "No reference" },
  verifying: { title: "Confirming your payment", tone: "info", label: "Confirming" },
  confirming: { title: "Confirming your payment", tone: "info", label: "Confirming" },
  success: { title: "Payment confirmed", tone: "success", label: "Paid" },
  failed: { title: "Payment failed", tone: "destructive", label: "Failed" },
  abandoned: { title: "Checkout not completed", tone: "neutral", label: "Not completed" },
  reversed: { title: "Payment reversed", tone: "warning", label: "Reversed" },
  under_review: { title: "Payment under review", tone: "warning", label: "Under review" },
  slow: { title: "Still confirming", tone: "info", label: "Still confirming" },
  not_found: { title: "Payment not found", tone: "warning", label: "Not found" },
  error: { title: "Could not check the payment", tone: "destructive", label: "Not checked" },
};

const ICONS: Partial<Record<ReturnPhase, typeof CircleCheck>> = {
  success: CircleCheck,
  failed: CircleX,
  abandoned: CircleX,
  slow: Clock,
  under_review: ShieldAlert,
};

/** What the phase means, in one or two sentences. Never claims success before the server does. */
function phaseMessage(phase: ReturnPhase, p: PaymentView | undefined): string {
  switch (phase) {
    case "verifying":
    case "confirming":
      return "Paystack sent you back to LeadForge. Credits and plans are added only after Paystack confirms the payment to our server, which usually takes a few seconds.";
    case "success":
      return p?.creditsGranted
        ? `${formatNumber(p.creditsGranted)} credits were added to the workspace${p.purpose === "subscription" ? " and the plan is active" : ""}. A receipt was sent by email.`
        : p?.purpose === "subscription"
          ? "The plan is active. A receipt was sent by email."
          : "The payment is confirmed. A receipt was sent by email.";
    case "failed":
      return "The payment did not go through, so nothing was added and nothing was charged. You can try again with another card.";
    case "abandoned":
      return "The checkout was left before paying, so nothing was charged. Start a new checkout from Billing when you are ready.";
    case "reversed":
      return "Paystack reversed this payment, so it was refunded and its credits were taken back.";
    case "under_review":
      return "The payment details did not match what Paystack reported, or a dispute is open. Nothing is added while it is reviewed; owners and administrators are notified of the outcome.";
    case "slow":
      return "Paystack has not confirmed the payment yet. You can leave this page: LeadForge keeps checking and notifies you (in the app and by email) when it is confirmed. Nothing is added until then.";
    case "not_found":
      return "This payment reference does not belong to this workspace, or the link is incomplete. Payments appear on the Billing page.";
    case "missing_reference":
      return "The link has no payment reference. Payments appear on the Billing page.";
    default:
      return "";
  }
}

function PaymentFacts({ p }: { p: PaymentView }) {
  const meta = paymentStatusMeta(p.status);
  // The card or bank only once Paystack confirmed the payment; a pending one has not been paid yet.
  const paid = p.status === "success" || p.status === "reversed";
  const card = paid ? cardSummary(p.card, p.channel) : null;
  return (
    <dl
      className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[480px]:grid-cols-2"
      data-testid="return-payment"
    >
      <Fact label="What">{p.description ?? purposeLabel(p.purpose)}</Fact>
      <Fact label="Amount">{formatMoney(p.amountMinor, p.currency)}</Fact>
      <Fact label="Status">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <StatusIndicator tone={meta.tone} size="sm" label={meta.label} title={meta.description} />
          {p.underReview ? (
            <StatusIndicator
              tone={UNDER_REVIEW_META.tone}
              size="sm"
              label={UNDER_REVIEW_META.label}
              title={UNDER_REVIEW_META.description}
            />
          ) : null}
        </span>
      </Fact>
      {p.creditsGranted !== null ? (
        <Fact label="Credits added">{formatNumber(p.creditsGranted)}</Fact>
      ) : null}
      {card ? <Fact label="Paid with">{card}</Fact> : null}
      {p.status === "failed" && p.gatewayResponse ? (
        <Fact label="Paystack said">{p.gatewayResponse}</Fact>
      ) : null}
      <Fact label="Started">{formatDateTime(p.initiatedAt)}</Fact>
      <Fact label="Reference">
        <CopyableValue value={p.reference} label="payment reference" mono />
      </Fact>
    </dl>
  );
}

/**
 * Paystack's return page (/app/billing/return?reference=). Verifies once, polls every 2 seconds
 * until the payment is final or held for review, and after about a minute says it is still
 * confirming. Each final state is announced once.
 */
export function BillingReturnPage({ pollMs, timeoutMs }: { pollMs?: number; timeoutMs?: number }) {
  const params = useSearchParams();
  const { can } = usePermissions();
  const manager = can("billing:manage");
  const reference = useMemo(() => referenceFrom(params), [params]);
  const state = useBillingReturn(manager ? reference : null, { pollMs, timeoutMs });
  const phase: ReturnPhase = !reference ? "missing_reference" : state.phase;
  const view = PHASE_VIEW[phase];
  const announcement = useMemo(() => returnAnnouncement(phase), [phase]);
  const p = state.payment;
  const Icon = ICONS[phase];
  const active = phase === "verifying" || phase === "confirming";
  const crumbs = (
    <Breadcrumbs
      items={[{ label: "Billing", href: "/app/billing" }, { label: "Payment" }]}
      renderLink={renderBreadcrumbLink}
    />
  );

  if (!manager) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader breadcrumbs={crumbs} eyebrow="Billing" title="Payment" />
        <EmptyState
          icon={ShieldAlert}
          title="Payments are managed by owners and administrators"
          description="Ask an owner or administrator of this workspace to check the payment on the Billing page."
          data-testid="billing-forbidden"
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="billing-return" data-phase={phase}>
      <PageHeader breadcrumbs={crumbs} eyebrow="Billing" title={view.title} />
      <LiveAnnouncement message={announcement} data-testid="return-announcer" />

      {phase === "missing_reference" || phase === "not_found" ? (
        <EmptyState
          icon={SearchX}
          title={phase === "not_found" ? "We could not find this payment" : "No payment reference"}
          description={phaseMessage(phase, p)}
          action={
            <Button asChild variant="outline">
              <Link href="/app/billing?tab=payments">
                <ArrowLeft aria-hidden /> Payments
              </Link>
            </Button>
          }
        />
      ) : phase === "error" ? (
        <ErrorState
          title={
            isForbidden(state.error)
              ? "Your role cannot check payments"
              : "Could not check the payment"
          }
          message={`${friendlyMessage(state.error)} Nothing is added until Paystack confirms the payment; LeadForge keeps checking in the background.`}
          requestId={requestIdOf(state.error)}
          onRetry={isForbidden(state.error) ? undefined : state.checkAgain}
        />
      ) : (
        <Card data-testid="return-card" aria-busy={active || undefined}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex min-w-0 items-center gap-2">
              {Icon ? <Icon aria-hidden className="size-5 shrink-0" /> : null}
              Payment status
            </CardTitle>
            <StatusIndicator
              tone={view.tone}
              label={view.label}
              variant="badge"
              live={active}
              data-testid="return-status"
            />
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            <p className="text-sm" data-testid="return-message">
              {phaseMessage(phase, p)}
            </p>
            {active ? (
              <Progress
                label="Waiting for Paystack's confirmation"
                valueText={`Checking every ${Math.round((pollMs ?? RETURN_POLL_MS) / 1000)} seconds`}
                showLabel
              />
            ) : null}
            {phase === "under_review" ? (
              <Banner
                tone="warning"
                icon={ShieldAlert}
                title="Nothing has been added yet"
                description="Under review means LeadForge found a mismatch or a dispute. It is resolved with Paystack; you do not need to pay again."
              />
            ) : null}
            {p ? <PaymentFacts p={p} /> : null}
            <div className="flex min-w-0 flex-wrap gap-2 [&>*]:h-auto [&>*]:min-h-10 [&>*]:max-w-full [&>*]:whitespace-normal">
              {phase === "slow" ? (
                <Button
                  onClick={state.checkAgain}
                  loading={state.checking}
                  data-testid="check-again"
                >
                  <RotateCcw aria-hidden /> Check again
                </Button>
              ) : null}
              {phase === "failed" || phase === "abandoned" ? (
                <Button asChild>
                  <Link
                    href={
                      p?.purpose === "credit_pack" ? BUY_CREDITS_HREF : "/app/billing?tab=plans"
                    }
                  >
                    <CreditCard aria-hidden /> Try again
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant={phase === "success" ? "primary" : "outline"}>
                <Link href="/app/billing">
                  <ArrowLeft aria-hidden /> Back to billing
                </Link>
              </Button>
              {phase === "success" ? (
                <Button asChild variant="text">
                  <Link href="/app/usage">
                    <Wallet aria-hidden /> Usage and credits
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
