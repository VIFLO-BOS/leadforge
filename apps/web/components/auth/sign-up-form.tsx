"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { RegisterRequest, PASSWORD_MIN_LENGTH } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button, ErrorState, TextField } from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { setActiveOrgId } from "@/lib/org";
import { AuthPanel } from "./auth-heading";

type Values = z.input<typeof RegisterRequest>;

export function SignUpForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);

  const form = useForm<Values, unknown, RegisterRequest>({
    resolver: zodResolver(RegisterRequest),
    defaultValues: { name: "", email: "", password: "", organizationName: "", country: "NG" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch("/auth/register", { method: "POST", body: values, noOrg: true });
      setActiveOrgId(null);
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      router.push("/app");
    } catch (err) {
      if (isApiError(err) && err.code === "CONFLICT") {
        form.setError("email", {
          message: "An account with this email already exists. Try signing in.",
        });
        return;
      }
      setError({
        message: friendlyMessage(err, "We could not create your account."),
        requestId: requestIdOf(err),
      });
    }
  });

  return (
    <AuthPanel
      title="Create your workspace"
      description="Start with your organization. You can invite your team afterwards."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          id="su-name"
          label="Your name"
          required
          autoComplete="name"
          error={errors.name?.message}
          {...form.register("name")}
        />
        <TextField
          id="su-email"
          label="Work email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register("email")}
        />
        <TextField
          id="su-password"
          label="Password"
          type="password"
          required
          revealable
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={errors.password?.message}
          {...form.register("password")}
        />
        <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-[minmax(0,1fr)_7.5rem]">
          <TextField
            id="su-org"
            label="Organization name"
            required
            autoComplete="organization"
            error={errors.organizationName?.message}
            {...form.register("organizationName")}
          />
          <TextField
            id="su-country"
            label="Country"
            required
            maxLength={2}
            autoComplete="country"
            className="uppercase"
            hint="For example NG"
            error={errors.country?.message}
            {...form.register("country")}
          />
        </div>

        {error ? (
          <ErrorState title="Sign-up failed" message={error.message} requestId={error.requestId} />
        ) : null}

        <p className="text-muted-foreground text-xs leading-5">
          By continuing you agree to the{" "}
          <Link href="/legal/terms" className="text-primary underline underline-offset-4">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="text-primary underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>

        <div className="mt-2 flex flex-col-reverse gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
          <Button asChild variant="text" className="-ml-3 self-start min-[360px]:self-auto">
            <Link href="/sign-in">Sign in instead</Link>
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Create account
          </Button>
        </div>
      </form>
    </AuthPanel>
  );
}
