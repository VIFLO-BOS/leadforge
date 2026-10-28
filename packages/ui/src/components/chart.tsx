"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";

type TooltipProps = TooltipContentProps<TooltipValueType, string | number>;
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "../lib/cn";
import { useMotionSafe } from "../hooks/use-motion-safe";
import { MEDIA, useMediaQuery } from "../hooks/use-media-query";
import { Heading } from "./heading-level";
import { SegmentedControl } from "./segmented-control";
import { Skeleton } from "./states";

/** Categorical slots in fixed order. Never cycled: more than 8 series must be folded into "Other". */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

export interface ChartSeries {
  /** Data key in each row. */
  key: string;
  label: string;
  /** Pin a slot (1 to 8) so an entity keeps its colour when other series are filtered out. */
  slot?: number;
}

export type ChartRow = Record<string, string | number | null>;

export interface ChartProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  type: "bar" | "line" | "area";
  data: ChartRow[];
  /** Category or time key on the x axis (y axis for horizontal bars). */
  xKey: string;
  xLabel?: string;
  series: ChartSeries[];
  title: string;
  description?: React.ReactNode;
  /** Source and timestamp, required for discovered data. */
  footnote?: React.ReactNode;
  valueFormatter?: (value: number) => string;
  xFormatter?: (value: string | number) => string;
  /** Horizontal bars for long category names (lead sources, industries). */
  layout?: "vertical" | "horizontal";
  stacked?: boolean;
  height?: number;
  loading?: boolean;
  emptyMessage?: string;
  defaultView?: "chart" | "table";
  /** Whole-number value ticks (counts). Default true; pass false for fractional measures. */
  integerTicks?: boolean;
}

const defaultFormat = (v: number) =>
  new Intl.NumberFormat(undefined, { notation: v >= 10000 ? "compact" : "standard" }).format(v);

/**
 * Chart card on Recharts with an accessible "Chart | Table" switch. Under 480px it renders a
 * compact variant (no axis labels, shorter plot). Marks follow docs/DESIGN_SYSTEM.md section 9:
 * bars at most 24px with 4px rounded data ends, 2px lines, a 10% area wash, hairline grid.
 */
export function Chart({
  type,
  data,
  xKey,
  xLabel,
  series,
  title,
  description,
  footnote,
  valueFormatter = defaultFormat,
  xFormatter,
  layout = "vertical",
  stacked = false,
  height = 280,
  loading = false,
  emptyMessage = "No data for this period yet.",
  defaultView = "chart",
  integerTicks = true,
  className,
  ...props
}: ChartProps) {
  const motionSafe = useMotionSafe();
  const compact = useMediaQuery(MEDIA.narrow);
  const [view, setView] = React.useState<"chart" | "table">(defaultView);
  const headingId = React.useId();
  const descId = React.useId();
  const empty = !loading && data.length === 0;
  const plotHeight = compact ? Math.min(height, 200) : height;
  const colorOf = (s: ChartSeries, i: number) =>
    CHART_COLORS[((s.slot ?? i + 1) - 1) % CHART_COLORS.length] ?? CHART_COLORS[0];
  const fmtX = (v: unknown) =>
    xFormatter && (typeof v === "string" || typeof v === "number")
      ? xFormatter(v)
      : String(v ?? "");

  const horizontal = type === "bar" && layout === "horizontal";
  const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
  const common = {
    data,
    margin: compact
      ? { top: 8, right: 8, bottom: 0, left: 8 }
      : { top: 8, right: 16, bottom: 4, left: horizontal ? 8 : 0 },
    accessibilityLayer: true,
  };

  const grid = (
    <CartesianGrid
      stroke="var(--chart-grid)"
      strokeWidth={1}
      vertical={horizontal}
      horizontal={!horizontal}
    />
  );

  const categoryAxis = horizontal ? (
    <YAxis
      type="category"
      dataKey={xKey}
      tickLine={false}
      axisLine={false}
      tick={compact ? false : axisTick}
      width={compact ? 0 : 120}
      tickFormatter={fmtX}
    />
  ) : (
    <XAxis
      dataKey={xKey}
      tickLine={false}
      axisLine={{ stroke: "var(--chart-axis)" }}
      tick={compact ? false : axisTick}
      height={compact ? 4 : 30}
      tickFormatter={fmtX}
      minTickGap={16}
    />
  );
  const valueAxis = horizontal ? (
    <XAxis
      type="number"
      allowDecimals={!integerTicks}
      tickLine={false}
      axisLine={false}
      tick={compact ? false : axisTick}
      height={compact ? 4 : 30}
      tickFormatter={(v: number) => valueFormatter(v)}
    />
  ) : (
    <YAxis
      allowDecimals={!integerTicks}
      tickLine={false}
      axisLine={false}
      tick={compact ? false : axisTick}
      width={compact ? 0 : 48}
      tickFormatter={(v: number) => valueFormatter(v)}
    />
  );

  const tooltip = (
    <RechartsTooltip
      cursor={
        type === "bar"
          ? { fill: "var(--surface-container-high)", opacity: 0.6 }
          : { stroke: "var(--chart-axis)", strokeWidth: 1 }
      }
      content={(p: TooltipProps) => (
        <ChartTooltip
          {...p}
          series={series}
          colorOf={colorOf}
          valueFormatter={valueFormatter}
          fmtX={fmtX}
        />
      )}
      isAnimationActive={false}
    />
  );

  let plot: React.ReactNode;
  if (type === "bar") {
    plot = (
      <BarChart
        {...common}
        layout={horizontal ? "vertical" : "horizontal"}
        barGap={2}
        barCategoryGap="24%"
      >
        {grid}
        {categoryAxis}
        {valueAxis}
        {tooltip}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={colorOf(s, i)}
            maxBarSize={24}
            stackId={stacked ? "stack" : undefined}
            radius={stacked && i < series.length - 1 ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            stroke="var(--surface)"
            strokeWidth={stacked ? 2 : 0}
            isAnimationActive={motionSafe}
            animationDuration={500}
          />
        ))}
      </BarChart>
    );
  } else if (type === "line") {
    plot = (
      <LineChart {...common}>
        {grid}
        {categoryAxis}
        {valueAxis}
        {tooltip}
        {series.map((s, i) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.label}
            type="monotone"
            stroke={colorOf(s, i)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: colorOf(s, i) }}
            isAnimationActive={motionSafe}
            animationDuration={600}
          />
        ))}
      </LineChart>
    );
  } else {
    plot = (
      <AreaChart {...common}>
        {grid}
        {categoryAxis}
        {valueAxis}
        {tooltip}
        {series.map((s, i) => (
          <Area
            key={s.key}
            dataKey={s.key}
            name={s.label}
            type="monotone"
            stroke={colorOf(s, i)}
            strokeWidth={2}
            fill={colorOf(s, i)}
            fillOpacity={0.1}
            stackId={stacked ? "stack" : undefined}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: colorOf(s, i) }}
            isAnimationActive={motionSafe}
            animationDuration={600}
          />
        ))}
      </AreaChart>
    );
  }

  return (
    <figure
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      className={cn(
        "bg-surface border-border flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading id={headingId} className="text-sm font-medium leading-snug">
            {title}
          </Heading>
          {description ? (
            <p id={descId} className="text-muted-foreground text-[13px]">
              {description}
            </p>
          ) : null}
        </div>
        <SegmentedControl
          aria-label={`${title}: view as`}
          size="sm"
          showCheck={false}
          value={view}
          onValueChange={setView}
          options={[
            {
              value: "chart",
              label: <span className="max-[479.98px]:sr-only">Chart</span>,
              icon: <BarChart3 aria-hidden />,
            },
            {
              value: "table",
              label: <span className="max-[479.98px]:sr-only">Table</span>,
              icon: <Table2 aria-hidden />,
            },
          ]}
          className="shrink-0 self-start"
        />
      </div>

      {series.length > 1 && view === "chart" && !empty && !loading ? (
        <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {series.map((s, i) => (
            <li key={s.key} className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className={cn(
                  "shrink-0",
                  type === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]",
                )}
                style={{ background: colorOf(s, i) }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <Skeleton className="w-full rounded-md" style={{ height: plotHeight }} />
      ) : empty ? (
        <div
          className="text-muted-foreground bg-surface-container-low flex items-center justify-center rounded-md px-4 text-center text-sm"
          style={{ height: plotHeight }}
        >
          {emptyMessage}
        </div>
      ) : view === "chart" ? (
        <div
          className="min-w-0"
          style={{ height: plotHeight }}
          aria-describedby={description ? descId : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            {plot as React.ReactElement}
          </ResponsiveContainer>
        </div>
      ) : (
        <div
          className="scrollbar-thin border-border max-h-80 min-w-0 overflow-auto rounded-md border"
          tabIndex={0}
          role="region"
          aria-label={`${title} data`}
        >
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-surface-container-low text-muted-foreground sticky top-0 text-xs">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {xLabel ?? xKey}
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, r) => (
                <tr key={`${String(row[xKey])}-${r}`} className="border-border border-t">
                  <th scope="row" className="px-3 py-2 font-normal">
                    {fmtX(row[xKey])}
                  </th>
                  {series.map((s) => {
                    const v = row[s.key];
                    return (
                      <td key={s.key} className="px-3 py-2 text-right tabular-nums">
                        {typeof v === "number" ? valueFormatter(v) : "Not available"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footnote ? (
        <figcaption className="text-muted-foreground text-xs">{footnote}</figcaption>
      ) : null}
    </figure>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  colorOf,
  valueFormatter,
  fmtX,
}: TooltipProps & {
  series: ChartSeries[];
  colorOf: (s: ChartSeries, i: number) => string;
  valueFormatter: (v: number) => string;
  fmtX: (v: unknown) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-surface-elevated shadow-2 text-foreground min-w-36 rounded-sm px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1.5">{fmtX(label)}</p>
      <ul className="flex flex-col gap-1">
        {series.map((s, i) => {
          const item = payload.find((p) => p.dataKey === s.key);
          if (!item) return null;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: colorOf(s, i) }}
              />
              <span className="text-foreground font-medium tabular-nums">
                {typeof item.value === "number" ? valueFormatter(item.value) : "Not available"}
              </span>
              <span className="text-muted-foreground truncate">{s.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
