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
  const choices = sites.filter(site => site.siteId !== anchor);
  if (!choices.length && !siteIds) return null;

  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t("Sites in this analysis")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {sites.map(site => (
          <label key={site.siteId} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={site.siteId === anchor || siteIds?.includes(site.siteId) === true}
              disabled={site.siteId === anchor}
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
    </fieldset>
  );
}
