import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Design system (development only)",
  robots: { index: false, follow: false },
};

/**
 * Component gallery at /app/_design (rewritten to /app/design-gallery in next.config.ts). Development builds only: the production branch returns 404
 * and webpack drops the gallery import because NODE_ENV is replaced at build time.
 */
export default async function DesignPage() {
  if (process.env.NODE_ENV !== "production") {
    const { DesignGallery } = await import("@/components/design/gallery");
    return <DesignGallery />;
  }
  notFound();
}
