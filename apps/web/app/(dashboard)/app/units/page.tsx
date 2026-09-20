import React from "react";
import { withTenantContext } from "@business-os/database";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/formatters";
import { Boxes } from "lucide-react";

export default async function UnitsPage() {
  const context = await requireTenantContext();

  const units = await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(`
        SELECT u.id, u.unit_number, u.unit_type, u.gross_area, u.price,
               u.currency, u.status, p.name as project_name
        FROM units u
        JOIN projects p ON p.id = u.project_id
        ORDER BY u.unit_number ASC
        LIMIT 100
      `);
    return res.rows;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink tracking-tight">
          Property Inventory Units
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          {units.length} {units.length === 1 ? "unit" : "units"} listed across
          active projects
        </p>
      </div>

      {units.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-12 text-center">
          <Boxes className="w-8 h-8 text-ink-faint mx-auto mb-2" />
          <p className="text-sm font-medium text-ink">No units registered</p>
          <p className="text-xs text-ink-muted mt-1">
            Units can be imported or configured via project inventory.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold text-ink-muted tracking-wider uppercase select-none">
                  <th className="py-3 px-4">Unit #</th>
                  <th className="py-3 px-4">Project</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Gross Area</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {units.map((unit: any) => (
                  <tr
                    key={unit.id}
                    className="hover:bg-surface-subtle transition-colors h-12"
                  >
                    <td className="py-2.5 px-4 font-semibold text-ink">
                      {unit.unit_number}
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary">
                      {unit.project_name}
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary">
                      {unit.unit_type}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-ink-secondary">
                      {unit.gross_area} m²
                    </td>
                    <td className="py-2.5 px-4 font-mono font-medium text-ink">
                      {formatCurrency(
                        Number(unit.price),
                        unit.currency || "EGP",
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <Badge
                        variant={
                          unit.status === "AVAILABLE"
                            ? "success"
                            : unit.status === "RESERVED"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {unit.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
