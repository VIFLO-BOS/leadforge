"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Outlined field chrome shared by Input, Textarea, Select and Combobox triggers. Focus thickens the
 * outline to 2px in the primary colour (via an inset shadow, no layout shift) instead of an
 * offset ring, as Material outlined fields do. It keys on :focus-within, not :focus: when keyboard
 * focus reaches the calendar button inside a date or datetime-local input, the input itself no
 * longer matches :focus, and the field would otherwise lose its focus indicator (Stage 9).
 */
export const fieldClasses =
  "transition-ui w-full min-w-0 rounded-sm border border-input bg-[var(--field-bg,var(--surface))] text-foreground placeholder:text-muted-foreground outline-none focus-visible:outline-none focus-within:border-primary focus-within:shadow-[inset_0_0_0_1px_var(--primary)] aria-invalid:border-destructive aria-invalid:focus-within:shadow-[inset_0_0_0_1px_var(--destructive)] disabled:cursor-not-allowed disabled:opacity-[0.38]";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", invalid, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cn(fieldClasses, "flex h-10 px-3 text-sm", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cn(fieldClasses, "flex min-h-[112px] px-3 py-2.5 text-sm", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

type FieldShared = {
  /** Visible label. Floats into the outline when the field is focused or filled. */
  label: React.ReactNode;
  /** Supporting text below the field. Replaced by `error` when present. */
  hint?: React.ReactNode;
  error?: string | undefined;
  /** Leading icon inside the field. */
  leading?: React.ReactNode;
  /** Trailing element inside the field (icon, unit, icon button). */
  trailing?: React.ReactNode;
  containerClassName?: string;
};

export type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "placeholder"> &
  FieldShared & {
    id: string;
    /** Adds a show/hide toggle for password fields. */
    revealable?: boolean;
  };

const labelBase =
  "pointer-events-none absolute top-7 left-3 z-[1] max-w-[calc(100%-1.5rem)] origin-[left_center] truncate rounded-xs bg-[var(--field-bg,var(--surface))] px-1 text-base leading-5 text-muted-foreground transition-[translate,scale] duration-200 ease-emphasized motion-reduce:transition-none";

/** Floated: centred on the top border at 12px. Resting (empty, unfocused): centred in the field. */
const labelFloat =
  "-translate-y-[calc(50%+28px)] scale-75 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus-within:-translate-y-[calc(50%+28px)] peer-focus-within:scale-75 peer-focus-within:text-primary peer-aria-invalid:text-destructive";

/**
 * Material outlined text field with a floating label. The label is a real <label for>, the
 * supporting text and error are wired with aria-describedby, and the field works with
 * react-hook-form's register (ref is forwarded to the input).
 */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      id,
      label,
      hint,
      error,
      leading,
      trailing,
      required,
      revealable,
      type = "text",
      className,
      containerClassName,
      ...props
    },
    ref,
  ) => {
    const [revealed, setRevealed] = React.useState(false);
    const describedBy =
      [hint && !error ? `${id}-hint` : null, error ? `${id}-error` : null]
        .filter(Boolean)
        .join(" ") || undefined;
    const effectiveType = revealable && type === "password" && revealed ? "text" : type;
    const trailingNode =
      revealable && type === "password" ? (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          className="state-layer text-muted-foreground flex size-10 items-center justify-center rounded-full"
        >
          {revealed ? (
            <EyeOff aria-hidden className="size-5" />
          ) : (
            <Eye aria-hidden className="size-5" />
          )}
        </button>
      ) : (
        trailing
      );

    return (
      <div className={cn("flex min-w-0 flex-col gap-1", containerClassName)}>
        <div className="relative min-w-0">
          {leading ? (
            <span className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 z-[1] flex -translate-y-1/2 [&_svg]:size-5">
              {leading}
            </span>
          ) : null}
          <input
            ref={ref}
            id={id}
            type={effectiveType}
            placeholder=" "
            required={required}
            aria-invalid={error ? true : props["aria-invalid"] || undefined}
            aria-describedby={describedBy}
            className={cn(
              fieldClasses,
              "peer block h-14 px-4 text-base",
              leading && "pl-11",
              trailingNode && "pr-12",
              "placeholder:text-transparent",
              className,
            )}
            {...props}
          />
          <label
            htmlFor={id}
            className={cn(
              labelBase,
              labelFloat,
              leading && "peer-placeholder-shown:left-10 peer-focus-within:left-3",
            )}
          >
            {label}
            {required ? (
              <span aria-hidden className="text-destructive">
                {" "}
                *
              </span>
            ) : null}
          </label>
          {trailingNode ? (
            <span className="text-muted-foreground absolute right-1.5 top-1/2 z-[1] flex -translate-y-1/2 items-center">
              {trailingNode}
            </span>
          ) : null}
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-destructive px-4 text-xs">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-hint`} className="text-muted-foreground px-4 text-xs">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
TextField.displayName = "TextField";

export type TextAreaFieldProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "placeholder"
> &
  Omit<FieldShared, "leading" | "trailing"> & { id: string };

/** Outlined multi-line field with a label that sits in the outline notch. */
export const TextAreaField = React.forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ id, label, hint, error, required, className, containerClassName, ...props }, ref) => {
    const describedBy =
      [hint && !error ? `${id}-hint` : null, error ? `${id}-error` : null]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <div className={cn("flex min-w-0 flex-col gap-1", containerClassName)}>
        <div className="relative min-w-0 pt-2">
          <textarea
            ref={ref}
            id={id}
            placeholder=" "
            required={required}
            aria-invalid={error ? true : props["aria-invalid"] || undefined}
            aria-describedby={describedBy}
            className={cn(
              fieldClasses,
              "peer block min-h-[140px] px-4 pb-3 pt-4 text-base placeholder:text-transparent",
              className,
            )}
            {...props}
          />
          <label
            htmlFor={id}
            className="text-muted-foreground peer-focus-within:text-primary peer-aria-invalid:text-destructive rounded-xs pointer-events-none absolute left-3 top-0 z-[1] max-w-[calc(100%-1.5rem)] truncate bg-[var(--field-bg,var(--surface))] px-1 text-xs leading-4"
          >
            {label}
            {required ? (
              <span aria-hidden className="text-destructive">
                {" "}
                *
              </span>
            ) : null}
          </label>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-destructive px-4 text-xs">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-hint`} className="text-muted-foreground px-4 text-xs">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
TextAreaField.displayName = "TextAreaField";
