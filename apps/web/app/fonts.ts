import localFont from "next/font/local";

/**
 * Google Sans Flex (SIL OFL 1.1), self-hosted through next/font from the Fontsource package.
 * The latin "opsz" file carries the weight (1 to 1000) and optical-size axes in 117 KB, so display
 * sizes get tighter optical forms automatically (font-optical-sizing: auto).
 * next/font/google in Next 15.5 does not list this family yet; see docs/DESIGN_SYSTEM.md section 3.
 */
export const brandSans = localFont({
  src: "../node_modules/@fontsource-variable/google-sans-flex/files/google-sans-flex-latin-opsz-normal.woff2",
  variable: "--font-brand-sans",
  weight: "1 1000",
  style: "normal",
  display: "swap",
  preload: true,
  fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial"],
  adjustFontFallback: "Arial",
});

/** Google Sans Code (SIL OFL 1.1): the matching monospace for IDs, domains and code. */
export const brandMono = localFont({
  src: "../node_modules/@fontsource-variable/google-sans-code/files/google-sans-code-latin-wght-normal.woff2",
  variable: "--font-brand-mono",
  weight: "300 800",
  style: "normal",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "Cascadia Mono", "Consolas", "Liberation Mono", "monospace"],
  adjustFontFallback: false,
});
