import React from "react";
import { Clock3, ContactRound } from "lucide-react";
import type { LeadFollowUpHealthState } from "@business-os/core";
import { HEALTH_META, percentage } from "./sales-health-meta";

interface PipelineHygienePanelProps {
  healthyRate: number;
  total: number;
  breakdown: Array<{
    state: LeadFollowUpHealthState;
    count: number;
  }>;
}

export function PipelineHygienePanel({
  healthyRate,
  total,
  breakdown,
}: PipelineHygienePanelProps) {
  return (
    <aside className="space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Pipeline hygiene
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              Active lead execution quality
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tracking-tight text-ink">
              {healthyRate}%
            </div>
            <div className="text-[10px] uppercase tracking-wide text-ink-faint">
              healthy
            </div>
          </div>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width]"
            style={{ width: `${healthyRate}%` }}
          />
        </div>

        <div className="mt-5 space-y-3">
          {breakdown.map(({ state, count }) => {
            const meta = HEALTH_META[state];
            return (
              <div
                key={state}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                  />
                  <span className="truncate text-xs text-ink-secondary">
                    {meta.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-faint">
                    {percentage(count, total)}%
                  </span>
                  <span className="w-5 text-right text-xs font-semibold text-ink">
                    {count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
          <ContactRound className="h-4 w-4 text-blue-700" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-ink">
          Operating order
        </h3>
        <div className="mt-3 space-y-3 text-xs leading-5 text-ink-muted">
          <Rule index="01" tone="text-rose-700">
            Recover overdue follow-ups before they age further.
          </Rule>
          <Rule index="02" tone="text-amber-700">
            Give every active lead a concrete next action.
          </Rule>
          <Rule index="03" tone="text-blue-700">
            Reconnect with leads that crossed the contact SLA.
          </Rule>
        </div>
      </section>

      <div className="flex items-center gap-2 px-1 text-[11px] text-ink-faint">
        <Clock3 className="h-3.5 w-3.5" />
        Signals update from CRM activity and follow-up tasks.
      </div>
    </aside>
  );
}

function Rule({
  index,
  tone,
  children,
}: {
  index: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className={`font-semibold ${tone}`}>{index}</span>
      <span>{children}</span>
    </div>
  );
}
