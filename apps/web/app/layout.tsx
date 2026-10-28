import type { Metadata, Viewport } from "next";
import "./globals.css";
import { brandMono, brandSans } from "./fonts";
import { Providers } from "./providers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}: business discovery and lead intelligence`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: business discovery and lead intelligence`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_NG",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: business discovery and lead intelligence`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121317" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${brandSans.variable} ${brandMono.variable}`}
    >
      <body className="font-sans">
        <a
          href="#main"
          className="bg-primary text-primary-foreground sr-only z-[100] rounded-full px-4 py-2.5 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
