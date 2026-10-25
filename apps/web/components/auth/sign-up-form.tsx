"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { RegisterRequest, PASSWORD_MIN_LENGTH } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button, ErrorState, FormField, Input } from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { setActiveOrgId } from "@/lib/org";
import { AuthHeading } from "./auth-heading";

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
    <>
      <AuthHeading
        title="Create your workspace"
        description="Start with your organization. You can invite your team afterwards."
      />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField id="su-name" label="Your name" required error={errors.name?.message}>
          <Input
            id="su-name"
            autoComplete="name"
            invalid={Boolean(errors.name)}
            {...form.register("name")}
          />
        </FormField>
        <FormField id="su-email" label="Work email" required error={errors.email?.message}>
          <Input
            id="su-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            invalid={Boolean(errors.email)}
            {...form.register("email")}
          />
        </FormField>
        <FormField
          id="su-password"
          label="Password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={errors.password?.message}
        >
          <Input
            id="su-password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...form.register("password")}
          />
        </FormField>
        <FormField
          id="su-org"
          label="Organization name"
          required
          error={errors.organizationName?.message}
        >
          <Input
            id="su-org"
            autoComplete="organization"
            invalid={Boolean(errors.organizationName)}
            {...form.register("organizationName")}
          />
        </FormField>
        <FormField
          id="su-country"
          label="Country"
          required
          hint="Two-letter code, for example NG."
          error={errors.country?.message}
        >
          <Input
            id="su-country"
            maxLength={2}
            autoComplete="country"
            className="uppercase"
            invalid={Boolean(errors.country)}
            {...form.register("country")}
          />
        </FormField>

        {error ? (
          <ErrorState title="Sign-up failed" message={error.message} requestId={error.requestId} />
        ) : null}

        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-muted-foreground text-center text-xs">
          By continuing you agree to the{" "}
          <Link href="/legal/terms" className="hover:text-foreground underline underline-offset-4">
            Terms
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/privacy"
            className="hover:text-foreground underline underline-offset-4"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </form>
      <p className="text-muted-foreground mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
