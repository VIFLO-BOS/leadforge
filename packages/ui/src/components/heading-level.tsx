"use client";

import * as React from "react";

export type HeadingLevelValue = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Heading levels follow nesting, so no page skips a level (WCAG 1.3.1; axe `heading-order`).
 *
 * The context holds the level the next heading at this depth should use. Pages start at 2, under
 * the page's single h1 (PageHeader or the marketing hero). Card, DialogContent and SheetContent
 * raise it for their content, so a CardTitle under the page h1 is an h2, an EmptyState inside that
 * card is an h3, and a card inside a dialog (whose title is the dialog's h2) is an h3.
 *
 * A page section with its own heading wraps its content in <HeadingLevel> (one deeper than the
 * section heading), or renders that heading with <Heading> inside <HeadingLevel>.
 */
const HeadingLevelContext = React.createContext<HeadingLevelValue>(2);

export function clampLevel(level: number): HeadingLevelValue {
  return Math.min(6, Math.max(1, Math.round(level))) as HeadingLevelValue;
}

export function useHeadingLevel(): HeadingLevelValue {
  return React.useContext(HeadingLevelContext);
}

/** Sets the heading level for its subtree: `level`, or one deeper than the current level. */
export function HeadingLevel({
  level,
  children,
}: {
  level?: HeadingLevelValue;
  children: React.ReactNode;
}) {
  const parent = useHeadingLevel();
  return (
    <HeadingLevelContext.Provider value={level ?? clampLevel(parent + 1)}>
      {children}
    </HeadingLevelContext.Provider>
  );
}

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Explicit level; otherwise the context level. */
  level?: HeadingLevelValue;
}

/** A heading at the context level (or `level`). Visual size comes from className, never the tag. */
export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level, ...props }, ref) => {
    const ctx = useHeadingLevel();
    const Tag = `h${level ?? ctx}` as "h2";
    return <Tag ref={ref} {...props} />;
  },
);
Heading.displayName = "Heading";
