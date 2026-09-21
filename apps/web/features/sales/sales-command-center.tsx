import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ContactRound,
  ListTodo,
  Radio,
} from "lucide-react";
import type {
  LeadFollowUpHealthRow,
  LeadFollowUpHealthState,
} from "@business-os/core";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatters";

interface SalesCommandCenterProps {
  rows: LeadFollowUpHealthRow[];
  scopeLabel: string;
}

const HEALTH_META: Record<
  LeadFollowUpHealthState,
  {
    label: string;
    shortLabel: string;
    description: string;
    dot: string;
    text: string;
    surface: string;
    border: string;
  }
> = {
  OVERDUE_NEXT_ACTION: {
    label: "Overdue next action",
    shortLabel: "Overdue",
    description: "A scheduled follow-up has already passed its deadline.",
    dot: "bg-rose-500",
    text: "text-rose-700",
    surface: "bg-rose-50",
    border: "border-rose-200",
  },
  NO_NEXT_ACTION: {
    label: "No next action",
    shortLabel: "Unplanned",
    description: "The lead has no open follow-up task on the calendar.",
    dot: "bg-amber-500",
    text: "text-amber-800",
    surface: "bg-amber-50",
    border: "border-amber-200",
  },
  STALE_CONTACT: {
    label: "Stale contact",
    shortLabel: "Stale",
    description: "Customer contact is older than the configured SLA window.",
    dot: "bg-blue-500",
    text: "text-blue-700",
    surface: "bg-blue-50",
    border: "border-blue-200",
  },
  HEALTHY: {
    label: "Healthy",
    shortLabel: "Healthy",
    description: "The lead has a future next action and recent contact.",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    surface: "bg-emerald-50",
    border: "border-emerald-200",
  },
};

function countHealth(rows: LeadFollowUpHealthRow[], health: LeadFollowUpHealthState) {
  return rows.filter((row) => row.health === health).length;
}

function percentage(value: number, total: number) {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

function getAttentionCopy(row: LeadFollowUpHealthRow) {
  switch (row.health) {
    case "OVERDUE_NEXT_ACTION":
      return row.nextActionAt
        ? `Due ${formatDateTime(row.nextActionAt)}`
        : "Follow-up overdue";
    case "NO_NEXT_ACTION":
      return "Schedule the next customer action";
    case "STALE_CONTACT":
      return row.lastContactedAt
        ? `Last contact ${formatDateTime(row.lastContactedAt)}`
        : "Customer has not been contacted yet";
    case "HEALTHY":
      return row.nextActionAt
        ? `Next action ${formatDateTime(row.nextActionAt)}`
        : "Execution on track";
  }
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
            <div className="px-4 py-4 md:px-5">
              <div className="text-2xl font-semibold tracking-tight text-rose-300">
                {overdue}
              </div>
              <div className="mt-1 text-[11px] font-medium text-zinc-400">
                Overdue
              </div>
            </div>
            <div className="px-4 py-4 md:px-5">
              <div className="text-2xl font-semibold tracking-tight text-amber-300">
                {noNextAction}
              </div>
              <div className="mt-1 text-[11px] font-medium text-zinc-400">
                No next action
              </div>
            </div>
            <div className="px-4 py-4 md:px-5">
              <div className="text-2xl font-semibold tracking-tight text-blue-300">
                {stale}
              </div>
              <div className="mt-1 text-[11px] font-medium text-zinc-400">
                Stale contact
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex flex-col gap-3 border-b border-line px-5 py-5 sm:flex-row sm:items-end sm:justify-between md:px-6">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h2 className="text-sm font-semibold text-ink">
                  Priority queue
                </h2>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Ordered by execution risk. Fix overdue actions first, then
                unplanned leads.
              </p>
            </div>
            <div className="text-xs font-medium text-ink-muted">
              {attentionRows.length} requiring action
            </div>
          </div>

          {attentionRows.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <h3 className="text-sm font-semibold text-ink">
                Pipeline is under control
              </h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-ink-muted">
                Every active lead currently has a healthy execution signal.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line-subtle">
              {attentionRows.map((row) => {
                const meta = HEALTH_META[row.health];

                return (
                  <Link
                    key={row.leadId}
                    href={`/app/leads/${row.leadId}`}
                    className="group grid gap-4 px-5 py-4 transition-colors hover:bg-surface-subtle md:px-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(180px,0.8fr)_minmax(190px,0.95fr)_32px] lg:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                        <span className="truncate text-sm font-semibold text-ink">
                          {row.fullName}
                        </span>
                        <Badge status={row.status}>{row.status}</Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[11px] text-ink-muted">
                        <span>{row.source || "MANUAL"}</span>
                        <span className="text-ink-faint">•</span>
                        <span>
                          {row.assignedName || "Unassigned salesperson"}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${meta.surface} ${meta.border} ${meta.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.shortLabel}
                      </div>
                      <div className="mt-1.5 text-[11px] leading-4 text-ink-muted">
                        {getAttentionCopy(row)}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                        <ListTodo className="h-3 w-3" />
                        Next action
                      </div>
                      <div className="mt-1 truncate text-xs font-medium text-ink-secondary">
                        {row.nextActionTitle || "No action scheduled"}
                      </div>
                    </div>

                    <ArrowUpRight className="hidden h-4 w-4 text-ink-faint transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent lg:block" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

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
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
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
              <div className="flex gap-2.5">
                <span className="font-semibold text-rose-700">01</span>
                <span>Recover overdue follow-ups before they age further.</span>
              </div>
              <div className="flex gap-2.5">
                <span className="font-semibold text-amber-700">02</span>
                <span>Give every active lead a concrete next action.</span>
              </div>
              <div className="flex gap-2.5">
                <span className="font-semibold text-blue-700">03</span>
                <span>Reconnect with leads that crossed the contact SLA.</span>
              </div>
            </div>
          </section>

          <div className="flex items-center gap-2 px-1 text-[11px] text-ink-faint">
            <Clock3 className="h-3.5 w-3.5" />
            Signals update from CRM activity and follow-up tasks.
          </div>
        </aside>
      </div>
    </div>
  );
}
