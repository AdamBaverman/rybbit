"use client";

import { useExtracted } from "next-intl";
import { useGetSite, useGetSitesFromOrg } from "@/api/admin/hooks/useSites";
import { useStore } from "@/lib/store";

export function useAnalyticsScopeSites() {
  const anchor = Number(useStore(state => state.site));
  const { data: site } = useGetSite(anchor);
  const { data } = useGetSitesFromOrg(site?.organizationId ?? undefined);
  return { anchor, sites: data?.sites ?? [] };
}

export function AnalyticsSiteScope({
  siteIds,
  onChange,
}: {
  siteIds?: number[];
  onChange: (siteIds: number[] | undefined) => void;
}) {
  const t = useExtracted();
  const { anchor, sites } = useAnalyticsScopeSites();
  const current = sites.find(site => site.siteId === anchor);
  const choices = sites.filter(site => site.siteId !== anchor);
  if (!choices.length && !siteIds) return null;

  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t("Additional sites")}</legend>
      <p className="text-sm">
        {t("Current site: {site}", { site: current?.name || current?.domain || String(anchor) })}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {choices.map(site => (
          <label key={site.siteId} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={siteIds?.includes(site.siteId) === true}
              disabled={!!siteIds && siteIds.length >= 20 && !siteIds.includes(site.siteId)}
              onChange={event => {
                const selected = siteIds ?? [anchor];
                const next = event.target.checked
                  ? [...selected, site.siteId]
                  : selected.filter(id => id !== site.siteId);
                onChange(next.length > 1 ? next.sort((a, b) => a - b) : undefined);
              }}
            />
            {site.name || site.domain}
          </label>
        ))}
      </div>
      {siteIds && (
        <p className="text-xs text-muted-foreground">
          {t("Cross-site analysis counts users across the selected sites.")}
        </p>
      )}
      {siteIds && sites.some(site => siteIds.includes(site.siteId) && site.saltUserIds) && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {t("A selected site rotates user identifiers. Cross-site conversions may be undercounted.")}
        </p>
      )}
    </fieldset>
  );
}
