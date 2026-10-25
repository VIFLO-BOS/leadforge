"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorState } from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { AuthHeading } from "./auth-heading";

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
        variant="outline"
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
      <>
        <AuthHeading
          title="Verify your email"
          description="We sent a verification link to your email address. Open it to activate your workspace."
        />
        <ResendVerificationButton />
        <p className="text-muted-foreground mt-6 text-center text-sm">
          <Link
            href="/sign-in"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </>
    );
  }

  if (state.kind === "verifying" || state.kind === "idle") {
    return <AuthHeading title="Verifying your email" description="One moment." />;
  }

  if (state.kind === "verified") {
    return (
      <>
        <AuthHeading title="Email verified" description="Your account is active." />
        <Button asChild size="lg" className="w-full">
          <Link href="/app">Open your workspace</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="Verification failed" />
      <ErrorState title="Link not accepted" message={state.message} requestId={state.requestId} />
      {state.canResend ? <ResendVerificationButton className="mt-4" /> : null}
      <p className="text-muted-foreground mt-6 text-center text-sm">
        <Link
          href="/sign-in"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </>
  );
}
