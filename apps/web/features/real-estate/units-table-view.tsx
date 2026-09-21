"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/formatters";
import { CreateUnitDialog } from "./create-unit-dialog";
import { PaymentPlanModal } from "./payment-plan-modal";
import type { UnitInventoryItem } from "@business-os/core";
import {
  Boxes,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";

interface ProjectOption {
  id: string;
  name: string;
}

interface UnitsTableViewProps {
  units: UnitInventoryItem[];
  projects: ProjectOption[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  selectedProjectId?: string;
  selectedUsageType?: string;
  selectedUnitType?: string;
  selectedStatus?: string;
  canCreateUnit?: boolean;
}

export function UnitsTableView({
  units,
  projects,
  totalCount,
  currentPage,
  pageSize,
  selectedProjectId,
  selectedUsageType,
  selectedUnitType,
  selectedStatus,
  canCreateUnit = true,
}: UnitsTableViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [calcUnit, setCalcUnit] = useState<UnitInventoryItem | null>(null);

  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const fromRecord = totalCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const toRecord = Math.min(currentPage * pageSize, totalCount);

  const updateFilters = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "ALL") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Top Controls: Filter Toolbar & Add Unit */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Project Dropdown */}
          <div className="w-44">
            <Select
              value={selectedProjectId || "ALL"}
              onChange={(e) => updateFilters("projectId", e.target.value)}
              className="h-8 text-xs"
            >
              <option value="ALL">All Developments</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Usage Type Dropdown */}
          <div className="w-36">
            <Select
              value={selectedUsageType || "ALL"}
              onChange={(e) => updateFilters("usageType", e.target.value)}
              className="h-8 text-xs"
            >
              <option value="ALL">All Usages</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="ADMINISTRATIVE">Administrative</option>
              <option value="MEDICAL">Medical</option>
              <option value="RESIDENTIAL">Residential</option>
            </Select>
          </div>

          {/* Unit Type Dropdown */}
          <div className="w-36">
            <Select
              value={selectedUnitType || "ALL"}
              onChange={(e) => updateFilters("unitType", e.target.value)}
              className="h-8 text-xs"
            >
              <option value="ALL">All Types</option>
              <option value="CLINIC">Clinic</option>
              <option value="RETAIL_STORE">Retail Store</option>
              <option value="OFFICE">Office</option>
              <option value="PHARMACY">Pharmacy</option>
              <option value="APARTMENT">Apartment</option>
              <option value="DUPLEX">Duplex</option>
              <option value="PENTHOUSE">Penthouse</option>
              <option value="STANDALONE_VILLA">Villa</option>
              <option value="TOWNHOUSE">Townhouse</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>

          {/* Status Dropdown */}
          <div className="w-36">
            <Select
              value={selectedStatus || "ALL"}
              onChange={(e) => updateFilters("status", e.target.value)}
              className="h-8 text-xs"
            >
              <option value="ALL">All Statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="RESERVED">Reserved</option>
              <option value="CONTRACTED">Contracted</option>
            </Select>
          </div>

          {(selectedProjectId ||
            selectedUsageType ||
            selectedUnitType ||
            selectedStatus) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(pathname)}
              className="h-8 text-xs text-ink-muted hover:text-ink"
            >
              Clear
            </Button>
          )}
        </div>

        <CreateUnitDialog
          projects={projects}
          defaultProjectId={selectedProjectId}
          canCreate={canCreateUnit}
        />
      </div>

      {/* Units Table Container */}
      {units.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-12 text-center">
          <Boxes className="w-8 h-8 text-ink-faint mx-auto mb-2" />
          <p className="text-sm font-medium text-ink">No units found</p>
          <p className="text-xs text-ink-muted mt-1">
            Try adjusting your search criteria or register a new unit above.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold text-ink-muted tracking-wider uppercase select-none">
                  <th className="py-3 px-4">Unit #</th>
                  <th className="py-3 px-4">Development</th>
                  <th className="py-3 px-4">Usage</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Floor</th>
                  <th className="py-3 px-4">Gross Area</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {units.map((unit) => (
                  <tr
                    key={unit.id}
                    className="hover:bg-surface-subtle transition-colors h-12"
                  >
                    <td className="py-2.5 px-4 font-semibold text-ink">
                      <div>{unit.unit_number}</div>
                      {unit.model_name && (
                        <span className="block text-[10px] text-ink-muted font-normal">
                          {unit.model_name}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary">
                      {unit.project_name}
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge variant="purple">{unit.usage_type}</Badge>
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge variant="outline">{unit.unit_type}</Badge>
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary">
                      {unit.floor || "—"}
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
                    <td className="py-2.5 px-4">
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
                    <td className="py-2.5 px-4 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setCalcUnit(unit)}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <Calculator className="w-3 h-3" />
                        Plan
                      </Button>
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
                    href={`/app/units?${new URLSearchParams({
                      ...Object.fromEntries(searchParams.entries()),
                      page: String(currentPage - 1),
                    }).toString()}`}
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
                    href={`/app/units?${new URLSearchParams({
                      ...Object.fromEntries(searchParams.entries()),
                      page: String(currentPage + 1),
                    }).toString()}`}
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

      {/* Payment Plan Modal for Selected Unit */}
      {calcUnit && (
        <PaymentPlanModal
          isOpen={true}
          onClose={() => setCalcUnit(null)}
          unitNumber={calcUnit.unit_number}
          projectName={calcUnit.project_name}
          initialPrice={calcUnit.price}
        />
      )}
    </div>
  );
}
