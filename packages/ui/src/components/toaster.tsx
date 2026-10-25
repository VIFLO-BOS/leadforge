"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export { toast } from "sonner";

/** Toasts: 5s default, polite live region, tokens instead of hardcoded colors. */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      duration={5000}
      closeButton
      gap={8}
      offset={16}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group !rounded-lg !border !border-border !bg-surface-elevated !text-foreground !shadow-md !max-w-[calc(100vw-24px)]",
          title: "!text-sm !font-medium",
          description: "!text-sm !text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-foreground",
          closeButton: "!border-border !bg-surface !text-muted-foreground",
          success: "[&_svg]:!text-success",
          error: "[&_svg]:!text-destructive",
          warning: "[&_svg]:!text-warning",
          info: "[&_svg]:!text-info",
        },
      }}
      {...props}
    />
  );
}
