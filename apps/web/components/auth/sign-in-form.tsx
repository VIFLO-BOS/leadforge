"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoginRequest } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, ErrorState, FormField, Input } from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { AuthHeading } from "./auth-heading";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);

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
      setError({ message: friendlyMessage(err, "Sign-in failed."), requestId: requestIdOf(err) });
    }
  });

  return (
    <>
      <AuthHeading title="Sign in" description="Welcome back." />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField id="si-email" label="Email" required error={errors.email?.message}>
          <Input
            id="si-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            invalid={Boolean(errors.email)}
            {...form.register("email")}
          />
        </FormField>
        <FormField id="si-password" label="Password" required error={errors.password?.message}>
          <Input
            id="si-password"
            type="password"
            autoComplete="current-password"
            invalid={Boolean(errors.password)}
            {...form.register("password")}
          />
        </FormField>
        <div className="-mt-2 text-right">
          <Link
            href="/forgot-password"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </div>

        {error ? (
          <ErrorState
            title="Could not sign in"
            message={error.message}
            requestId={error.requestId}
          />
        ) : null}

        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="text-muted-foreground mt-6 text-center text-sm">
        New to LeadForge?{" "}
        <Link
          href="/sign-up"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Create a workspace
        </Link>
      </p>
    </>
  );
}
