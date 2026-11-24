"use client";

import { ArrowDownRight, Funnel, LogIn, TrendingUp } from "lucide-react";
import { useExtracted } from "next-intl";
import { StatBand, StatBandCell } from "@/components/site/StatBand";
import { percentDelta } from "@/lib/delta";
import {
  biggestDropOff,
  biggestGain,
  countMoves,
  formatRate,
  FunnelRowData,
  highestConversion,
  stepLabel,
} from "./funnelMetrics";
import { useStepTypeLabels } from "./useStepTypeLabels";

export interface FunnelStatBandProps {
  rows: FunnelRowData[];
  crossSiteUsers?: number;
  previousCrossSiteUsers?: number;
  /** Sessions that entered at least one funnel in the selected period. */
  sessionsEntered: number | undefined;
  /** The same for the comparison period. Undefined when the comparison is off or not loaded. */
  previousSessionsEntered: number | undefined;
  /** Whether a comparison period is selected: it decides what the third cell reports. */
  comparisonEnabled: boolean;
  isLoading: boolean;
}

/** How the saved funnels did as a set: how many, how much traffic they see, and the two extremes. */
export function FunnelStatBand({
  rows,
  sessionsEntered,
  crossSiteUsers,
  previousCrossSiteUsers,
  previousSessionsEntered,
  comparisonEnabled,
  isLoading,
}: FunnelStatBandProps) {
  const t = useExtracted();
  const typeLabels = useStepTypeLabels();

  const nameOf = (row: FunnelRowData, index: number) => {
    const step = row.funnel.steps[index];
    return stepLabel(step, typeLabels[step.type] ?? typeLabels.event);
  };

  // Without figures (the summary failed) or without the comparison's, a cell
  // says nothing rather than "none" or zero.
  const hasFigures = sessionsEntered !== undefined;
  const hasComparison = hasFigures && previousSessionsEntered !== undefined;

  const moves = countMoves(rows);
  const withSessions = rows.filter(row => (row.current?.entered ?? 0) > 0).length;

  const gain = biggestGain(rows);
  const best = highestConversion(rows);
  const thirdCell: StatBandCell = comparisonEnabled
    ? {
        id: "gain",
        icon: <TrendingUp className="h-3 w-3" />,
        label: t("Biggest gain"),
        value: gain ? gain.row.funnel.name : hasComparison ? t("None") : "—",
        title: gain?.row.funnel.name,
        delta: gain?.delta,
        sub: gain
          ? t("{from} to {to} conversion", {
              from: formatRate(gain.row.previous!.conversion!),
              to: formatRate(gain.row.current!.conversion!),
            })
          : hasComparison
            ? t("No funnel converts better than before")
            : "",
      }
    : {
        id: "gain",
        icon: <TrendingUp className="h-3 w-3" />,
        label: t("Highest conversion"),
        value: best ? best.funnel.name : "—",
        title: best?.funnel.name,
        sub: best
          ? best.funnel.siteIds
            ? t("{rate} of {count} users convert", {
                rate: formatRate(best.current!.conversion!),
                count: best.current!.entered.toLocaleString(),
              })
            : t("{rate} of {count} sessions convert", {
                rate: formatRate(best.current!.conversion!),
                count: best.current!.entered.toLocaleString(),
              })
          : "",
      };

  const leak = biggestDropOff(rows);
  const leakText = leak
    ? t("{from} to {to}, in {funnel}", {
        from: nameOf(leak.row, leak.stepIndex),
        to: nameOf(leak.row, leak.stepIndex + 1),
        funnel: leak.row.funnel.name,
      })
    : null;

  const hasCross = rows.some(row => row.funnel.siteIds);
  const cells: (StatBandCell | false)[] = [
    {
      icon: <Funnel className="h-3 w-3" />,
      label: t("Funnels tracked"),
      value: rows.length.toLocaleString(),
      // The count is known before any numbers are.
      isLoading: false,
      sub:
        isLoading || !hasFigures || (comparisonEnabled && !hasComparison)
          ? ""
          : comparisonEnabled
            ? t("{improved} improved, {declined} declined", {
                improved: String(moves.improved),
                declined: String(moves.declined),
              })
            : t("{count} with entries in this period", { count: String(withSessions) }),
    },
    (!hasCross || rows.some(row => !row.funnel.siteIds)) && {
      icon: <LogIn className="h-3 w-3" />,
      label: hasCross ? t("Sessions entering single-site funnels") : t("Sessions entering any funnel"),
      // No figure is not zero: the summary may have failed to load.
      value: sessionsEntered === undefined ? "—" : sessionsEntered.toLocaleString(),
      delta: percentDelta(sessionsEntered, previousSessionsEntered),
      sub:
        previousSessionsEntered === undefined
          ? ""
          : t("{count} in the comparison period", { count: previousSessionsEntered.toLocaleString() }),
    },
    hasCross && {
      icon: <LogIn className="h-3 w-3" />,
      label: t("Users entering cross-site funnels"),
      value: crossSiteUsers?.toLocaleString() ?? "—",
      delta: percentDelta(crossSiteUsers, previousCrossSiteUsers),
    },
    thirdCell,
    {
      icon: <ArrowDownRight className="h-3 w-3" />,
      label: t("Biggest drop-off"),
      value: leak ? formatRate(leak.rate) : "—",
      // The sentence is long for a narrow cell; the hover text keeps it whole.
      sub: leakText ? (
        <span title={leakText}>{leakText}</span>
      ) : hasFigures ? (
        hasCross ? (
          t("No drop-off between steps")
        ) : (
          t("No sessions lost between steps")
        )
      ) : (
        ""
      ),
    },
  ];

  return <StatBand cells={cells} isLoading={isLoading} columns={4} />;
}
