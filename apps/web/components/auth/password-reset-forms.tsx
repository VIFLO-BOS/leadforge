"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ForgotPasswordRequest,
  PASSWORD_MIN_LENGTH,
  ResetPasswordRequest,
} from "@leadforge/contracts";
import { CircleCheck, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, ErrorState, TextField } from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { AuthPanel } from "./auth-heading";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(ForgotPasswordRequest),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch("/auth/forgot-password", { method: "POST", body: values, noOrg: true });
      setSent(true);
    } catch (err) {
      setError({ message: friendlyMessage(err), requestId: requestIdOf(err) });
    }
  });

  if (sent) {
    return (
      <AuthPanel
        title="Check your email"
        description="If an account exists for that address, a reset link is on its way. It expires in one hour."
      >
        <div className="flex flex-col gap-6">
          <span className="bg-primary-container text-primary-container-foreground flex size-12 items-center justify-center rounded-full">
            <MailCheck aria-hidden className="size-6" />
          </span>
          <div className="flex justify-end">
            <Button asChild variant="tonal">
              <Link href="/sign-in">Back to sign in</Link>
            </Button>
          </div>
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Reset your password"
      description="Enter the email for your account and we will send a reset link."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          id="fp-email"
          label="Email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          error={form.formState.errors.email?.message}
          {...form.register("email")}
        />
        {error ? (
          <ErrorState title="Request failed" message={error.message} requestId={error.requestId} />
        ) : null}
        <div className="mt-4 flex flex-col-reverse gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
          <Button asChild variant="text" className="-ml-3 self-start min-[360px]:self-auto">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </div>
      </form>
    </AuthPanel>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordRequest>({
    resolver: zodResolver(ResetPasswordRequest),
    defaultValues: { token, password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch("/auth/reset-password", { method: "POST", body: values, noOrg: true });
      setDone(true);
      setTimeout(() => router.push("/sign-in"), 1500);
    } catch (err) {
      setError({ message: friendlyMessage(err), requestId: requestIdOf(err) });
    }
  });

  if (!token) {
    return (
      <AuthPanel
        title="Reset link missing"
        description="Open the link from your email, or request a new one."
      >
        <div className="flex justify-end">
          <Button asChild>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      </AuthPanel>
    );
  }

  if (done) {
    return (
      <AuthPanel
        title="Password updated"
        description="All other sessions were signed out. Redirecting you to sign in."
      >
        <p role="status" className="text-success flex items-center gap-2 text-sm font-medium">
          <CircleCheck aria-hidden className="size-5" /> Your new password is active.
        </p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Choose a new password"
      description="Pick a password you do not use anywhere else."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <input type="hidden" {...form.register("token")} />
        <TextField
          id="rp-password"
          label="New password"
          type="password"
          required
          revealable
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={form.formState.errors.password?.message}
          {...form.register("password")}
        />
        {error ? (
          <ErrorState
            title="Could not reset password"
            message={error.message}
            requestId={error.requestId}
          />
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </div>
      </form>
    </AuthPanel>
  );
}
