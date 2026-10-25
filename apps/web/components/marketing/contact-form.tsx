"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ContactRequest } from "@leadforge/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button, ErrorState, FormField, Input, Textarea } from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";

type Values = z.input<typeof ContactRequest>;

export function ContactForm({
  defaultKind = "contact",
}: {
  defaultKind?: "contact" | "data_request";
}) {
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string; requestId?: string }
  >({
    kind: "idle",
  });

  const form = useForm<Values, unknown, ContactRequest>({
    resolver: zodResolver(ContactRequest),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      message: "",
      kind: defaultKind,
      website: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus({ kind: "idle" });
    try {
      await apiFetch<{ received: boolean }>("/public/contact", {
        method: "POST",
        body: values,
        noOrg: true,
      });
      setStatus({ kind: "sent" });
      form.reset({ name: "", email: "", company: "", message: "", kind: defaultKind, website: "" });
    } catch (err) {
      const message =
        isApiError(err) && err.code === "RATE_LIMITED"
          ? "You have sent a few messages recently. Please wait an hour before sending another."
          : friendlyMessage(err, "Your message could not be sent.");
      setStatus({ kind: "error", message, requestId: requestIdOf(err) });
    }
  });

  if (status.kind === "sent") {
    return (
      <div role="status" className="border-border bg-surface rounded-lg border p-6">
        <h2 className="text-base font-semibold">Message received</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Thank you. We read every message and reply by email.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => setStatus({ kind: "idle" })}
        >
          Send another message
        </Button>
      </div>
    );
  }

  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="contact-name" label="Your name" required error={errors.name?.message}>
          <Input
            id="contact-name"
            autoComplete="name"
            invalid={Boolean(errors.name)}
            {...form.register("name")}
          />
        </FormField>
        <FormField id="contact-email" label="Email" required error={errors.email?.message}>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            invalid={Boolean(errors.email)}
            {...form.register("email")}
          />
        </FormField>
      </div>
      <FormField id="contact-company" label="Company" error={errors.company?.message}>
        <Input id="contact-company" autoComplete="organization" {...form.register("company")} />
      </FormField>
      <FormField
        id="contact-message"
        label="Message"
        required
        error={errors.message?.message}
        hint="At least 10 characters."
      >
        <Textarea
          id="contact-message"
          rows={6}
          invalid={Boolean(errors.message)}
          {...form.register("message")}
        />
      </FormField>

      {/* Honeypot: hidden from people, filled by bots. Must stay empty. */}
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden>
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...form.register("website")}
        />
      </div>
      <input type="hidden" {...form.register("kind")} />

      {status.kind === "error" ? (
        <ErrorState title="Could not send" message={status.message} requestId={status.requestId} />
      ) : null}

      <div className="flex flex-col gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
        <p className="text-muted-foreground text-xs">
          We use your details only to reply to this message.
        </p>
        <Button
          type="submit"
          size="lg"
          loading={form.formState.isSubmitting}
          className="w-full min-[360px]:w-auto"
        >
          Send message
        </Button>
      </div>
    </form>
  );
}
