"use client";

import {
  SCORE_EXPLANATION,
  type BusinessDetail,
  type DataConfidenceField,
  type ScoreSignalBreakdown,
  type ScoreSnapshot,
} from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Gauge, Info, Settings2 } from "lucide-react";
import Link from "next/link";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  type FieldState,
  FieldStatus,
  Progress,
  useHeadingLevel,
} from "@leadforge/ui";
import { formatDateTime } from "@/lib/format";
import { FIELD_LABELS } from "@/lib/labels";

const FIELD_STATES: FieldState[] = [
  "verified",
  "unverified",
  "stale",
  "expired",
  "missing",
  "conflicting",
];

function points(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

/**
 * One of the two numbers. They are rendered as separate tiles with their own meaning and are
 * never added, averaged or shown as one figure.
 */
export function ScoreTile({
  label,
  value,
  description,
  testId,
}: {
  label: string;
  value: number;
  description: string;
  testId: string;
}) {
  return (
    <div
      className="bg-surface-container-low dark:bg-surface-container-high flex min-w-0 flex-col gap-2 rounded-md p-4"
      data-testid={testId}
    >
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="text-foreground text-[2rem] font-normal leading-10">
        <span data-testid={`${testId}-value`}>{value}</span>
        <span className="text-muted-foreground text-base"> / 100</span>
      </p>
      <Progress value={value} max={100} label={`${label}: ${value} of 100`} size="sm" />
      <p className="text-muted-foreground text-xs">{description}</p>
    </div>
  );
}

const BREAKDOWN_COLUMNS: ColumnDef<ScoreSignalBreakdown>[] = [
  {
    id: "signal",
    header: "Signal",
    meta: { mobileTitle: true, label: "Signal" },
    cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
  },
  {
    id: "weight",
    header: "Weight",
    meta: { label: "Weight", align: "end" },
    cell: ({ row }) => row.original.weight,
  },
  {
    id: "value",
    header: "Value",
    meta: { label: "Value (0 to 1)", align: "end" },
    cell: ({ row }) => row.original.value.toFixed(2),
  },
  {
    id: "points",
    header: "Points",
    meta: { label: "Points", align: "end" },
    cell: ({ row }) => points(row.original.points),
  },
  {
    id: "detail",
    header: "Why",
    meta: { label: "Why" },
    cell: ({ row }) => (
      <div className="min-w-0 break-words min-[480px]:w-[22rem]">{row.original.detail}</div>
    ),
  },
];

const CONFIDENCE_COLUMNS: ColumnDef<DataConfidenceField>[] = [
  {
    id: "field",
    header: "Field",
    meta: { mobileTitle: true, label: "Field" },
    cell: ({ row }) => <span className="font-medium">{FIELD_LABELS[row.original.field]}</span>,
  },
  {
    id: "state",
    header: "State",
    meta: { label: "State" },
    cell: ({ row }) =>
      FIELD_STATES.includes(row.original.state as FieldState) ? (
        <FieldStatus state={row.original.state as FieldState} size="sm" />
      ) : (
        row.original.state
      ),
  },
  {
    id: "confidence",
    header: "Confidence",
    meta: { label: "Confidence", align: "end" },
    cell: ({ row }) => `${Math.round(row.original.confidence * 100)}%`,
  },
  {
    id: "quality",
    header: "Quality",
    meta: { label: "Quality", align: "end" },
    cell: ({ row }) => `${Math.round(row.original.quality * 100)}%`,
  },
];

/**
 * Lead score (business detail tab): fit and data confidence as two separate numbers, the
 * per-signal breakdown, the data confidence basis, the summary and the required explanation.
 */
export function ScoreTab({ detail }: { detail: BusinessDetail }) {
  const score = detail.score;
  // The card has no title of its own, so the empty state's title takes the card's level.
  const level = useHeadingLevel();
  if (!score) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            level={level}
            icon={Gauge}
            title="Not scored yet"
            description="Scores are computed with your scoring profile whenever this business's data changes, and refreshed daily. Fit and data confidence appear here as two separate numbers with the reasons for each."
            action={
              <Button asChild variant="outline">
                <Link href="/app/settings?tab=scoring">
                  <Settings2 aria-hidden /> Scoring settings
                </Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }
  return <ScoreView score={score} />;
}

export function ScoreView({ score }: { score: ScoreSnapshot }) {
  const total = score.breakdown.reduce((s, b) => s + b.points, 0);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="score-tab">
      <Card>
        <CardHeader>
          <CardTitle>Lead score</CardTitle>
          <CardDescription>
            Two separate numbers: how well the business fits your criteria, and how trustworthy its
            record is. They are never combined.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2">
            <ScoreTile
              label="Fit score"
              value={score.fit}
              testId="fit-score"
              description="Commercial match with your scoring profile's weights and ideal customer profile."
            />
            <ScoreTile
              label="Data confidence"
              value={score.dataConfidence}
              testId="data-confidence"
              description="Quality of this record: how complete, verified and fresh its contact data is."
            />
          </div>
          <Banner
            tone="info"
            icon={Info}
            title={score.explanation || SCORE_EXPLANATION}
            data-testid="score-explanation"
          />
          <p className="text-sm" data-testid="score-summary">
            {score.summary}
          </p>
          <p className="text-muted-foreground border-border border-t pt-3 text-xs">
            Computed <time dateTime={score.computedAt}>{formatDateTime(score.computedAt)}</time>{" "}
            with scoring profile version {score.profileVersion} · Source: this record&apos;s fields
            and its latest website analysis ·{" "}
            <Link href="/app/settings?tab=scoring" className="link-inline rounded-xs">
              Scoring settings
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fit score breakdown</CardTitle>
          <CardDescription>
            Each signal is a value from 0 to 1 multiplied by its weight. The points add up to the
            fit score: {points(Math.round(total * 100) / 100)} points, shown rounded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Fit score breakdown"
            columns={BREAKDOWN_COLUMNS}
            data={score.breakdown}
            getRowId={(r) => r.signal}
            enableRowSelection={false}
            enableColumnVisibility={false}
            enableDensityToggle={false}
            mobileCards={{
              render: (r) => (
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium">{r.label}</span>
                  <span className="text-[13px] tabular-nums">
                    {points(r.points)} of {r.weight} points
                    <span className="text-muted-foreground"> (value {r.value.toFixed(2)})</span>
                  </span>
                  <span className="text-muted-foreground break-anywhere text-xs">{r.detail}</span>
                </div>
              ),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data confidence</CardTitle>
          <CardDescription className="break-anywhere">
            {score.dataConfidenceDetail.basis}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Data confidence by field"
            columns={CONFIDENCE_COLUMNS}
            data={score.dataConfidenceDetail.fields}
            getRowId={(r) => r.field}
            enableRowSelection={false}
            enableColumnVisibility={false}
            enableDensityToggle={false}
            mobileCards={{
              render: (r) => (
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium">{FIELD_LABELS[r.field]}</span>
                  {FIELD_STATES.includes(r.state as FieldState) ? (
                    <FieldStatus state={r.state as FieldState} size="sm" />
                  ) : (
                    <span className="text-xs">{r.state}</span>
                  )}
                  <span className="text-muted-foreground text-xs tabular-nums">
                    Confidence {Math.round(r.confidence * 100)}% · quality{" "}
                    {Math.round(r.quality * 100)}%
                  </span>
                </div>
              ),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
