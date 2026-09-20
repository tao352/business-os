import React from "react";
import { withTenantContext } from "@business-os/database";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin } from "lucide-react";
import { formatDate } from "@/lib/formatters";

export default async function ProjectsPage() {
  const context = await requireTenantContext();

  const projects = await withTenantContext(
    context.organizationId,
    async (tx) => {
      const res = await tx.query(`
        SELECT p.id, p.name, p.location, p.description, p.total_units, p.created_at,
               COUNT(u.id) as units_count,
               COUNT(u.id) FILTER (WHERE u.status = 'AVAILABLE') as available_units
        FROM projects p
        LEFT JOIN units u ON u.project_id = p.id
        GROUP BY p.id
        ORDER BY p.name ASC
      `);
      return res.rows;
    },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink tracking-tight">
          Real Estate Projects
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          {projects.length}{" "}
          {projects.length === 1 ? "development" : "developments"} in portfolio
        </p>
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
          {projects.map((project: any) => (
            <div
              key={project.id}
              className="bg-surface border border-line rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h2 className="text-sm font-bold text-ink truncate">
                    {project.name}
                  </h2>
                  <Badge variant="neutral">Active</Badge>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-ink-secondary mb-3">
                  <MapPin className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                  <span className="truncate">{project.location}</span>
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
                    {project.available_units || 0}
                  </span>{" "}
                  available
                </div>
                <div className="text-[11px] text-ink-faint">
                  {project.units_count || project.total_units || 0} total units
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
