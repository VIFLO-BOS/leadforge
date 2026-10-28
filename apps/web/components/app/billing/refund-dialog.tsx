"use client";

import { RefundRequest, type PaymentView } from "@leadforge/contracts";
import { useEffect, useState } from "react";
import { ConfirmDialog, ErrorState, TextAreaField, TextField, toast } from "@leadforge/ui";
import { formatMoney, parseMoneyInput, proportionalCredits } from "@/lib/billing";
import { friendlyMessage, requestIdOf, validationDetails } from "@/lib/errors";
import { formatDate, formatNumber } from "@/lib/format";
import { useRefundPayment } from "@/lib/hooks/use-billing";
import { isApiError } from "@/lib/api";

/**
 * Owner-only refund (POST /billing/payments/:id/refund). Before confirming it explains that
 * credits are taken back in proportion when Paystack processes the refund and that the balance
 * may go below zero, which pauses discovery and website analysis until credits are bought.
 */
export function RefundDialog({
  payment,
  open,
  onOpenChange,
}: {
  payment: PaymentView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refund = useRefundPayment();
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) {
      setAmountText("");
      setReason("");
      setSubmitted(false);
      refund.reset();
    }
    // refund.reset is stable enough; resetting on close only.
  }, [open]);

  const currency = payment.currency;
  const refundable = payment.refundableMinor;
  const typed = amountText.trim();
  const parsed = typed ? parseMoneyInput(typed, currency) : refundable;
  const server = validationDetails(refund.error);

  let amountError: string | undefined;
  if (typed && parsed === null)
    amountError = `Enter an amount in ${currency}, such as 5000 or 5000.50.`;
  else if (parsed !== null && parsed <= 0) amountError = "Enter an amount above zero.";
  else if (parsed !== null && parsed > refundable)
    amountError = `At most ${formatMoney(refundable, currency)} can be refunded.`;
  amountError ??= server.amountMinor;

  const reasonTrim = reason.trim();
  let reasonError: string | undefined;
  if (submitted && reasonTrim.length < 3)
    reasonError = "Give a reason of at least 3 characters. It is kept with the refund.";
  else if (reasonTrim.length > 500) reasonError = "Keep the reason under 500 characters.";
  reasonError ??= server.reason;

  const body = RefundRequest.safeParse({
    ...(typed && parsed !== null ? { amountMinor: parsed } : {}),
    reason: reasonTrim,
  });
  const amount = parsed ?? refundable;
  const credits = proportionalCredits(payment, amount);
  const generic = refund.isError && !Object.keys(server).length ? refund.error : null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title="Refund this payment?"
      description={`${payment.description ?? "Payment"} · ${formatMoney(payment.amountMinor, currency)} paid ${formatDate(payment.paidAt ?? payment.initiatedAt)}. Up to ${formatMoney(refundable, currency)} can be refunded.`}
      confirmLabel={`Refund ${formatMoney(amount, currency)}`}
      confirmDisabled={Boolean(amountError) || (submitted && !body.success)}
      loading={refund.isPending}
      onConfirm={() => {
        setSubmitted(true);
        if (!body.success || amountError) return;
        refund.mutate(
          { paymentId: payment.id, body: body.data },
          {
            onSuccess: () => {
              onOpenChange(false);
              toast.success("Refund requested", {
                description:
                  "It stays pending until Paystack processes it; then the credits are taken back.",
              });
            },
          },
        );
      }}
    >
      <ul
        className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm"
        data-testid="refund-consequences"
      >
        <li>
          Paystack returns the money to the payer. The refund stays pending until Paystack processes
          it.
        </li>
        <li>
          When it is processed, LeadForge takes back this payment&apos;s credits in proportion to
          the amount refunded
          {credits !== null && payment.creditsGranted
            ? `: about ${formatNumber(credits)} of the ${formatNumber(payment.creditsGranted)} credits it added`
            : ""}
          .
        </li>
        <li>
          Credits that were already used are taken back too, so the balance may go below zero. While
          it is below zero, new discovery jobs and website analyses are paused until credits are
          bought.
        </li>
      </ul>
      <TextField
        id={`refund-amount-${payment.id}`}
        label={`Amount to refund (${currency})`}
        inputMode="decimal"
        autoComplete="off"
        value={amountText}
        onChange={(e) => setAmountText(e.target.value)}
        hint={`Leave empty to refund everything left: ${formatMoney(refundable, currency)}.`}
        error={amountError}
        containerClassName="[--field-bg:var(--surface-elevated)]"
      />
      <TextAreaField
        id={`refund-reason-${payment.id}`}
        label="Reason"
        required
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Kept with the refund and in the billing audit log."
        error={reasonError}
        containerClassName="[--field-bg:var(--surface-elevated)]"
      />
      {generic ? (
        <ErrorState
          title={
            isApiError(generic) && generic.code === "CONFLICT"
              ? "This payment cannot be refunded"
              : "Could not request the refund"
          }
          message={
            isApiError(generic) && generic.code === "CONFLICT"
              ? generic.message || friendlyMessage(generic)
              : friendlyMessage(generic)
          }
          requestId={requestIdOf(generic)}
        />
      ) : null}
    </ConfirmDialog>
  );
}
