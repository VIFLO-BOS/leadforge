export const SITE_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "LeadForge";

export const SITE_URL =
  process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const SITE_DESCRIPTION =
  "LeadForge discovers businesses through permitted sources, verifies public contact details with full provenance, and helps your team manage qualified leads. Built first for Nigeria.";

export const MARKETING_NAV = [
  { href: "/product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

export const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Overview" },
      { href: "/product#discovery", label: "Business discovery" },
      { href: "/product#enrichment", label: "Contact enrichment" },
      { href: "/product#analysis", label: "Website analysis" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/contact", label: "Get help" },
      { href: "/legal/data-collection#requests", label: "Data removal request" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/acceptable-use", label: "Acceptable use" },
      { href: "/legal/data-collection", label: "Data collection policy" },
    ],
  },
] as const;
