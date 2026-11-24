import type { FilterParams } from "@rybbit/shared";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { goals } from "../../../db/postgres/schema.js";
import { runAnalyticsQuery } from "../utils/analyticsQuery.js";
import { buildCrossSiteSequence, canAccessCrossSiteScope, crossSiteIdsSchema } from "../utils/crossSite.js";
import { buildPageCondition } from "../utils/eventConditions.js";
import { TimeBucketToFn } from "../utils/timeWindow.js";
import { buildGoalCondition } from "./goalConditions.js";

export const crossSiteGoalSchema = z
  .object({
    siteIds: crossSiteIdsSchema,
    entrySiteId: z.number().int().optional(),
    entryPath: z.string().trim().min(1).max(512).default("/"),
    utmSource: z.string().trim().min(1).max(512).optional(),
    conversionSiteId: z.number().int().optional(),
  })
  .refine(
    ({ siteIds, entrySiteId, conversionSiteId }) =>
      [entrySiteId, conversionSiteId].every(id => id === undefined || siteIds.includes(id)),
    "Entry and conversion sites must belong to the selected sites"
  );

export type CrossSiteGoal = z.infer<typeof crossSiteGoalSchema>;
type SiteGoal = typeof goals.$inferSelect;

export async function visibleGoals<T extends Pick<SiteGoal, "config">>(
  req: FastifyRequest,
  anchor: number,
  goals: T[]
) {
  const visible = await Promise.all(
    goals.map(
      async goal =>
        !goal.config.crossSite || (await canAccessCrossSiteScope(req, anchor, goal.config.crossSite.siteIds))
    )
  );
  return goals.filter((_, index) => visible[index]);
}

export async function evaluateCrossSiteGoal(
  query: FilterParams<{ bucket?: keyof typeof TimeBucketToFn }>,
  goal: Pick<SiteGoal, "config" | "goalType">,
  series = false
) {
  const { crossSite, ...config } = goal.config;
  if (!crossSite) return { total_sessions: 0, conversions: 0, conversion_rate: 0, series: [] };
  const conversion = buildGoalCondition({ goalType: goal.goalType, config });
  if (!conversion) return { total_sessions: 0, conversions: 0, conversion_rate: 0, series: [] };
  const siteCondition = (siteId?: number) =>
    siteId !== undefined && crossSite.siteIds.includes(siteId) ? ` AND site_id = ${siteId}` : "";
  const entry = buildPageCondition(
    crossSite.entryPath,
    crossSite.utmSource ? [{ key: "utm_source", value: crossSite.utmSource }] : []
  );
  const sequence = buildCrossSiteSequence(query, crossSite.siteIds, [
    `(${entry})${siteCondition(crossSite.entrySiteId)}`,
    `(${conversion})${siteCondition(crossSite.conversionSiteId)}`,
  ]);
  const bucket = TimeBucketToFn[query.bucket ?? "hour"];
  const params = { siteIds: crossSite.siteIds, timeZone: query.time_zone || "UTC" };
  const rows = await runAnalyticsQuery<{ time: string; total_sessions: number; conversions: number }>({
    query: `${sequence}
      SELECT ${series ? `toDateTime(${bucket}(toDateTime(step_0, {timeZone:String}))) AS time,` : ""}
        countIf(step_0 > 0) AS total_sessions, countIf(step_1 > 0) AS conversions
      FROM CrossSiteSequence WHERE step_0 > 0 ${series ? "GROUP BY time ORDER BY time" : ""}`,
    params,
  });
  const points = rows.map(row => {
    const total_sessions = Number(row.total_sessions);
    const conversions = Number(row.conversions);
    return {
      time: row.time,
      total_sessions,
      conversions,
      conversion_rate: total_sessions ? conversions / total_sessions : 0,
    };
  });
  const total_sessions = points.reduce((total, point) => total + point.total_sessions, 0);
  const conversions = points.reduce((total, point) => total + point.conversions, 0);
  return {
    total_sessions,
    conversions,
    conversion_rate: total_sessions ? conversions / total_sessions : 0,
    series: series ? points : [],
  };
}
