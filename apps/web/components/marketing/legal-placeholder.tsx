/**
 * A visible gap in a draft legal page: company details LeadForge does not know yet (legal entity,
 * address, contacts, governing law). Rendered as bracketed text with a dashed outline so nobody
 * mistakes it for a real detail; the operator replaces each one before launch.
 */
export function LegalPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="border-warning text-foreground rounded-xs whitespace-normal border border-dashed px-1"
      data-legal-placeholder
    >
      [To be completed: {children}]
    </span>
  );
}
