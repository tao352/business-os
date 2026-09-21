import React from "react";
import { notFound } from "next/navigation";
import {
  listUnitsInventory,
  listProjects,
  getUiCapabilities,
} from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { UnitsTableView } from "@/features/real-estate/units-table-view";

interface UnitsPageProps {
  searchParams: Promise<{
    page?: string;
    projectId?: string;
    usageType?: string;
    unitType?: string;
    status?: string;
  }>;
}

export default async function UnitsPage({ searchParams }: UnitsPageProps) {
  const context = await requireTenantContext();
  const params = await searchParams;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 25;

  const capabilities = getUiCapabilities(context);

  // Fetch projects list for filter dropdown and unit creation
  let projects: Awaited<ReturnType<typeof listProjects>> = [];
  try {
    projects = await listProjects(context);
  } catch {
    // If not permitted to list projects, leave empty
    projects = [];
  }

  // Fetch paginated inventory with truthful total count via core read-model service
  let inventory: Awaited<ReturnType<typeof listUnitsInventory>>;
  try {
    inventory = await listUnitsInventory(context, {
      page: currentPage,
      pageSize,
      projectId: params.projectId || undefined,
      usageType: params.usageType || undefined,
      unitType: params.unitType || undefined,
      status: params.status || undefined,
    });
  } catch {
    notFound();
  }

  const { units, totalCount } = inventory;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink tracking-tight">
          Property Inventory Units
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          {totalCount} {totalCount === 1 ? "unit" : "units"} in portfolio
        </p>
      </div>

      <UnitsTableView
        units={units}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        selectedProjectId={params.projectId}
        selectedUsageType={params.usageType}
        selectedUnitType={params.unitType}
        selectedStatus={params.status}
        canCreateUnit={capabilities.canCreateUnit}
      />
    </div>
  );
}
