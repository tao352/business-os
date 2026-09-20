import React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { withTenantContext } from "@business-os/database";
import { listLeads, listTasks } from "@business-os/core";
import { requireTenantContext, getSessionUser } from "@/lib/auth";
import { StatCard } from "@/features/dashboard/dashboard-kpis";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { completeTaskAction } from "@/lib/actions/lead-actions";

export default async function DashboardPage() {
  const context = await requireTenantContext();
  const session = await getSessionUser();

  // 1. Fetch real operational KPIs within tenant context
  const stats = await withTenantContext(context.organizationId, async (tx) => {
    const isSalesperson = context.role === "SALESPERSON";
    const leadFilter = isSalesperson ? "WHERE assigned_user_id = $1" : "";
    const taskFilter = isSalesperson
      ? "WHERE assigned_user_id = $1"
      : "WHERE 1=1";
    const params = isSalesperson ? [context.userId] : [];

    const leadCounts = await tx.query(
      `SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE status = 'NEW') as new_leads
       FROM leads ${leadFilter}`,
      params,
    );

    const taskCounts = await tx.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_completed = false) as open_tasks,
        COUNT(*) FILTER (WHERE is_completed = false AND due_date <= NOW()) as due_followups
       FROM tasks ${taskFilter}`,
      params,
    );

    const activitiesRes = await tx.query(
      `SELECT a.id, a.lead_id, a.user_id, u.full_name as author_name,
              l.full_name as lead_name, a.activity_type, a.summary, a.created_at
       FROM activities a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN leads l ON l.id = a.lead_id
       ORDER BY a.created_at DESC
       LIMIT 6`,
    );

    return {
      totalLeads: parseInt(leadCounts.rows[0]?.total_leads || "0", 10),
      newLeads: parseInt(leadCounts.rows[0]?.new_leads || "0", 10),
      openTasks: parseInt(taskCounts.rows[0]?.open_tasks || "0", 10),
      dueFollowups: parseInt(taskCounts.rows[0]?.due_followups || "0", 10),
      recentActivities: activitiesRes.rows,
    };
  });

  // 2. Fetch Recent Leads and Open Tasks
  const recentLeads = await listLeads(context, { limit: 5 });
  const openTasks = await listTasks(context, { isCompleted: false });
  const dueTasks = openTasks.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-ink tracking-tight">
          Business Overview
        </h1>
        <p className="text-xs text-ink-muted mt-1">
          Operational summary for{" "}
          {session?.activeOrganization.name || "workspace"}
        </p>
      </div>

      {/* Row 1: KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Leads" value={stats.totalLeads} />
        <StatCard label="New Leads" value={stats.newLeads} />
        <StatCard
          label="Follow-ups Due"
          value={stats.dueFollowups}
          subtext={stats.dueFollowups > 0 ? "Requires action today" : undefined}
        />
        <StatCard label="Open Tasks" value={stats.openTasks} />
      </div>

      {/* Row 2: Recent Leads & Follow-ups Due */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Leads */}
        <div className="bg-surface border border-line rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Recent Leads</h2>
            <Link
              href="/app/leads"
              className="text-xs font-medium text-accent hover:text-accent-hover flex items-center gap-1"
            >
              View all
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
              <p className="text-xs text-ink-muted">No leads recorded yet.</p>
              <Link
                href="/app/leads"
                className="mt-2 text-xs font-medium text-accent hover:underline"
              >
                Create your first lead
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-line-subtle -mx-5 px-5">
              {recentLeads.map((lead: any) => (
                <Link
                  key={lead.id}
                  href={`/app/leads/${lead.id}`}
                  className="py-3 flex items-center justify-between hover:bg-surface-subtle -mx-2 px-2 rounded-md transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-xs font-medium text-ink truncate">
                      {lead.full_name}
                    </div>
                    <div className="text-[11px] text-ink-faint truncate mt-0.5">
                      {lead.phone} • {formatDate(lead.created_at)}
                    </div>
                  </div>
                  <Badge status={lead.status}>{lead.status}</Badge>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Follow-ups Due */}
        <div className="bg-surface border border-line rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Follow-ups Due</h2>
            <span className="text-xs text-ink-muted">
              {dueTasks.length} open
            </span>
          </div>

          {dueTasks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 mb-1.5" />
              <p className="text-xs text-ink-muted">
                All follow-ups completed.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line-subtle -mx-5 px-5">
              {dueTasks.map((task: any) => (
                <div
                  key={task.id}
                  className="py-3 flex items-center justify-between"
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-xs font-medium text-ink truncate">
                      {task.title}
                    </div>
                    <div className="text-[11px] text-ink-faint flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-ink-faint shrink-0" />
                      <span>Due {formatDate(task.due_date)}</span>
                      {task.assignee_name && (
                        <span>• {task.assignee_name}</span>
                      )}
                    </div>
                  </div>
                  <form
                    action={async () => {
                      "use server";
                      await completeTaskAction(task.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="px-2.5 py-1 text-[11px] font-medium border border-line rounded bg-surface hover:bg-surface-subtle text-ink transition-colors"
                    >
                      Complete
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Recent Activity */}
      <div className="bg-surface border border-line rounded-xl p-5">
        <h2 className="text-sm font-semibold text-ink mb-4">Recent Activity</h2>
        {stats.recentActivities.length === 0 ? (
          <p className="text-xs text-ink-muted py-4">
            No recent activity recorded.
          </p>
        ) : (
          <div className="space-y-3">
            {stats.recentActivities.map((act: any) => (
              <div
                key={act.id}
                className="flex items-start gap-3 text-xs pb-3 border-b border-line-subtle last:border-0 last:pb-0"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-ink font-medium">
                    {act.author_name}
                    {act.lead_name && (
                      <span className="text-ink-muted font-normal">
                        {" "}
                        on{" "}
                        <Link
                          href={`/app/leads/${act.lead_id}`}
                          className="text-accent hover:underline font-medium"
                        >
                          {act.lead_name}
                        </Link>
                      </span>
                    )}
                  </div>
                  <p className="text-ink-secondary text-xs mt-0.5">
                    {act.summary}
                  </p>
                </div>
                <div className="text-[11px] text-ink-faint whitespace-nowrap shrink-0">
                  {formatDateTime(act.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
