"use client";

import { Badge } from "@leadforge/ui";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Logo } from "@/components/marketing/logo";
import { ChartsSection, DataTableSection, FilterBarSection } from "./sections-data";
import {
  FeedbackSection,
  StatusSection,
  StructureSection,
  SurfacesSection,
  ValuesSection,
} from "./sections-display";
import {
  ButtonsSection,
  FieldsSection,
  PickersSection,
  SelectionControlsSection,
} from "./sections-inputs";
import { MotionSection, OverlaysSection } from "./sections-overlays";

const SECTIONS = [
  { id: "buttons", label: "Buttons" },
  { id: "fields", label: "Text fields" },
  { id: "pickers", label: "Pickers" },
  { id: "selection", label: "Selection" },
  { id: "status", label: "Status" },
  { id: "cards", label: "Cards and stats" },
  { id: "structure", label: "Structure" },
  { id: "feedback", label: "Feedback" },
  { id: "values", label: "Values" },
  { id: "data-table", label: "DataTable" },
  { id: "filter-bar", label: "FilterBar" },
  { id: "charts", label: "Charts" },
  { id: "overlays", label: "Overlays" },
  { id: "motion", label: "Motion" },
];

/** Development-only component gallery. Every value is fictional sample data. */
export function DesignGallery() {
  return (
    <div className="bg-surface-tint min-h-dvh">
      <header className="bg-surface-tint sticky top-0 z-30">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-[var(--page-pad)]">
          <Logo />
          <span className="text-muted-foreground hidden truncate text-sm sm:inline">
            Design system
          </span>
          <Badge variant="warning" className="shrink-0">
            Dev only
          </Badge>
          <span className="ml-auto">
            <ThemeToggle />
          </span>
        </div>
        <nav
          aria-label="Gallery sections"
          className="mx-auto max-w-[1440px] px-[var(--page-pad)] pb-3"
        >
          <ul className="scrollbar-none flex gap-2 overflow-x-auto">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <a
                  href={`#${s.id}`}
                  className="state-layer border-border-strong text-foreground inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main
        id="main"
        className="mx-auto flex max-w-[1440px] flex-col gap-12 px-[var(--page-pad)] pb-24 pt-6"
      >
        <div className="flex flex-col gap-2">
          <h1 className="text-h1">LeadForge components</h1>
          <p className="text-muted-foreground max-w-3xl text-base">
            Every packages/ui component with sample data. This page exists only in development
            builds. Check it at 240, 320, 375, 768, 1024 and 1440px in both themes.
          </p>
        </div>
        <ButtonsSection />
        <FieldsSection />
        <PickersSection />
        <SelectionControlsSection />
        <StatusSection />
        <SurfacesSection />
        <StructureSection />
        <FeedbackSection />
        <ValuesSection />
        <DataTableSection />
        <FilterBarSection />
        <ChartsSection />
        <OverlaysSection />
        <MotionSection />
      </main>
    </div>
  );
}
