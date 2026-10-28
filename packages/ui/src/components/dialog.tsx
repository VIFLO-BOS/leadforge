"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { HeadingLevel } from "./heading-level";
import { TextField } from "./input";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 duration-300 data-[state=closed]:duration-200 motion-reduce:animate-none",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

/**
 * Returns focus to whatever had it when a dialog or sheet opened. Radix only returns focus to a
 * DialogTrigger; most LeadForge dialogs open from state (a button's onClick, a menu item, a URL
 * parameter), and without this focus would fall to <body> on close.
 */
export function useReturnFocus(handlers: {
  onOpenAutoFocus?: ((event: Event) => void) | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}) {
  const opener = React.useRef<HTMLElement | null>(null);
  const { onOpenAutoFocus, onCloseAutoFocus } = handlers;
  return {
    // Radix fires this before it moves focus in, so activeElement is still the opener.
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const el = opener.current;
      if (el?.isConnected) {
        event.preventDefault();
        el.focus();
      }
    },
  };
}

export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  hideClose?: boolean;
  /** Max width from 480px up. */
  size?: "sm" | "md" | "lg";
}

const SIZE = {
  sm: "min-[480px]:max-w-sm",
  md: "min-[480px]:max-w-lg",
  lg: "min-[480px]:max-w-2xl",
} as const;

/**
 * Full-screen under 480px with sticky header and footer; a 28px-radius container dialog above,
 * entering with a short scale-and-fade on emphasized decelerate easing.
 */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    { className, children, hideClose, size = "md", onOpenAutoFocus, onCloseAutoFocus, ...props },
    ref,
  ) => {
    const focus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          className={cn(
            "bg-surface-elevated text-foreground fixed inset-0 z-50 flex max-h-dvh flex-col outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-300 ease-[cubic-bezier(0.05,0.7,0.1,1)] data-[state=closed]:duration-200 motion-reduce:animate-none",
            "min-[480px]:shadow-3 min-[480px]:data-[state=open]:slide-in-from-bottom-0 min-[480px]:data-[state=open]:zoom-in-95 min-[480px]:inset-auto min-[480px]:left-1/2 min-[480px]:top-1/2 min-[480px]:max-h-[calc(100dvh-48px)] min-[480px]:w-[calc(100vw-48px)] min-[480px]:-translate-x-1/2 min-[480px]:-translate-y-1/2 min-[480px]:rounded-2xl",
            SIZE[size],
            className,
          )}
          {...props}
        >
          {/* The title is the dialog's h2; headings inside the dialog start at h3. */}
          <HeadingLevel level={3}>{children}</HeadingLevel>
          {hideClose ? null : (
            <DialogPrimitive.Close
              aria-label="Close"
              className="state-layer text-muted-foreground absolute right-3 top-3 flex size-10 items-center justify-center rounded-full"
            >
              <X aria-hidden className="size-5" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Sticky only in the full-screen layout. From 480px the dialog is centred with a transform,
        // and sticky offsets resolve against the untransformed box, which pulled the footer of tall
        // dialogs up over the body. The body is the scroll container, so flex keeps both pinned.
        "bg-surface-elevated sticky top-0 z-[1] flex shrink-0 flex-col gap-2 px-5 pb-3 pr-16 pt-5 min-[480px]:static min-[480px]:px-6 min-[480px]:pr-16 min-[480px]:pt-6",
        className,
      )}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-2 min-[480px]:px-6", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface-elevated border-border sticky bottom-0 z-[1] flex shrink-0 flex-col-reverse gap-2 border-t px-5 py-4 min-[360px]:flex-row min-[360px]:justify-end min-[480px]:static min-[480px]:border-t-0 min-[480px]:px-6 min-[480px]:pb-6 min-[480px]:pt-4",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("break-anywhere text-xl font-normal leading-7 tracking-[-0.01em]", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-muted-foreground text-sm leading-5", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * When set, the user must type this phrase exactly before confirming. Required for destructive
   * bulk actions (for example "DELETE 24 RECORDS").
   */
  confirmPhrase?: string;
  /** Extra consequences listed in the body (counts, affected items, a required reason field). */
  children?: React.ReactNode;
  /** Keeps the confirm action disabled, for example until a required reason is filled in. */
  confirmDisabled?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Alert dialog for confirmations. Focus starts on Cancel (or the phrase field), Escape cancels,
 * and the confirm action stays disabled until any required phrase matches exactly.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  confirmPhrase,
  children,
  confirmDisabled,
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const canConfirm = (!confirmPhrase || typed === confirmPhrase) && !confirmDisabled;
  const inputId = React.useId();
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? undefined : onOpenChange(o))}>
      <DialogContent
        role="alertdialog"
        hideClose
        size="sm"
        onOpenAutoFocus={(e) => {
          if (!confirmPhrase) {
            e.preventDefault();
            cancelRef.current?.focus();
          }
        }}
      >
        <DialogHeader className="pr-5 min-[480px]:pr-6">
          {destructive ? (
            <span className="text-destructive flex size-6 items-center">
              <TriangleAlert aria-hidden className="size-6" />
            </span>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children || confirmPhrase ? (
          <DialogBody className="flex flex-col gap-4 pb-2">
            {children}
            {confirmPhrase ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  Type{" "}
                  <span className="bg-foreground/10 rounded-xs px-1 font-mono text-[13px]">
                    {confirmPhrase}
                  </span>{" "}
                  to confirm.
                </p>
                <TextField
                  id={inputId}
                  label="Confirmation phrase"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  containerClassName="[--field-bg:var(--surface-elevated)]"
                />
              </div>
            ) : null}
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="text"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "primary"}
            disabled={!canConfirm}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
