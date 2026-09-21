import React from "react";
import { notFound } from "next/navigation";
import {
  canAccessIndividualLeadRecords,
  listLeadFollowUpHealth,
} from "@business-os/core";
import { requireTenantContext, getSessionUser } from "@/lib/auth";
import { SalesCommandCenter } from "@/features/sales/sales-command-center";

export default async function SalesCommandCenterPage() {
  const context = await requireTenantContext();

  if (!canAccessIndividualLeadRecords(context)) {
    notFound();
  }

  const [session, rows] = await Promise.all([
    getSessionUser(),
    listLeadFollowUpHealth(context, { limit: 200 }),
  ]);

  const isPersonalScope = context.role === "SALESPERSON";
  const scopeLabel = isPersonalScope
    ? "Your active lead queue"
    : `Team execution view for ${session?.activeOrganization.name || "this workspace"}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            Sales execution
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-ink">
            Sales Command Center
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-muted">
            A live operating view of follow-up risk, next actions, and lead
            leakage across the active pipeline.
          </p>
        </div>
      </header>

      <SalesCommandCenter rows={rows} scopeLabel={scopeLabel} />
    </div>
  );
}
