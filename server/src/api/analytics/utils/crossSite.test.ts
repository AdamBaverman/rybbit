import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const { findAnchor, accessibleSites } = vi.hoisted(() => ({
  findAnchor: vi.fn(),
  accessibleSites: vi.fn(),
}));
vi.mock("../../../db/postgres/postgres.js", () => ({
  db: { select: () => ({ from: () => ({ where: findAnchor }) }) },
}));
vi.mock("../../../lib/auth-utils.js", () => ({ getOrganizationSitesForCaller: accessibleSites }));

import { buildCrossSiteSequence, canAccessCrossSiteScope, crossSiteIdsSchema } from "./crossSite.js";

describe("cross-site analytics scope", () => {
  const request = {} as FastifyRequest;

  beforeEach(() => {
    findAnchor.mockResolvedValue([{ organizationId: "org-1" }]);
    accessibleSites.mockResolvedValue([
      { siteId: 3, organizationId: "org-1" },
      { siteId: 4, organizationId: "org-1" },
      { siteId: 5, organizationId: "org-2" },
    ]);
  });

  it("requires a distinct and explicit set of sites", () => {
    expect(crossSiteIdsSchema.safeParse([3, 4]).success).toBe(true);
    for (const scope of [[], [3], [3, 3], [3, "4"]]) {
      expect(crossSiteIdsSchema.safeParse(scope).success).toBe(false);
    }
  });

  it("requires the anchor and fresh access to every selected site in its organization", async () => {
    await expect(canAccessCrossSiteScope(request, 3, [3, 4])).resolves.toBe(true);
    expect(accessibleSites).toHaveBeenCalledWith(request, "org-1");
    await expect(canAccessCrossSiteScope(request, 3, [4, 5])).resolves.toBe(false);
    await expect(canAccessCrossSiteScope(request, 3, [3, 5])).resolves.toBe(false);
    accessibleSites.mockResolvedValueOnce([{ siteId: 3, organizationId: "org-1" }]);
    await expect(canAccessCrossSiteScope(request, 3, [3, 4])).resolves.toBe(false);
  });

  it("restricts the event scan and accepts adjacent steps in the same second", () => {
    const query = buildCrossSiteSequence(
      { start_date: "", end_date: "", time_zone: "UTC", filters: "" },
      [3, 4],
      ["event_name = 'entry'", "event_name = 'payment'"]
    );
    expect(query).toContain("PREWHERE site_id IN {siteIds:Array(UInt16)}");
    expect(query).toContain("GROUP BY user_id");
    expect(query).toContain("t -> t >= step_0");
  });
});
