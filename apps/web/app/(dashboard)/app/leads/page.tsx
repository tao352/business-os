import React from "react";
import { withTenantContext } from "@business-os/database";
import { listOrganizationMembers } from "@business-os/core";
import type { LeadStatus } from "@business-os/types";
import { requireTenantContext } from "@/lib/auth";
import { LeadsFilterToolbar } from "@/features/leads/leads-filter-toolbar";
import { LeadsTable, type LeadRow } from "@/features/leads/leads-table";

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
  const offset = (currentPage - 1) * pageSize;

  // 1. Fetch Organization Members for Assignee filtering
  let members: Array<{ id: string; user_id: string; full_name: string }> = [];
  try {
    const rawMembers = await listOrganizationMembers(context);
    members = rawMembers.map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      full_name: m.full_name || m.email,
    }));
  } catch {
    // If user lacks permission to list all members, fallback to empty
  }

  // 2. Fetch Leads with filters, pagination, and total count
  const { leads, totalCount } = await withTenantContext(
    context.organizationId,
    async (tx) => {
      const conditions: string[] = ["1 = 1"];
      const queryParams: unknown[] = [];
      let idx = 1;

      // Row-level ownership constraint for SALESPERSON
      if (context.role === "SALESPERSON") {
        conditions.push(`l.assigned_user_id = $${idx++}`);
        queryParams.push(context.userId);
      } else if (assignee) {
        conditions.push(`l.assigned_user_id = $${idx++}`);
        queryParams.push(assignee);
      }

      if (status) {
        conditions.push(`l.status = $${idx++}`);
        queryParams.push(status);
      }

      if (search) {
        conditions.push(
          `(l.full_name ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.email ILIKE $${idx})`,
        );
        queryParams.push(`%${search}%`);
        idx++;
      }

      const whereClause = conditions.join(" AND ");

      // Total count
      const countRes = await tx.query(
        `SELECT COUNT(*) as total FROM leads l WHERE ${whereClause}`,
        queryParams,
      );
      const total = parseInt(countRes.rows[0]?.total || "0", 10);

      // Page records
      const selectQuery = `
        SELECT l.id, l.full_name, l.phone, l.email, l.status, l.source,
               u.full_name as assigned_name, l.created_at, l.updated_at
        FROM leads l
        LEFT JOIN users u ON u.id = l.assigned_user_id
        WHERE ${whereClause}
        ORDER BY l.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `;
      const rowsRes = await tx.query(selectQuery, [
        ...queryParams,
        pageSize,
        offset,
      ]);

      return {
        leads: rowsRes.rows as LeadRow[],
        totalCount: total,
      };
    },
  );

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

      {/* Filter Toolbar */}
      <LeadsFilterToolbar members={members} />

      {/* Leads Table */}
      <LeadsTable
        leads={leads}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
      />
    </div>
  );
}
