import React from "react";
import { Radio } from "lucide-react";
import type {
  LeadFollowUpHealthRow,
  LeadFollowUpHealthState,
} from "@business-os/core";
import { SalesAttentionQueue } from "./sales-attention-queue";
import { PipelineHygienePanel } from "./pipeline-hygiene-panel";
import { percentage } from "./sales-health-meta";

interface SalesCommandCenterProps {
  rows: LeadFollowUpHealthRow[];
  scopeLabel: string;
}

function countHealth(
  rows: LeadFollowUpHealthRow[],
  health: LeadFollowUpHealthState,
) {
  return rows.filter((row) => row.health === health).length;
}

export function SalesCommandCenter({
  rows,
  scopeLabel,
}: SalesCommandCenterProps) {
  const total = rows.length;
  const overdue = countHealth(rows, "OVERDUE_NEXT_ACTION");
  const noNextAction = countHealth(rows, "NO_NEXT_ACTION");
  const stale = countHealth(rows, "STALE_CONTACT");
  const healthy = countHealth(rows, "HEALTHY");
  const attention = total - healthy;
  const attentionRows = rows.filter((row) => row.health !== "HEALTHY");
  const healthyRate = percentage(healthy, total);

  const breakdown: Array<{
    state: LeadFollowUpHealthState;
    count: number;
  }> = [
    { state: "OVERDUE_NEXT_ACTION", count: overdue },
    { state: "NO_NEXT_ACTION", count: noNextAction },
    { state: "STALE_CONTACT", count: stale },
    { state: "HEALTHY", count: healthy },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-white">
        <div className="grid gap-8 p-6 md:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)] lg:items-end">
          <div>
            <div className="mb-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              <Radio className="h-3.5 w-3.5 text-blue-400" />
              Live sales execution
            </div>
            <p className="max-w-xl text-sm leading-6 text-zinc-300">
              {scopeLabel}. Focus the team on the leads most likely to leak
              before spending time on healthy pipeline.
            </p>
            <div className="mt-7 flex items-end gap-4">
              <div className="text-5xl font-semibold tracking-[-0.055em] text-white md:text-6xl">
                {attention}
              </div>
              <div className="pb-1.5">
                <div className="text-sm font-semibold text-white">
                  leads need attention
                </div>
                <div className="mt-0.5 text-xs text-zinc-400">
                  out of {total} active pipeline leads
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/60">
            <MetricCell value={overdue} label="Overdue" tone="text-rose-300" />
            <MetricCell
              value={noNextAction}
              label="No next action"
              tone="text-amber-300"
            />
            <MetricCell
              value={stale}
              label="Stale contact"
              tone="text-blue-300"
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <SalesAttentionQueue rows={attentionRows} />
        <PipelineHygienePanel
          healthyRate={healthyRate}
          total={total}
          breakdown={breakdown}
        />
      </div>
    </div>
  );
}

function MetricCell({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <div className="px-4 py-4 md:px-5">
      <div className={`text-2xl font-semibold tracking-tight ${tone}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium text-zinc-400">{label}</div>
    </div>
  );
}
