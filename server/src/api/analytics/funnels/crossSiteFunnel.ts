import type { FilterParams } from "@rybbit/shared";
import { buildCrossSiteSequence } from "../utils/crossSite.js";
import { runAnalyticsQuery } from "../utils/analyticsQuery.js";
import { buildFunnelStepCondition, type FunnelStep } from "./funnelSteps.js";

export async function analyzeCrossSiteFunnel(query: FilterParams<{}>, siteIds: number[], steps: FunnelStep[]) {
  const conditions = steps.map(step => {
    const condition = buildFunnelStepCondition(step);
    if (step.siteId === undefined) return condition;
    return siteIds.includes(step.siteId) ? `${condition} AND site_id = ${step.siteId}` : "0";
  });
  const last = steps.length - 1;
  const aggregates = steps.flatMap((_, index) => [
    `countIf(step_${index} > 0) AS reached_${index}`,
    ...(index < last
      ? [`quantileIf(0.5)(toInt64(step_${index + 1}) - step_${index}, step_${index + 1} > 0) AS median_${index}`]
      : []),
  ]);
  const [row] = await runAnalyticsQuery<Record<string, number | null>>({
    query: `${buildCrossSiteSequence(query, siteIds, conditions)}
      SELECT ${aggregates.join(", ")},
        quantileIf(0.5)(toInt64(step_${last}) - step_0, step_${last} > 0) AS median_total
      FROM CrossSiteSequence`,
    params: { siteIds },
  });
  const median = (key: string) => (Number.isFinite(row?.[key]) ? Number(row[key]) : null);
  const reached = (index: number) => Number(row?.[`reached_${index}`]) || 0;
  return {
    steps: steps.map((step, index) => {
      const users = reached(index);
      const previous = index > 0 ? reached(index - 1) : 0;
      return {
        step_number: index + 1,
        step_name: step.name || step.value,
        sessions: users,
        visitors: users,
        users,
        conversion_rate: reached(0) ? Math.round((users / reached(0)) * 10000) / 100 : 0,
        dropoff_rate: previous ? Math.round((1 - users / previous) * 10000) / 100 : 0,
        median_seconds_to_next: median(`median_${index}`),
      };
    }),
    median_seconds_to_convert: median("median_total"),
  };
}
