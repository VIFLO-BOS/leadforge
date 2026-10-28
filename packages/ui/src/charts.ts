/**
 * Charts entry point. Kept out of the main barrel so recharts only ships on pages that import
 * "@leadforge/ui/charts".
 */
export {
  Chart,
  CHART_COLORS,
  type ChartProps,
  type ChartRow,
  type ChartSeries,
} from "./components/chart";
