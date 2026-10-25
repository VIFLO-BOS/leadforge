export const ACTIVE_ORG_KEY = "lf.activeOrg";

export function getActiveOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_ORG_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrgId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_ORG_KEY, id);
    else window.localStorage.removeItem(ACTIVE_ORG_KEY);
    window.dispatchEvent(new CustomEvent("lf:org-changed", { detail: id }));
  } catch {
    // Storage can be unavailable (private mode); the header simply falls back to the first org.
  }
}
