import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listUnitsInventory } from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/formatters";
import { Boxes, ChevronLeft, ChevronRight } from "lucide-react";

interface UnitsPageProps {
  searchParams: Promise<{
    page?: string;
  }>;
}

export default async function UnitsPage({ searchParams }: UnitsPageProps) {
  const context = await requireTenantContext();
  const params = await searchParams;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 25;

  // Fetch paginated inventory with truthful total count via core read-model service
  let inventory: Awaited<ReturnType<typeof listUnitsInventory>>;
  try {
    inventory = await listUnitsInventory(context, {
      page: currentPage,
      pageSize,
    });
  } catch {
    notFound();
  }

  const { units, totalCount } = inventory;

  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const fromRecord = totalCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const toRecord = Math.min(currentPage * pageSize, totalCount);

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
                {units.map((unit) => (
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

          {/* Truthful Pagination Bar */}
          <div className="px-4 py-3 border-t border-line bg-surface-subtle flex items-center justify-between text-xs text-ink-muted select-none">
            <div>
              Showing <span className="font-medium text-ink">{fromRecord}</span>{" "}
              to <span className="font-medium text-ink">{toRecord}</span> of{" "}
              <span className="font-medium text-ink">{totalCount}</span> units
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-faint">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                {currentPage > 1 ? (
                  <Link
                    href={`/app/units?page=${currentPage - 1}`}
                    className="p-1 border border-line rounded bg-surface hover:bg-surface-subtle text-ink transition-colors"
                    aria-label="Previous Page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Link>
                ) : (
                  <button
                    disabled
                    className="p-1 border border-line-subtle rounded bg-surface text-ink-faint cursor-not-allowed opacity-50"
                    aria-label="Previous Page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                )}

                {currentPage < totalPages ? (
                  <Link
                    href={`/app/units?page=${currentPage + 1}`}
                    className="p-1 border border-line rounded bg-surface hover:bg-surface-subtle text-ink transition-colors"
                    aria-label="Next Page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                ) : (
                  <button
                    disabled
                    className="p-1 border border-line-subtle rounded bg-surface text-ink-faint cursor-not-allowed opacity-50"
                    aria-label="Next Page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
