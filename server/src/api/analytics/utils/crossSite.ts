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

/** One row per device fingerprint. A dashboard filter qualifies the first matching session. */
export function buildCrossSiteSequence(query: FilterParams<{}>, siteIds: number[], conditions: string[]) {
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
  const first = `(${conditions[0]})${firstFilter}`;
  const next = conditions.slice(1);
  return `WITH
    ${filtered.map(({ cte }) => `${cte},`).join("\n")}
    CrossSiteEvents AS (
      SELECT user_id, minIf(toUnixTimestamp(timestamp), ${first}) AS step_0
        ${next.map((condition, index) => `, groupArrayIf(toUnixTimestamp(timestamp), ${condition}) AS events_${index + 1}`).join("\n")}
      FROM events
      PREWHERE site_id IN {siteIds:Array(UInt16)}
      WHERE user_id != '' ${time}
        AND (${conditions.map(condition => `(${condition})`).join(" OR ")})
      GROUP BY user_id
    ),
    CrossSiteSequence AS (
      SELECT user_id, step_0
        ${next.map((_, index) => `, if(step_${index} = 0, 0, arrayMin(arrayFilter(t -> t >= step_${index}, events_${index + 1}))) AS step_${index + 1}`).join("\n")}
      FROM CrossSiteEvents
    )`;
}
