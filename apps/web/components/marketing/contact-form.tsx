"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ContactRequest } from "@leadforge/contracts";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button, ErrorState, TextAreaField, TextField } from "@leadforge/ui";
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
      <div role="status" className="flex flex-col items-start gap-4 py-4">
        <span className="bg-success-subtle text-success flex size-12 items-center justify-center rounded-full">
          <CircleCheck aria-hidden className="size-6" />
        </span>
        <h2 className="text-h3">Message received</h2>
        <p className="text-muted-foreground text-sm">
          Thank you. We read every message and reply by email.
        </p>
        <Button type="button" variant="outline" onClick={() => setStatus({ kind: "idle" })}>
          Send another message
        </Button>
      </div>
    );
  }

  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField
          id="contact-name"
          label="Your name"
          required
          autoComplete="name"
          error={errors.name?.message}
          {...form.register("name")}
        />
        <TextField
          id="contact-email"
          label="Email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register("email")}
        />
      </div>
      <TextField
        id="contact-company"
        label="Company"
        autoComplete="organization"
        error={errors.company?.message}
        {...form.register("company")}
      />
      <TextAreaField
        id="contact-message"
        label="Message"
        required
        rows={6}
        hint="At least 10 characters."
        error={errors.message?.message}
        {...form.register("message")}
      />

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

      <div className="flex flex-col gap-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
        <p className="text-muted-foreground text-[13px]">
          We use your details only to reply to this message.
        </p>
        <Button
          type="submit"
          size="lg"
          loading={form.formState.isSubmitting}
          className="w-full min-[480px]:w-auto"
        >
          Send message
        </Button>
      </div>
    </form>
  );
}
