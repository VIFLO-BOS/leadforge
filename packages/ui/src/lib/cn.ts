import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge taught the design system's custom theme keys, so `text-h3` (a font size) and
 * `text-muted-foreground` (a colour) do not cancel each other, and shadow/radius tokens merge
 * correctly.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "h1",
            "h2",
            "h3",
            "h4",
            "title",
            "lead",
            "body-lg",
            "body",
            "label",
            "caption",
          ],
        },
      ],
      shadow: [{ shadow: ["1", "2", "3"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
