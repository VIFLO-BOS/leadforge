# LeadForge Design System

Status: Phase 0 proposal, pending approval. Last updated 2026-10-24.

One token layer, two expressions: a Framer-inspired marketing site and a Supabase-inspired dashboard. Same colors, type, spacing and components; different density and motion budgets.

**Responsive baseline: 240px.** Every page, dialog, table and form must render without horizontal page overflow from 240px upward.

## 1. Implementation

- Tokens are CSS custom properties in `packages/ui/src/tokens.css`, defined on `:root` (light), redefined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`.
- A Tailwind preset in `packages/ui/tailwind-preset.ts` maps semantic token names to utilities (`bg-surface`, `text-muted-foreground`, `border-border`).
- Components are shadcn/ui-style wrappers over Radix primitives in `packages/ui/src/components`. No component defines its own colors; all reference tokens.
- Fonts: Geist Sans and Geist Mono bundled locally via `next/font/local` with `font-display: swap` and system fallbacks (`ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif` and `ui-monospace, Consolas, monospace`).

## 2. Color tokens

| Token                    | Light                   | Dark      | Use                         |
| ------------------------ | ----------------------- | --------- | --------------------------- |
| `--background`           | `#fafafa`               | `#0f0f10` | page                        |
| `--foreground`           | `#111113`               | `#ededef` | body text                   |
| `--surface`              | `#ffffff`               | `#161618` | cards, panels               |
| `--surface-elevated`     | `#ffffff` + `shadow-sm` | `#1c1c1f` | popovers, dialogs           |
| `--primary`              | `#1f8a5b`               | `#3ecf8e` | buttons, links, active nav  |
| `--primary-foreground`   | `#ffffff`               | `#06281a` | text on primary             |
| `--secondary`            | `#f1f1f3`               | `#232326` | secondary buttons           |
| `--secondary-foreground` | `#111113`               | `#ededef` |                             |
| `--muted`                | `#f4f4f6`               | `#1c1c1f` | table headers, subtle fills |
| `--muted-foreground`     | `#6b6b74`               | `#9a9aa3` | metadata                    |
| `--border`               | `#e4e4e8`               | `#2a2a2e` | 1px borders                 |
| `--input`                | `#e4e4e8`               | `#2f2f34` | input borders               |
| `--ring`                 | `#1f8a5b`               | `#3ecf8e` | focus ring                  |
| `--success`              | `#1f8a5b`               | `#3ecf8e` |                             |
| `--warning`              | `#b7791f`               | `#f5b544` |                             |
| `--destructive`          | `#c53030`               | `#f56565` |                             |
| `--info`                 | `#2b6cb0`               | `#63b3ed` |                             |

Each status token has a matching `-foreground` and a `-subtle` background tint (10 to 15 percent). Contrast target: 4.5:1 for text, 3:1 for UI boundaries. Status is always paired with an icon or text label, never color alone. Final hex values are validated for contrast in Phase 1 and adjusted if any pair fails.

Marketing gradients: a single restrained radial glow using `--primary` at 12 to 18 percent opacity over `--background`, plus an optional 1px grid pattern at 4 percent foreground. No glass cards by default.

## 3. Typography

| Token     | Size                                                                      | Line height | Weight     | Use                |
| --------- | ------------------------------------------------------------------------- | ----------- | ---------- | ------------------ |
| `display` | `clamp(1.75rem, 1rem + 5vw, 4rem)`: 28px at 240px, 64px from about 1200px | 1.05        | 600        | marketing hero     |
| `h1`      | `clamp(1.5rem, 1rem + 3.5vw, 3rem)`: 24 to 48px                           | 1.1         | 600        | page headings      |
| `h2`      | `clamp(1.375rem, 1rem + 2.5vw, 2.25rem)`: 22 to 36px                      | 1.15        | 600        | marketing sections |
| `h3`      | `clamp(1.125rem, 1rem + 1vw, 1.5rem)`: 18 to 24px                         | 1.25        | 600        | card headings      |
| `h4`      | 20px; 18px below 360px                                                    | 1.3         | 600        | subsections        |
| `body-lg` | `clamp(1rem, 0.95rem + 0.4vw, 1.125rem)`: 16 to 18px                      | 1.6         | 400        | marketing body     |
| `body`    | 14 to 16px; dashboard default 14px                                        | 1.5         | 400        | app text           |
| `small`   | 13px; never below 12px                                                    | 1.4         | 400 or 500 | metadata           |
| `code`    | 13px mono                                                                 | 1.4         | 400        | IDs, domains       |

Rules:

- Dashboard tables use 13 to 14px. Nothing interactive is below 13px. Nothing readable is below 12px.
- Max line length 68ch for prose.
- At 240px the content box is 216px wide (240 minus two 12px gutters). `display` must not exceed 28px there, and headings get `overflow-wrap: anywhere` so a long single word cannot force overflow.

## 4. Spacing and sizing

Scale: 4, 8, 12, 16, 24, 32, 48, 64 px (`--space-1` to `--space-8`).

| Token                   | Value                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `--radius-sm`           | 6px                                                                                 |
| `--radius`              | 8px                                                                                 |
| `--radius-lg`           | 12px                                                                                |
| `--control-h`           | 36px (dense tables), 40px default, 44px touch and marketing                         |
| `--sidebar-w`           | 248px                                                                               |
| `--sidebar-w-compact`   | 68px                                                                                |
| `--topbar-h`            | 52px                                                                                |
| `--page-pad`            | 12px at 240 to 359px; 16px at 360 to 767px; 24px at 768 to 1279px; 32px from 1280px |
| `--container-marketing` | max 1200px                                                                          |
| `--container-prose`     | max 720px                                                                           |

Minimum touch target 40 by 40px. Icons 16px in tables and menus, 20px in navigation and buttons, 24px in empty states.

## 5. Components

All live in `packages/ui`. Each has TypeScript props, keyboard support, visible focus, `aria-*` wiring from Radix, and loading or disabled states where applicable. A dev-only gallery page at `/app/_design` renders every component at every breakpoint for visual checks.

| Component                    | Radix base            | Notes                                                                                                                                                                                    |
| ---------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                       | none                  | variants: primary, secondary, outline, ghost, destructive, link; sizes sm 32, md 40, lg 44; `loading` shows a spinner and sets `aria-busy`                                               |
| Input, Textarea              | none                  | 40px; error state linked via `aria-describedby`                                                                                                                                          |
| SearchField                  | none                  | debounced 300ms, clear button, `role="search"`                                                                                                                                           |
| Select                       | Select                | long option lists fall back to a full-screen Sheet picker below 360px                                                                                                                    |
| Combobox                     | Popover plus list     | for industry and location pickers                                                                                                                                                        |
| Checkbox, RadioGroup, Switch | respective primitives |                                                                                                                                                                                          |
| Badge                        | none                  | neutral, success, warning, destructive, info; outline variant                                                                                                                            |
| StatusIndicator              | none                  | dot plus label plus icon; maps field states and job states                                                                                                                               |
| Card                         | none                  | header, content, footer slots; no shadow in dashboard, `shadow-sm` on marketing                                                                                                          |
| PageHeader                   | none                  | title, description, actions slot; actions wrap below the title under 480px                                                                                                               |
| Breadcrumbs                  | none                  | collapses middle items to a dropdown under 480px                                                                                                                                         |
| EmptyState                   | none                  | icon, title, text, primary action                                                                                                                                                        |
| Skeleton                     | none                  | no shimmer under reduced motion                                                                                                                                                          |
| ErrorState                   | none                  | message, retry action, request ID in mono                                                                                                                                                |
| DataTable                    | TanStack Table        | server-side; wrapper has `overflow-x: auto`, optional sticky first column, density toggle, column visibility menu; switches to a stacked card list under 480px when `mobileCards` is set |
| Pagination                   | none                  | cursor-based: Previous and Next plus page size; counts only when known                                                                                                                   |
| FilterBar                    | Popover, Select       | chips with remove; collapses into a "Filters (n)" Sheet under 768px                                                                                                                      |
| Dialog, ConfirmDialog        | Dialog, AlertDialog   | full-screen under 480px; destructive bulk actions require a typed confirmation phrase                                                                                                    |
| Sheet                        | Dialog                | side panels for mobile navigation and detail drawers; full width under 480px                                                                                                             |
| Toast                        | sonner                | 5s default, action slot, `aria-live="polite"`                                                                                                                                            |
| Tooltip                      | Tooltip               | never the only way to reach information; touch devices use a Popover fallback                                                                                                            |
| DropdownMenu, ContextMenu    | respective primitives |                                                                                                                                                                                          |
| Tabs                         | Tabs                  | horizontally scrollable tab list on narrow widths                                                                                                                                        |
| Avatar                       | Avatar                | initials fallback                                                                                                                                                                        |
| Progress                     | Progress              | bound only to real worker progress events                                                                                                                                                |
| Kbd, Code                    | none                  | mono tokens                                                                                                                                                                              |

## 6. Layout

### Marketing

- Sticky top nav: 64px desktop, 56px mobile. Under 768px it collapses to logo plus menu button opening a full-screen Sheet. Under 320px the logo is the mark only.
- Section rhythm 64 to 96px desktop, 40 to 48px mobile. Container with `--page-pad` gutters.
- Footer: 4 columns from 1024px, 2 from 480px, 1 below.

### Dashboard

- From 1024px: fixed sidebar 248px (collapsible to 68px, state remembered), topbar 52px, content area with `--page-pad`.
- 768 to 1023px: sidebar hidden, opened as a Sheet from the topbar menu button.
- Below 768px: same Sheet; topbar shows menu button, truncated page title, org switcher as an icon.
- Content region max width 1440px, centered on wider screens.

## 7. Responsive rules (240px baseline)

Breakpoints are mobile-first; base styles target 240px.

| Name  | Min width | Notes                                            |
| ----- | --------- | ------------------------------------------------ |
| base  | 240px     | single column, 12px gutters, stacked controls    |
| `xs`  | 360px     | 16px gutters, inline button pairs allowed        |
| `sm`  | 640px     | two-column cards, inline filters                 |
| `md`  | 768px     | tablet; sidebar as Sheet, tables at full density |
| `lg`  | 1024px    | fixed sidebar                                    |
| `xl`  | 1280px    | 32px gutters                                     |
| `2xl` | 1440px    | content max width reached                        |

Hard rules:

1. `html, body { overflow-x: clip }` is a safety net, not a strategy. No layout may depend on it. CI fails if `document.documentElement.scrollWidth > window.innerWidth` at any tested width.
2. No fixed widths above 216px outside scroll containers. Flex children get `min-width: 0`; media gets `max-width: 100%`.
3. Tables live inside `overflow-x: auto` containers with a visible scroll affordance (edge fade) and a keyboard-focusable scroll region. Bulk-action bars and pagination stack vertically under 480px.
4. Dialogs and Sheets are full-screen under 480px with sticky header and footer.
5. Inputs and buttons are full width in forms under 360px. Button groups stack.
6. Topbar at 240px holds a 40px menu button, a truncated title, and one overflow menu. Nothing else.
7. Long tokens (domains, emails, IDs) use `overflow-wrap: anywhere` plus a copy button, never truncation that hides the only copy of the value.
8. Charts switch to a compact variant with hidden axis labels and a data-table toggle under 480px.
9. Typography uses `clamp()` with minimums safe for a 216px content width.
10. Test matrix: 240, 320, 375, 768, 1024, 1440 px. 240px at 100 percent zoom is the floor.

## 8. Motion

- Library: Framer Motion. Every non-essential animation goes through `useMotionSafe()`, which returns `false` under `prefers-reduced-motion: reduce`; components then render their final state immediately.
- Marketing: hero fade and translate 400ms once; section reveals 300ms with 24px translate, once per session; hover lifts 150ms; no looping animation except a product demo that is paused by default.
- Dashboard: 120 to 200ms opacity and translate for dialogs, sheets and dropdowns driven by Radix `data-state`; no animation inside DataTable rows, bulk actions or polling updates.
- Never animate numbers that are not real backend data.

## 9. Accessibility

- All interactive components come from Radix or native elements. No `div` buttons.
- Focus ring: 2px `--ring` with 2px offset, visible on `:focus-visible`.
- Skip-to-content link on every layout.
- Live regions for job status changes and toasts.
- Form errors announced and linked by `aria-describedby`.
- Color is never the sole carrier of status; every status badge includes an icon and text.
- Tested keyboard-only and with a screen reader on the directory, job wizard, billing checkout and pipeline.

## 10. Content rules

- Buttons say what they do: "Create discovery job", not "Submit".
- Empty states explain what will appear and offer the first action.
- Detections use "No X was detected", never "Has no X".
- Every data panel shows its source and a timestamp.
- No demo metrics on marketing pages. Static product screenshots use clearly labeled sample data.
