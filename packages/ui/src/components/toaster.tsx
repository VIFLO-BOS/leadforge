"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export { toast } from "sonner";

/**
 * Snackbar-style toasts: inverse surface, 5s default, polite live region, an action slot in the
 * inverse primary colour. Bottom-centre on phones, bottom-left from 768px as in Material.
 */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-left"
      duration={5000}
      closeButton
      gap={8}
      offset={16}
      mobileOffset={12}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group flex w-full max-w-[min(32rem,calc(100vw-24px))] items-center gap-3 rounded-xs bg-inverse-surface py-3 pr-12 pl-4 text-inverse-foreground shadow-3 font-sans",
          title: "text-sm leading-5 font-normal",
          description: "text-sm leading-5 text-inverse-foreground/80",
          icon: "shrink-0 [&_svg]:size-5",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          actionButton:
            "ml-auto shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-inverse-primary hover:bg-inverse-primary/10",
          cancelButton:
            "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-inverse-foreground hover:bg-inverse-foreground/10",
          closeButton:
            "!absolute !top-1/2 !right-2 !left-auto !size-8 !-translate-y-1/2 !translate-x-0 !rounded-full !border-0 !bg-transparent !text-inverse-foreground hover:!bg-inverse-foreground/10 [&_svg]:!size-4",
          success: "[&_[data-icon]_svg]:text-inverse-primary",
          error: "[&_[data-icon]_svg]:text-inverse-primary",
          warning: "[&_[data-icon]_svg]:text-inverse-primary",
          info: "[&_[data-icon]_svg]:text-inverse-primary",
        },
      }}
      {...props}
    />
  );
}
