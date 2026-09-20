import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getLeadWorkspace } from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { LeadActionsBar } from "@/features/leads/lead-actions-bar";
import { LeadTimeline } from "@/features/leads/lead-timeline";
import { LeadSidePanel } from "@/features/leads/lead-side-panel";

interface LeadDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const context = await requireTenantContext();
  const { id } = await params;

  let workspace: Awaited<ReturnType<typeof getLeadWorkspace>>;
  try {
    workspace = await getLeadWorkspace(context, id);
  } catch {
    notFound();
  }

  const { lead, assignedName, activities, tasks, members } = workspace;

  return (
    <div className="space-y-6">
      {/* Back to Leads Navigation */}
      <div>
        <Link
          href="/app/leads"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Leads
        </Link>
      </div>

      {/* Lead Header Card */}
      <div className="bg-surface border border-line rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink tracking-tight">
              {lead.contact_info_redacted
                ? "[CONFIDENTIAL CLIENT]"
                : lead.full_name}
            </h1>
            <Badge status={lead.status}>{lead.status}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-secondary mt-1.5">
            <span className="font-mono">
              {lead.contact_info_redacted ? "[REDACTED]" : lead.phone}
            </span>
            {!lead.contact_info_redacted && lead.email && (
              <span>• {lead.email}</span>
            )}
            <span>• Source: {lead.source}</span>
            {assignedName && <span>• Assigned: {assignedName}</span>}
          </div>
        </div>

        {/* Quick Action Toolbar */}
        <LeadActionsBar
          leadId={lead.id}
          currentStatus={lead.status}
          currentAssigneeId={lead.assigned_user_id}
          userRole={context.role}
          members={members}
        />
      </div>

      {/* Main Command Center Grid: Workspace (68%) + Side Panel (32%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Customer History Timeline */}
        <div className="lg:col-span-8 bg-surface border border-line rounded-xl p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-line">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Customer Timeline
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Chronological record of status changes, messages, and notes.
              </p>
            </div>
            <span className="text-xs text-ink-faint">
              {activities.length} {activities.length === 1 ? "event" : "events"}
            </span>
          </div>

          <LeadTimeline events={activities} />
        </div>

        {/* Right: Lead Details & Tasks Side Panel */}
        <div className="lg:col-span-4">
          <LeadSidePanel
            lead={{
              ...lead,
              assigned_name: assignedName,
            }}
            tasks={tasks}
          />
        </div>
      </div>
    </div>
  );
}
