"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, CircularProgress, ErrorState } from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { AuthLink, AuthPanel } from "./auth-heading";

type State =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "error"; message: string; requestId?: string; canResend: boolean };

export function ResendVerificationButton({ className }: { className?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const resend = async () => {
    setState("sending");
    setMessage(null);
    try {
      await apiFetch("/auth/resend-verification", { method: "POST", noOrg: true });
      setState("sent");
    } catch (err) {
      setState("error");
      setMessage(
        isApiError(err) && err.code === "UNAUTHENTICATED"
          ? "Sign in first so we know which account to send the email to."
          : friendlyMessage(err),
      );
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant="tonal"
        onClick={resend}
        loading={state === "sending"}
        disabled={state === "sent"}
      >
        {state === "sent" ? "Verification email sent" : "Resend verification email"}
      </Button>
      {message ? (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token");
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ kind: "idle" });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    setState({ kind: "verifying" });
    apiFetch("/auth/verify-email", { method: "POST", body: { token }, noOrg: true })
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["auth"] });
        setState({ kind: "verified" });
      })
      .catch((err: unknown) => {
        setState({
          kind: "error",
          message: friendlyMessage(err, "This verification link could not be used."),
          requestId: requestIdOf(err),
          canResend: isApiError(err) && (err.code === "INVALID_TOKEN" || err.code === "NOT_FOUND"),
        });
      });
  }, [token, queryClient]);

  if (!token) {
    return (
      <AuthPanel
        title="Verify your email"
        description="We sent a verification link to your email address. Open it to activate your workspace."
      >
        <div className="flex flex-col gap-6">
          <span className="bg-primary-container text-primary-container-foreground flex size-12 items-center justify-center rounded-full">
            <MailCheck aria-hidden className="size-6" />
          </span>
          <ResendVerificationButton />
          <AuthLink href="/sign-in">Back to sign in</AuthLink>
        </div>
      </AuthPanel>
    );
  }

  if (state.kind === "verifying" || state.kind === "idle") {
    return (
      <AuthPanel title="Verifying your email" description="One moment.">
        <p role="status" className="text-muted-foreground flex items-center gap-3 text-sm">
          <CircularProgress label="Verifying" /> Checking your link
        </p>
      </AuthPanel>
    );
  }

  if (state.kind === "verified") {
    return (
      <AuthPanel title="Email verified" description="Your account is active.">
        <div className="flex flex-col gap-6">
          <p role="status" className="text-success flex items-center gap-2 text-sm font-medium">
            <CircleCheck aria-hidden className="size-5" /> Verification complete
          </p>
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/app">Open your workspace</Link>
            </Button>
          </div>
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Verification failed" description="The link could not be used.">
      <div className="flex flex-col gap-5">
        <ErrorState title="Link not accepted" message={state.message} requestId={state.requestId} />
        {state.canResend ? <ResendVerificationButton /> : null}
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </div>
    </AuthPanel>
  );
}
