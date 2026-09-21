import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listProjectsOverview, getUiCapabilities } from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { CreateProjectDialog } from "@/features/real-estate/create-project-dialog";
import { Building2, MapPin, ArrowRight } from "lucide-react";

export default async function ProjectsPage() {
  const context = await requireTenantContext();
  const capabilities = getUiCapabilities(context);

  // Fetch real estate projects overview via core read-model service
  let projects: Awaited<ReturnType<typeof listProjectsOverview>>;
  try {
    projects = await listProjectsOverview(context);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">
            Real Estate Developments
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            {projects.length}{" "}
            {projects.length === 1 ? "development" : "developments"} in
            portfolio
          </p>
        </div>

        <CreateProjectDialog canCreate={capabilities.canCreateProject} />
      </div>

      {projects.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-12 text-center">
          <Building2 className="w-8 h-8 text-ink-faint mx-auto mb-2" />
          <p className="text-sm font-medium text-ink">No projects registered</p>
          <p className="text-xs text-ink-muted mt-1">
            Projects can be configured via real estate administration.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-surface border border-line rounded-xl p-5 flex flex-col justify-between hover:border-line-strong transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h2 className="text-sm font-bold text-ink truncate">
                    {project.name}
                  </h2>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge
                      variant={
                        project.project_type === "COMMERCIAL"
                          ? "purple"
                          : "info"
                      }
                    >
                      {project.project_type}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-ink-secondary mb-3">
                  <MapPin className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                  <span className="truncate">{project.location}</span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <Badge
                    variant={
                      project.construction_status === "COMPLETED" ||
                      project.construction_status === "READY_FOR_DELIVERY"
                        ? "success"
                        : "neutral"
                    }
                  >
                    {project.construction_status.replace(/_/g, " ")}
                  </Badge>
                  <Badge
                    variant={
                      project.sales_status === "SELLING"
                        ? "info"
                        : project.sales_status === "SOLD_OUT"
                          ? "warning"
                          : "outline"
                    }
                  >
                    {project.sales_status.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-[11px] text-ink-faint">
                    {project.is_active ? "Active" : "Archived"}
                  </span>
                </div>

                {project.description && (
                  <p className="text-xs text-ink-muted line-clamp-2 mb-4">
                    {project.description}
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-line-subtle flex items-center justify-between text-xs text-ink-secondary">
                <div>
                  <span className="font-semibold text-ink">
                    {project.available_units}
                  </span>{" "}
                  available
                  <span className="text-[11px] text-ink-faint block">
                    {project.units_count || project.total_units || 0} total
                    units
                  </span>
                </div>

                <Link
                  href={`/app/units?projectId=${project.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover transition-colors"
                >
                  View Units
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
