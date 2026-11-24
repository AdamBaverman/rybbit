import type { FilterParams } from "@rybbit/shared";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../../db/postgres/postgres.js";
import { sites } from "../../../db/postgres/schema.js";
import { buildFilteredSessionsCTE } from "./sessionFilters.js";
import { getTimeStatement } from "./timeWindow.js";

export const crossSiteIdsSchema = z
  .array(z.number().int().min(1).max(65535))
  .min(2)
  .max(20)
  .refine(ids => new Set(ids).size === ids.length, "Site IDs must be unique");

export async function canAccessCrossSiteScope(request: FastifyRequest, anchor: number, ids: number[]) {
  if (!ids.includes(anchor)) return false;
  const [site] = await db.select({ organizationId: sites.organizationId }).from(sites).where(eq(sites.siteId, anchor));
  if (!site?.organizationId) return false;
  const organizationId = site.organizationId;
  const { getOrganizationSitesForCaller } = await import("../../../lib/auth-utils.js");
  const accessible = await getOrganizationSitesForCaller(request, organizationId);
  const allowed = new Set(accessible.filter(site => site.organizationId === organizationId).map(site => site.siteId));
  return ids.every(id => allowed.has(id));
}

/** Bound per-request fan-out when saved reports need independent queries. */
export async function mapReportBatches<T, R>(items: T[], evaluate: (item: T) => Promise<R>): Promise<R[]> {
  const batchSize = 4;
  const results: R[] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    results.push(...(await Promise.all(items.slice(start, start + batchSize).map(evaluate))));
  }
  return results;
}

function entrySessionFilter(query: FilterParams<{}>, siteIds: number[]) {
  const time = getTimeStatement(query);
  const filtered = siteIds.flatMap((siteId, index) => {
    const name = `CrossSiteFilter${index}`;
    const cte = buildFilteredSessionsCTE(query.filters, siteId, time, name);
    return cte ? [{ cte, name, siteId }] : [];
  });
  const firstFilter = filtered.length
    ? ` AND (${filtered
        .map(({ name, siteId }) => `(site_id = ${siteId} AND session_id IN (SELECT session_id FROM ${name}))`)
        .join(" OR ")})`
    : "";
  return { time, firstFilter, ctes: filtered.map(({ cte }) => cte + ",").join("\n") };
}

/** The first second in which each prefix is reachable using distinct event rows. */
export function buildCrossSiteSequence(query: FilterParams<{}>, siteIds: number[], conditions: string[]) {
  const { time, firstFilter, ctes } = entrySessionFilter(query, siteIds);
  const matches = conditions.map((condition, i) => (i === 0 ? `((${condition})${firstFilter})` : `(${condition})`));
  const steps = conditions.map((_, i) => `minIf(second, reached >= ${i + 1}) AS step_${i}`);
  // The request bounds the reporting window. RANGE includes all peers in a second,
  // and strict_once prevents a row that matches two predicates from being reused.
  return `WITH ${ctes}
    CrossSiteEvents AS (
      SELECT user_id, toUnixTimestamp(timestamp) AS second,
        windowFunnel(4294967295, 'strict_once')(second, ${matches.join(", ")})
          OVER (PARTITION BY user_id ORDER BY second RANGE UNBOUNDED PRECEDING) AS reached
      FROM events PREWHERE site_id IN {siteIds:Array(UInt16)}
      WHERE user_id != '' ${time} AND (${conditions.map(c => `(${c})`).join(" OR ")})
    ),
    CrossSiteSequence AS (
      SELECT user_id, ${steps.join(", ")} FROM CrossSiteEvents GROUP BY user_id
    )`;
}

export interface CrossSiteDefinition {
  id: number;
  siteIds: number[];
  entry: string;
  target?: string;
}

/** Distinct users per definition and across visible definitions, in one event scan. */
export function buildCrossSiteAudience(query: FilterParams<{}>, definitions: CrossSiteDefinition[]) {
  const siteIds = [...new Set(definitions.flatMap(definition => definition.siteIds))];
  const { time, firstFilter, ctes } = entrySessionFilter(query, siteIds);
  const params: Record<string, unknown> = { siteIds };
  const matches = definitions.map(({ id, siteIds: scope, entry, target }, index) => {
    params[`scope${index}`] = scope;
    const inScope = `site_id IN {scope${index}:Array(UInt16)}`;
    return `(${id}, (${inScope} AND (${entry})${firstFilter}), (${inScope} AND (${target ?? "0"})))`;
  });
  return {
    params,
    query: `WITH ${ctes}
      per_second AS (
        SELECT user_id, m.1 AS definition_id, timestamp AS second,
          countIf(m.2) AS entries, countIf(m.3) AS targets, count() AS matching_rows
        FROM events ARRAY JOIN arrayFilter(x -> x.2 OR x.3, [${matches.join(", ")}]) AS m
        PREWHERE site_id IN {siteIds:Array(UInt16)}
        WHERE user_id != '' ${time}
        GROUP BY definition_id, user_id, second
      ),
      per_user AS (
        SELECT definition_id, user_id,
          minIf(toUnixTimestamp(second), entries > 0) AS first_entry,
          maxIf(toUnixTimestamp(second), targets > 0) AS last_target,
          max(entries > 0 AND targets > 0 AND matching_rows >= 2) AS distinct_tied_rows
        FROM per_second GROUP BY definition_id, user_id HAVING first_entry > 0
      )
      SELECT if(grouping(definition_id) != 0, 0, definition_id) AS report_id,
        uniqExact(user_id) AS entered,
        uniqExactIf(user_id, last_target > first_entry OR (last_target = first_entry AND distinct_tied_rows)) AS converted
      FROM per_user GROUP BY GROUPING SETS ((definition_id), ())`,
  };
}
