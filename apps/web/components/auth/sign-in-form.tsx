"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoginRequest } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, ErrorState, TextField } from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { requestIdOf, signInErrorMessage } from "@/lib/errors";
import { safeReturnPath } from "@/lib/session";
import { AuthLink, AuthPanel } from "./auth-heading";

/** Same-origin return path only (never `//host`, `/\host` or an auth page); defaults to /app. */
function safeNext(value: string | null): string {
  return (
    safeReturnPath(value, typeof window !== "undefined" ? window.location.origin : undefined) ??
    "/app"
  );
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<{ title: string; message: string; requestId?: string } | null>(
    null,
  );

  const form = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequest),
    defaultValues: { email: "", password: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch("/auth/login", { method: "POST", body: values, noOrg: true });
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      router.push(next);
    } catch (err) {
      setError({ ...signInErrorMessage(err), requestId: requestIdOf(err) });
    }
  });

  return (
    <AuthPanel title="Sign in" description="Use your LeadForge account to open your workspace.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          id="si-email"
          label="Email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register("email")}
        />
        <TextField
          id="si-password"
          label="Password"
          type="password"
          required
          revealable
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register("password")}
        />
        <AuthLink href="/forgot-password">Forgot your password?</AuthLink>

        {error ? (
          <ErrorState
            title={error.title}
            message={error.message}
            requestId={error.requestId}
            data-testid="sign-in-error"
          />
        ) : null}

        <div className="mt-4 flex flex-col-reverse gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
          <Button asChild variant="text" className="-ml-3 self-start min-[360px]:self-auto">
            <Link href="/sign-up">Create a workspace</Link>
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting} className="min-w-28">
            Sign in
          </Button>
        </div>
      </form>
    </AuthPanel>
  );
}
