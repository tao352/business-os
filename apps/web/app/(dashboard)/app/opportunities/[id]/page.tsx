import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";
import { can, getOpportunityWorkspace } from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { OpportunityActionsBar } from "@/features/opportunities/opportunity-actions-bar";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/formatters";

interface OpportunityDetailPageProps {
  params: Promise<{ id: string }>;
}

function formatTransitionSource(source: string): string {
  switch (source) {
    case "opportunity_created":
      return "Opportunity created";
    case "reservation_created":
      return "Reservation created";
    case "contract_executed":
      return "Contract executed";
    case "opportunity_reopened":
      return "Opportunity reopened";
    case "manual":
      return "Manual sales update";
    case "r13c_baseline":
      return "R1.3C baseline";
    default:
      return source.replace(/_/g, " ");
  }
}

export default async function OpportunityDetailPage({
  params,
}: OpportunityDetailPageProps) {
  const context = await requireTenantContext();
  const { id } = await params;

  let workspace: Awaited<ReturnType<typeof getOpportunityWorkspace>>;
  try {
    workspace = await getOpportunityWorkspace(context, id);
  } catch {
    notFound();
  }

  const { opportunity, history } = workspace;
  const canUpdateOpportunity = can(
    context,
    "update",
    "opportunity",
    opportunity,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/app/opportunities"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Opportunities
        </Link>
      </div>

      <div className="bg-surface border border-line rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-ink tracking-tight truncate">
              {opportunity.title}
            </h1>
            <Badge status={opportunity.stage}>{opportunity.stage}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-secondary mt-1.5">
            <span className="font-semibold text-ink">
              {formatCurrency(Number(opportunity.value), opportunity.currency)}
            </span>
            <span>• Customer: {opportunity.lead_name}</span>
            {opportunity.assignee_name && (
              <span>• Assigned: {opportunity.assignee_name}</span>
            )}
          </div>
        </div>

        <OpportunityActionsBar
          opportunityId={opportunity.id}
          currentStage={opportunity.stage}
          canUpdate={canUpdateOpportunity}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-surface border border-line rounded-xl p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-line">
              <div>
                <h2 className="text-sm font-semibold text-ink">
                  Opportunity Stage History
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Immutable commercial lifecycle history for this deal.
                </p>
              </div>
              <span className="text-xs text-ink-faint">
                {history.length} {history.length === 1 ? "event" : "events"}
              </span>
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-ink-muted py-4">
                No stage history recorded yet.
              </p>
            ) : (
              <div className="space-y-0">
                {history.map((event, index) => (
                  <div
                    key={event.id}
                    className="relative flex gap-4 pb-5 last:pb-0"
                  >
                    {index < history.length - 1 && (
                      <div className="absolute left-[5px] top-3 bottom-0 w-px bg-line" />
                    )}
                    <div className="relative z-10 mt-1.5 w-2.5 h-2.5 rounded-full bg-accent ring-4 ring-surface shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {event.from_stage ? (
                          <>
                            <Badge status={event.from_stage}>
                              {event.from_stage}
                            </Badge>
                            <span className="text-[11px] text-ink-faint">→</span>
                          </>
                        ) : null}
                        <Badge status={event.to_stage}>{event.to_stage}</Badge>
                        <span className="text-[11px] text-ink-muted">
                          {formatTransitionSource(event.transition_source)}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-faint mt-1">
                        {formatDateTime(event.created_at)}
                        {event.changed_by_name
                          ? ` • ${event.changed_by_name}`
                          : ""}
                      </div>
                      {event.reason_code && (
                        <div className="mt-2 text-xs text-ink-secondary bg-surface-subtle border border-line-subtle rounded-md p-2.5">
                          <span className="font-semibold">Reason:</span>{" "}
                          {event.reason_code.replace(/_/g, " ")}
                          {event.reason_notes && (
                            <span> — {event.reason_notes}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface border border-line rounded-xl p-5 text-xs">
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-4">
              Deal Details
            </h3>
            <dl className="space-y-3">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Stage</dt>
                <dd>
                  <Badge status={opportunity.stage}>{opportunity.stage}</Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Value</dt>
                <dd className="font-semibold text-ink text-right">
                  {formatCurrency(
                    Number(opportunity.value),
                    opportunity.currency,
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Expected Close</dt>
                <dd className="font-medium text-ink">
                  {formatDate(opportunity.expected_close_date)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Stage Entered</dt>
                <dd className="font-medium text-ink">
                  {formatDate(opportunity.stage_entered_at)}
                </dd>
              </div>
              {opportunity.closed_at && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Closed</dt>
                  <dd className="font-medium text-ink">
                    {formatDate(opportunity.closed_at)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="bg-surface border border-line rounded-xl p-5 text-xs">
            <div className="flex items-center gap-2 mb-4">
              <UserRound className="w-4 h-4 text-accent" />
              <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                Customer
              </h3>
            </div>
            <div className="font-semibold text-ink text-sm">
              {opportunity.lead_name}
            </div>
            <div className="font-mono text-ink-muted mt-1">
              {opportunity.lead_phone}
            </div>
            <div className="text-ink-muted mt-1">
              Source: {opportunity.lead_source}
            </div>
            <Link
              href={`/app/leads/${opportunity.lead_id}`}
              className="inline-flex mt-4 text-xs font-semibold text-accent hover:underline"
            >
              Open customer workspace
            </Link>
          </div>

          {opportunity.stage === "LOST" && opportunity.lost_reason_code && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 text-xs">
              <h3 className="font-semibold text-rose-800 mb-2">
                Loss Context
              </h3>
              <div className="text-rose-800">
                {opportunity.lost_reason_code.replace(/_/g, " ")}
              </div>
              {opportunity.lost_reason_notes && (
                <p className="text-rose-700 mt-1.5">
                  {opportunity.lost_reason_notes}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
