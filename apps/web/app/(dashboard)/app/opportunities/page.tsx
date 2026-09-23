import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUiCapabilities,
  listOpportunitiesPage,
  listOrganizationMembers,
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { OpportunityFilterToolbar } from "@/features/opportunities/opportunity-filter-toolbar";
import { OpportunityTable } from "@/features/opportunities/opportunity-table";

interface OpportunitiesPageProps {
  searchParams: Promise<{
    search?: string;
    stage?: string;
    assignee?: string;
    page?: string;
  }>;
}

export default async function OpportunitiesPage({
  searchParams,
}: OpportunitiesPageProps) {
  const context = await requireTenantContext();
  const capabilities = getUiCapabilities(context);
  if (!capabilities.canReadOpportunities) {
    notFound();
  }

  const params = await searchParams;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;

  const stage =
    params.stage &&
    OPPORTUNITY_STAGES.includes(params.stage as OpportunityStage)
      ? (params.stage as OpportunityStage)
      : undefined;

  let members: Array<{ user_id: string; full_name: string }> = [];
  try {
    const rawMembers = await listOrganizationMembers(context);
    members = rawMembers.map((member) => ({
      user_id: member.user_id,
      full_name: member.full_name || member.email,
    }));
  } catch {
    members = [];
  }

  const { opportunities, totalCount } = await listOpportunitiesPage(context, {
    search: params.search || undefined,
    stage,
    assignedUserId: params.assignee || undefined,
    page: currentPage,
    pageSize,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">
            Opportunities
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            {totalCount} {totalCount === 1 ? "commercial deal" : "commercial deals"} in the sales pipeline
          </p>
        </div>

        {capabilities.canCreateOpportunity && (
          <Link href="/app/leads">
            <Button size="sm" variant="secondary">
              Create from a Lead
            </Button>
          </Link>
        )}
      </div>

      <OpportunityFilterToolbar members={members} />

      <OpportunityTable
        opportunities={opportunities}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
      />
    </div>
  );
}
