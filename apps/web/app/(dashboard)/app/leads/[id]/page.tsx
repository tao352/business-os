import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getLeadWorkspace,
  getLeadMatchedUnits,
  listProjects,
  listLeadInterests,
  listOpportunities,
  can,
} from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { LeadActionsBar } from "@/features/leads/lead-actions-bar";
import { LeadTimeline } from "@/features/leads/lead-timeline";
import { LeadSidePanel } from "@/features/leads/lead-side-panel";
import { LeadInterestCard } from "@/features/real-estate/lead-interest-card";

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
  const canUpdateLead = can(context, "update", "lead", lead);
  const canReassignLead = can(context, "update_all", "lead");
  const canReserveUnit = can(context, "create", "reservation");
  const canCreateOpportunity = can(context, "create", "opportunity");

  // Fetch matched available units, 1:N property interests, and project list for real estate domain
  let matchedUnits: Awaited<ReturnType<typeof getLeadMatchedUnits>> = [];
  let projects: Awaited<ReturnType<typeof listProjects>> = [];
  let interests: Awaited<ReturnType<typeof listLeadInterests>> = [];
  let opportunities: Awaited<ReturnType<typeof listOpportunities>> = [];

  try {
    interests = await listLeadInterests(context, id);
  } catch {
    interests = [];
  }

  try {
    matchedUnits = await getLeadMatchedUnits(context, id);
  } catch {
    matchedUnits = [];
  }

  try {
    projects = await listProjects(context);
  } catch {
    projects = [];
  }

  try {
    opportunities = (await listOpportunities(context, { leadId: id })).filter(
      (opportunity) =>
        opportunity.stage === "DISCOVERY" ||
        opportunity.stage === "PROPOSAL" ||
        opportunity.stage === "NEGOTIATION",
    );
  } catch {
    opportunities = [];
  }

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
          canUpdateLead={canUpdateLead}
          canReassignLead={canReassignLead}
          canCreateOpportunity={canCreateOpportunity}
          leadName={lead.full_name}
        />
      </div>

      {/* Main Command Center Grid: Workspace (68%) + Side Panel (32%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Real Estate Requirements & Matched Inventory + Timeline */}
        <div className="lg:col-span-8 space-y-6">
          {/* Real Estate Requirements & Algorithmically Matched Inventory */}
          <LeadInterestCard
            leadId={lead.id}
            leadName={lead.full_name}
            interests={interests}
            matchedUnits={matchedUnits}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            opportunities={opportunities.map((opportunity) => ({
              id: opportunity.id,
              title: opportunity.title,
              stage: opportunity.stage,
            }))}
            canEdit={canUpdateLead}
            canReserve={canReserveUnit}
          />

          {/* Customer History Timeline */}
          <div className="bg-surface border border-line rounded-xl p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-line">
              <div>
                <h2 className="text-sm font-semibold text-ink">
                  Customer Timeline
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Chronological record of status changes, messages, notes, and
                  reservations.
                </p>
              </div>
              <span className="text-xs text-ink-faint">
                {activities.length}{" "}
                {activities.length === 1 ? "event" : "events"}
              </span>
            </div>

            <LeadTimeline events={activities} />
          </div>
        </div>

        {/* Right: Lead Details & Tasks Side Panel */}
        <div className="lg:col-span-4">
          <LeadSidePanel
            lead={{
              ...lead,
              assigned_name: assignedName,
            }}
            tasks={tasks}
            canCompleteTasks={canUpdateLead}
          />
        </div>
      </div>
    </div>
  );
}
