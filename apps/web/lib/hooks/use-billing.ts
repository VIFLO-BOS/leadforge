"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  BillingBanners,
  BillingCatalogue,
  BillingOverview,
  CheckoutSession,
  InvoiceDownloadLink,
  InvoiceView,
  PaymentView,
  RefundRequest,
  SubscriptionManageLink,
  SubscriptionView,
  VerifyPaymentResponse,
} from "@leadforge/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import {
  RETURN_POLL_MS,
  RETURN_TIMEOUT_MS,
  isPaymentSettled,
  returnPhase,
  type ReturnPhase,
} from "../billing";
import { newIdempotencyKey } from "../bulk";
import { sameOriginDownloadUrl } from "../exports";
import { safeHttpUrl } from "../format";
import { queryKeys } from "../query-keys";
import { usePermissions } from "./use-permissions";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/** After any billing change: billing views, credits, notifications and the overview. */
export function invalidateBilling(
  queryClient: QueryClient,
  orgId: string,
  keep?: readonly unknown[],
): void {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.billing.all(orgId),
    predicate: (q) => !keep || JSON.stringify(q.queryKey) !== JSON.stringify(keep),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.credits.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: ["org", orgId, "reports", "overview"] });
}

/** GET /billing/overview (owner, admin). */
export function useBillingOverview(enabled = true) {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  return useQuery({
    queryKey: queryKeys.billing.overview(org.id),
    queryFn: () => apiFetch<BillingOverview>("/billing/overview"),
    staleTime: 30_000,
    retry: retryServerErrors,
    enabled: enabled && can("billing:manage"),
  });
}

/** GET /billing/plans (owner, admin): plans and credit packs, each with `purchasable` and `blocker`. */
export function useBillingPlans(enabled = true) {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  return useQuery({
    queryKey: queryKeys.billing.plans(org.id),
    queryFn: () => apiFetch<BillingCatalogue>("/billing/plans"),
    staleTime: 60_000,
    retry: retryServerErrors,
    enabled: enabled && can("billing:manage"),
  });
}

/** Banners re-read when the tab regains focus and every 5 minutes; never aggressively. */
export const BANNER_REFRESH_MS = 5 * 60_000;

/** GET /billing/banners (every role; the server filters the kinds by role). */
export function useBillingBanners() {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.billing.banners(org.id),
    queryFn: () => apiFetch<BillingBanners>("/billing/banners"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: BANNER_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** GET /billing/payments, newest first, cursor-paged. */
export function useBillingPayments(query: Record<string, unknown>) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.billing.payments(org.id, query),
    queryFn: () => apiFetchPaged<PaymentView>(`/billing/payments${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
  });
}

/** GET /billing/invoices, newest first, cursor-paged. */
export function useBillingInvoices(query: Record<string, unknown>) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.billing.invoices(org.id, query),
    queryFn: () => apiFetchPaged<InvoiceView>(`/billing/invoices${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
  });
}

export type CheckoutTarget =
  { kind: "credits"; packId: string } | { kind: "subscription"; planId: string };

/** Sends the browser to Paystack's hosted page (http or https links only). */
/** Sends the browser to a Paystack page (http(s) only); `navigate` is injectable for tests. */
export function goToPaymentPage(url: string, navigate?: (url: string) => void) {
  const safe = safeHttpUrl(url);
  if (!safe) throw new Error("The payment page link was not a web address.");
  if (navigate) navigate(safe);
  else window.location.assign(safe);
}

/**
 * POST /billing/checkout/credits or /subscription with a fresh Idempotency-Key for every click,
 * then sends the browser to `authorizationUrl`. Nothing is granted here: credits and plans are
 * granted by the server after Paystack confirms the payment. `navigate` is injectable for tests.
 */
export function useCheckout(navigate?: (url: string) => void) {
  return useMutation({
    mutationFn: async (target: CheckoutTarget) => {
      const key = newIdempotencyKey("checkout");
      const session =
        target.kind === "credits"
          ? await apiFetch<CheckoutSession>("/billing/checkout/credits", {
              method: "POST",
              body: { packId: target.packId },
              headers: { "Idempotency-Key": key },
            })
          : await apiFetch<CheckoutSession>("/billing/checkout/subscription", {
              method: "POST",
              body: { planId: target.planId },
              headers: { "Idempotency-Key": key },
            });
      goToPaymentPage(session.authorizationUrl, navigate);
      return session;
    },
  });
}

function useSubscriptionChange(path: "cancel" | "resume") {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<SubscriptionView>(`/billing/subscription/${path}`, {
        method: "POST",
        body: path === "cancel" ? { atPeriodEnd: true } : undefined,
      }),
    onSuccess: () => invalidateBilling(queryClient, org.id),
    onError: () => invalidateBilling(queryClient, org.id),
  });
}

/** POST /billing/subscription/cancel `{ atPeriodEnd: true }`: the plan stays until the period ends. */
export function useCancelSubscription() {
  return useSubscriptionChange("cancel");
}

/** POST /billing/subscription/resume: renewal starts again. */
export function useResumeSubscription() {
  return useSubscriptionChange("resume");
}

/** GET /billing/subscription/manage-link, then Paystack's card page. */
export function useManageCard(navigate?: (url: string) => void) {
  return useMutation({
    mutationFn: async () => {
      const link = await apiFetch<SubscriptionManageLink>("/billing/subscription/manage-link");
      goToPaymentPage(link.url, navigate);
      return link;
    },
  });
}

/**
 * A fresh signed invoice link (15 minutes, bound to you and this workspace) for every download,
 * opened as a same-origin path through the web app's /api proxy.
 */
export function useInvoiceDownload(navigate?: (url: string) => void) {
  return useMutation({
    mutationFn: async (id: string) => {
      const link = await apiFetch<InvoiceDownloadLink>(
        `/billing/invoices/${encodeURIComponent(id)}/download-url`,
      );
      const url = sameOriginDownloadUrl(link.url);
      if (navigate) navigate(url);
      else window.location.assign(url);
      return link;
    },
  });
}

/** POST /billing/payments/:id/refund (owner). 202: the refund is pending until Paystack processes it. */
export function useRefundPayment() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, body }: { paymentId: string; body: RefundRequest }) =>
      apiFetch<PaymentView>(`/billing/payments/${encodeURIComponent(paymentId)}/refund`, {
        method: "POST",
        body,
      }),
    onSuccess: () => invalidateBilling(queryClient, org.id),
  });
}

// ---------------------------------------------------------------------------
// Return page
// ---------------------------------------------------------------------------

/**
 * One verify per reference for the life of the page, shared by every mount. React's strict mode
 * runs effects twice in development; both runs get the same request, so the server sees one.
 * A failed verify is forgotten so "Try again" can ask again.
 */
const verifyRequests = new Map<string, Promise<VerifyPaymentResponse>>();

/** Test hook. */
export function resetVerifyRequests(): void {
  verifyRequests.clear();
}

function verifyOnce(orgId: string, reference: string): Promise<VerifyPaymentResponse> {
  const key = `${orgId}:${reference}`;
  let p = verifyRequests.get(key);
  if (!p) {
    p = apiFetch<VerifyPaymentResponse>(
      `/billing/payments/${encodeURIComponent(reference)}/verify`,
      { method: "POST" },
    );
    verifyRequests.set(key, p);
    p.catch(() => verifyRequests.delete(key));
  }
  return p;
}

/** Verify errors that make polling pointless: the reference is wrong, foreign or forbidden. */
function blocksPolling(err: unknown): boolean {
  return isApiError(err) && [400, 403, 404, 422].includes(err.status);
}

export interface BillingReturnState {
  phase: ReturnPhase;
  payment: PaymentView | undefined;
  /** The error behind `not_found` or `error`. */
  error: unknown;
  /** A one-off check after polling stopped (the "Still confirming" state). */
  checkAgain: () => void;
  checking: boolean;
}

/**
 * The Paystack return page's state machine: POST /billing/payments/:reference/verify exactly once,
 * then GET /billing/payments/:reference every 2 s until the status is final or the payment is held
 * for review; after about 60 s polling stops and the page says it is still confirming. Success is
 * only ever the server's `status: "success"`.
 */
export function useBillingReturn(
  reference: string | null,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): BillingReturnState {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const pollMs = opts.pollMs ?? RETURN_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? RETURN_TIMEOUT_MS;
  const key = useMemo(
    () => queryKeys.billing.payment(org.id, reference ?? ""),
    [org.id, reference],
  );
  const [verify, setVerify] = useState<{ done: boolean; error: unknown }>({
    done: false,
    error: null,
  });
  const [timedOut, setTimedOut] = useState(false);
  const timedOutRef = useRef(false);
  const settledRef = useRef(false);

  useEffect(() => {
    if (!reference) return;
    let active = true;
    verifyOnce(org.id, reference).then(
      (res) => {
        if (!active) return;
        if (!queryClient.getQueryData(key)) queryClient.setQueryData(key, res.payment);
        setVerify({ done: true, error: null });
      },
      (err: unknown) => {
        if (active) setVerify({ done: true, error: err });
      },
    );
    return () => {
      active = false;
    };
  }, [org.id, reference, key, queryClient]);

  useEffect(() => {
    if (!reference) return;
    const t = window.setTimeout(() => {
      if (settledRef.current) return;
      timedOutRef.current = true;
      setTimedOut(true);
    }, timeoutMs);
    return () => window.clearTimeout(t);
  }, [reference, timeoutMs]);

  const blocked = blocksPolling(verify.error);
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<PaymentView>(`/billing/payments/${encodeURIComponent(reference ?? "")}`),
    enabled: Boolean(reference) && verify.done && !blocked,
    staleTime: pollMs,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (timedOutRef.current) return false;
      if (data && isPaymentSettled(data)) return false;
      return pollMs;
    },
    refetchIntervalInBackground: false,
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
  });

  const payment = query.data;
  const settled = payment ? isPaymentSettled(payment) : false;
  useEffect(() => {
    if (!settled || settledRef.current) return;
    settledRef.current = true;
    invalidateBilling(queryClient, org.id, key);
  }, [settled, queryClient, org.id, key]);

  const error = blocked ? verify.error : payment ? null : query.error;
  const phase = returnPhase({ reference, payment, verifyDone: verify.done, timedOut, error });

  return {
    phase,
    payment,
    error,
    checkAgain: () => void query.refetch(),
    checking: query.isFetching,
  };
}
