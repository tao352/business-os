import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ListTodo,
} from "lucide-react";
import type { LeadFollowUpHealthRow } from "@business-os/core";
import { Badge } from "@/components/ui/badge";
import { HEALTH_META, getAttentionCopy } from "./sales-health-meta";

export function SalesAttentionQueue({
  rows,
}: {
  rows: LeadFollowUpHealthRow[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-5 sm:flex-row sm:items-end sm:justify-between md:px-6">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-ink">Priority queue</h2>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Ordered by execution risk. Fix overdue actions first, then
            unplanned leads.
          </p>
        </div>
        <div className="text-xs font-medium text-ink-muted">
          {rows.length} requiring action
        </div>
      </div>

      {rows.length === 0 ? (
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
          {rows.map((row) => {
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
                    <span>{row.assignedName || "Unassigned salesperson"}</span>
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
  );
}
