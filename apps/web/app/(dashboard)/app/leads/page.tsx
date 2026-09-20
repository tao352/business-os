import React from "react";
import { listLeadsPage, listOrganizationMembers } from "@business-os/core";
import type { LeadStatus } from "@business-os/types";
import { requireTenantContext } from "@/lib/auth";
import { LeadsFilterToolbar } from "@/features/leads/leads-filter-toolbar";
import { LeadsTable } from "@/features/leads/leads-table";
import { ShieldAlert } from "lucide-react";

interface LeadsPageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    assignee?: string;
    page?: string;
  }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const context = await requireTenantContext();
  const params = await searchParams;

  const search = params.search || "";
  const status = (params.status as LeadStatus) || undefined;
  const assignee = params.assignee || undefined;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;

  // 1. Fetch Organization Members for Assignee filtering (if caller has member read access)
  let members: Array<{ id: string; user_id: string; full_name: string }> = [];
  try {
    const rawMembers = await listOrganizationMembers(context);
    members = rawMembers.map((m) => ({
      id: m.id,
      user_id: m.user_id,
      full_name: m.full_name || m.email,
    }));
  } catch {
    // If user lacks permission to list all members, fallback to empty
  }

  // 2. Fetch Leads via core read-model service (enforces role-based aggregate-only and salesperson scoping)
  const { leads, totalCount, individualRecordsRestricted } =
    await listLeadsPage(context, {
      search,
      status,
      assignee,
      page: currentPage,
      pageSize,
    });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">
            Leads
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            {totalCount} {totalCount === 1 ? "lead" : "leads"} in pipeline
          </p>
        </div>
      </div>

      {/* Aggregate Only Notice Banner */}
      {individualRecordsRestricted && (
        <div className="p-3.5 rounded-lg bg-surface border border-line flex items-center gap-2.5 text-xs text-ink-secondary">
          <ShieldAlert className="w-4 h-4 text-accent shrink-0" />
          <span>
            Individual lead records are not available for your role. Aggregated
            pipeline volume is shown above.
          </span>
        </div>
      )}

      {/* Filter Toolbar (hidden when individual records are restricted) */}
      {!individualRecordsRestricted && <LeadsFilterToolbar members={members} />}

      {/* Leads Table */}
      <LeadsTable
        leads={leads}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        individualRecordsRestricted={individualRecordsRestricted}
      />
    </div>
  );
}
