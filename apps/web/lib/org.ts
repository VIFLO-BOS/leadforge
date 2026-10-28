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

/**
 * Stores the resolved organization before any child query runs. Child effects fire before the
 * shell's own effects, so without this a first visit (nothing stored yet) sent requests without
 * the organization header. Writes only when the value differs and emits no event, so it is safe
 * to call during render.
 */
export function ensureActiveOrgId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(ACTIVE_ORG_KEY) !== id) {
      window.localStorage.setItem(ACTIVE_ORG_KEY, id);
    }
  } catch {
    // Storage unavailable: requests fall back to no header and the API answers ORG_FORBIDDEN.
  }
}
