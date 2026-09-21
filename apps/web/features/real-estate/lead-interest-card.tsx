"use client";

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/formatters";
import { addLeadInterestAction } from "@/lib/actions/real-estate-actions";
import { PaymentPlanModal } from "./payment-plan-modal";
import { ReserveUnitDialog } from "./reserve-unit-dialog";
import type { MatchedUnitItem } from "@business-os/core";
import type {
  LeadPropertyInterest,
  UnitUsageType,
  UnitType,
} from "@business-os/types";
import {
  Building,
  Sparkles,
  BookmarkCheck,
  Calculator,
  Plus,
  Star,
} from "lucide-react";

interface ProjectOption {
  id: string;
  name: string;
}

interface LeadInterestCardProps {
  leadId: string;
  leadName: string;
  interests: LeadPropertyInterest[];
  matchedUnits: MatchedUnitItem[];
  projects: ProjectOption[];
  canEdit?: boolean;
  canReserve?: boolean;
}

export function LeadInterestCard({
  leadId,
  leadName,
  interests,
  matchedUnits,
  projects,
  canEdit = true,
  canReserve = true,
}: LeadInterestCardProps) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal states for payment plan and reservation
  const [selectedCalcUnit, setSelectedCalcUnit] =
    useState<MatchedUnitItem | null>(null);
  const [selectedReserveUnit, setSelectedReserveUnit] =
    useState<MatchedUnitItem | null>(null);

  const [projectId, setProjectId] = useState("");
  const [usageType, setUsageType] = useState<UnitUsageType>("COMMERCIAL");
  const [unitType, setUnitType] = useState<UnitType>("CLINIC");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");
  const [isPrimary, setIsPrimary] = useState(true);
  const [notes, setNotes] = useState("");

  const handleAddInterest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const res = await addLeadInterestAction({
      leadId,
      projectId: projectId || null,
      usageType: usageType || null,
      unitType: unitType || null,
      budgetMin: budgetMin ? Number(budgetMin) : null,
      budgetMax: budgetMax ? Number(budgetMax) : null,
      areaMin: areaMin ? Number(areaMin) : null,
      areaMax: areaMax ? Number(areaMax) : null,
      isPrimary,
      notes: notes.trim() || null,
    });

    if (!res.success) {
      setError(res.error || "Failed to record property interest");
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setIsAddOpen(false);
    // Reset form
    setProjectId("");
    setBudgetMin("");
    setBudgetMax("");
    setAreaMin("");
    setAreaMax("");
    setNotes("");
  };

  return (
    <div className="bg-surface border border-line rounded-xl p-5 space-y-6 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Building className="w-4 h-4 text-accent" />
            Property Requirements & Interests ({interests.length})
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Client requirements (1:N) and deterministic inventory matches.
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddOpen(true)}
            className="gap-1.5 h-7 text-xs"
          >
            <Plus className="w-3 h-3" />
            Add Interest
          </Button>
        )}
      </div>

      {/* 1:N Property Interests Grid */}
      {interests.length === 0 ? (
        <div className="p-4 border border-line-subtle rounded-lg bg-surface-subtle text-center text-ink-muted">
          <p className="text-xs">
            No property interests recorded yet. Add an interest profile above to
            match available units.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {interests.map((item) => {
            const project = projects.find((p) => p.id === item.project_id);
            return (
              <div
                key={item.id}
                className={`p-3.5 border rounded-lg transition-colors space-y-2 ${
                  item.is_primary
                    ? "border-accent/40 bg-accent/[0.02]"
                    : "border-line bg-surface-subtle"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {item.is_primary && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/10 text-accent">
                        <Star className="w-3 h-3 fill-accent" /> Primary
                      </span>
                    )}
                    <span className="font-semibold text-ink">
                      {project?.name || "Any Project in Portfolio"}
                    </span>
                  </div>
                  <Badge
                    variant={item.status === "ACTIVE" ? "success" : "default"}
                  >
                    {item.status}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                  {item.usage_type && (
                    <Badge variant="purple">{item.usage_type}</Badge>
                  )}
                  {item.unit_type && (
                    <Badge variant="outline">{item.unit_type}</Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-ink-muted border-t border-line-subtle">
                  <div>
                    <span className="block text-[10px] text-ink-faint">
                      Budget
                    </span>
                    <span className="font-mono text-ink font-medium">
                      {item.budget_min || item.budget_max
                        ? `${item.budget_min ? formatCurrency(Number(item.budget_min), "EGP") : "0"} - ${item.budget_max ? formatCurrency(Number(item.budget_max), "EGP") : "Max"}`
                        : "Flexible"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-ink-faint">
                      Area
                    </span>
                    <span className="font-mono text-ink font-medium">
                      {item.area_min || item.area_max
                        ? `${item.area_min || 0} - ${item.area_max || "∞"} m²`
                        : "Flexible"}
                    </span>
                  </div>
                </div>

                {item.notes && (
                  <p className="text-[11px] text-ink-muted italic border-t border-line-subtle pt-1">
                    "{item.notes}"
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Matched Available Units Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-ink flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            Matched Available Inventory ({matchedUnits.length})
          </h4>
          <span className="text-[11px] text-ink-faint">
            Multi-tenant available inventory matched deterministically
          </span>
        </div>

        {matchedUnits.length === 0 ? (
          <div className="p-6 border border-line-subtle rounded-lg bg-surface-subtle text-center text-ink-muted">
            <p className="text-xs">
              {interests.length > 0
                ? "No available units currently meet the client's criteria."
                : "Record client property requirements above to see matched units."}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {matchedUnits.slice(0, 5).map((unit) => (
              <div
                key={unit.id}
                className="p-3.5 border border-line rounded-lg bg-surface hover:border-line-strong transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink">
                      Unit #{unit.unit_number}
                    </span>
                    <span className="text-ink-muted">
                      • {unit.project_name}
                    </span>
                    <Badge variant="purple">{unit.usage_type}</Badge>
                    <Badge variant="outline">{unit.unit_type}</Badge>
                    {unit.floor && (
                      <span className="text-[11px] text-ink-faint">
                        ({unit.floor})
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                      Score: {unit.matchScore}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-ink-secondary">
                    <span className="font-mono font-medium text-ink">
                      {formatCurrency(unit.price, unit.currency)}
                    </span>
                    <span>•</span>
                    <span className="font-mono">{unit.gross_area} m²</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-medium">
                      {unit.status}
                    </span>
                  </div>

                  {unit.matchReasons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {unit.matchReasons.map((reason, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center text-[10px] text-ink-muted bg-surface-subtle px-1.5 py-0.5 rounded border border-line-subtle"
                        >
                          ✓ {reason}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tactical Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectedCalcUnit(unit)}
                    className="gap-1 h-8 text-xs"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    Payment Plan
                  </Button>

                  {canReserve && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setSelectedReserveUnit(unit)}
                      className="gap-1 h-8 text-xs"
                    >
                      <BookmarkCheck className="w-3.5 h-3.5" />
                      Reserve
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Property Interest Dialog */}
      <Dialog
        isOpen={isAddOpen}
        onClose={() => {
          if (!isLoading) {
            setIsAddOpen(false);
            setError(null);
          }
        }}
        title="Add Real Estate Property Interest"
        description="Add a new requirement profile to this lead's wishlist (1:N)."
      >
        <form onSubmit={handleAddInterest} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Target Project (Optional)
            </label>
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={isLoading}
            >
              <option value="">Any Project in Portfolio</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Usage Type
              </label>
              <Select
                value={usageType}
                onChange={(e) => setUsageType(e.target.value as UnitUsageType)}
                disabled={isLoading}
              >
                <option value="COMMERCIAL">Commercial (تجاري)</option>
                <option value="ADMINISTRATIVE">Administrative (إداري)</option>
                <option value="MEDICAL">Medical (طبي)</option>
                <option value="RESIDENTIAL">Residential (سكني)</option>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Product Type
              </label>
              <Select
                value={unitType}
                onChange={(e) => setUnitType(e.target.value as UnitType)}
                disabled={isLoading}
              >
                <option value="CLINIC">Clinic (عيادة)</option>
                <option value="RETAIL_STORE">Retail Store (محل)</option>
                <option value="OFFICE">Office (مكتب)</option>
                <option value="PHARMACY">Pharmacy (صيدلية)</option>
                <option value="APARTMENT">Apartment (شقة)</option>
                <option value="DUPLEX">Duplex (دوبلكس)</option>
                <option value="PENTHOUSE">Penthouse (بنتهاوس)</option>
                <option value="STANDALONE_VILLA">Villa (فيلا)</option>
                <option value="TOWNHOUSE">Townhouse (تاون هاوس)</option>
                <option value="OTHER">Other (أخرى)</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Min Budget (EGP)
              </label>
              <Input
                type="number"
                step="50000"
                value={budgetMin}
                onChange={(e) => setBudgetMin(e.target.value)}
                placeholder="e.g. 2000000"
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Max Budget (EGP)
              </label>
              <Input
                type="number"
                step="50000"
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
                placeholder="e.g. 4500000"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Min Area (m²)
              </label>
              <Input
                type="number"
                step="5"
                value={areaMin}
                onChange={(e) => setAreaMin(e.target.value)}
                placeholder="e.g. 60"
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Max Area (m²)
              </label>
              <Input
                type="number"
                step="5"
                value={areaMax}
                onChange={(e) => setAreaMax(e.target.value)}
                placeholder="e.g. 150"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPrimary"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              disabled={isLoading}
              className="rounded border-line text-accent focus:ring-accent"
            />
            <label
              htmlFor="isPrimary"
              className="text-xs text-ink cursor-pointer"
            >
              Mark as Primary Active Requirement
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Notes
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Needs front facade view on main entrance..."
              disabled={isLoading}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-subtle">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isLoading}
              onClick={() => setIsAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isLoading}
            >
              Save Interest
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Payment Plan Modal for Selected Matched Unit */}
      {selectedCalcUnit && (
        <PaymentPlanModal
          isOpen={true}
          onClose={() => setSelectedCalcUnit(null)}
          unitNumber={selectedCalcUnit.unit_number}
          projectName={selectedCalcUnit.project_name}
          initialPrice={selectedCalcUnit.price}
        />
      )}

      {/* Reservation Dialog for Selected Unit */}
      {selectedReserveUnit && (
        <ReserveUnitDialog
          isOpen={true}
          onClose={() => setSelectedReserveUnit(null)}
          leadId={leadId}
          leadName={leadName}
          unit={{
            id: selectedReserveUnit.id,
            unit_number: selectedReserveUnit.unit_number,
            project_name: selectedReserveUnit.project_name,
            price: selectedReserveUnit.price,
            currency: selectedReserveUnit.currency,
          }}
          onSuccess={() => setSelectedReserveUnit(null)}
        />
      )}
    </div>
  );
}
