"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ForgotPasswordRequest,
  PASSWORD_MIN_LENGTH,
  ResetPasswordRequest,
} from "@leadforge/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, ErrorState, FormField, Input } from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { AuthHeading } from "./auth-heading";

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
      <>
        <AuthHeading
          title="Check your email"
          description="If an account exists for that address, a reset link is on its way. It expires in one hour."
        />
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Reset your password"
        description="Enter your email and we will send a reset link."
      />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField
          id="fp-email"
          label="Email"
          required
          error={form.formState.errors.email?.message}
        >
          <Input
            id="fp-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            {...form.register("email")}
          />
        </FormField>
        {error ? (
          <ErrorState title="Request failed" message={error.message} requestId={error.requestId} />
        ) : null}
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
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
      <>
        <AuthHeading
          title="Reset link missing"
          description="Open the link from your email, or request a new one."
        />
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </>
    );
  }

  if (done) {
    return (
      <AuthHeading
        title="Password updated"
        description="All other sessions were signed out. Redirecting you to sign in."
      />
    );
  }

  return (
    <>
      <AuthHeading title="Choose a new password" />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <input type="hidden" {...form.register("token")} />
        <FormField
          id="rp-password"
          label="New password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={form.formState.errors.password?.message}
        >
          <Input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            {...form.register("password")}
          />
        </FormField>
        {error ? (
          <ErrorState
            title="Could not reset password"
            message={error.message}
            requestId={error.requestId}
          />
        ) : null}
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </>
  );
}
