"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createUnitAction } from "@/lib/actions/real-estate-actions";
import { Plus } from "lucide-react";

interface ProjectOption {
  id: string;
  name: string;
}

interface CreateUnitDialogProps {
  projects: ProjectOption[];
  defaultProjectId?: string;
  canCreate?: boolean;
}

export function CreateUnitDialog({
  projects,
  defaultProjectId,
  canCreate = true,
}: CreateUnitDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await createUnitAction(formData);

    if (!res.success) {
      setError(res.error || "Failed to create unit");
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setIsOpen(false);
  };

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" />
        New Unit
      </Button>

      <Dialog
        isOpen={isOpen}
        onClose={() => {
          if (!isLoading) {
            setIsOpen(false);
            setError(null);
          }
        }}
        title="Add Inventory Unit"
        description="Register a new unit, clinic, shop, or apartment into project inventory."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Project <span className="text-red-500">*</span>
            </label>
            <Select
              name="projectId"
              defaultValue={defaultProjectId || projects[0]?.id}
              required
              disabled={isLoading || projects.length === 0}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            {projects.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Please create a project first before adding units.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Unit Number <span className="text-red-500">*</span>
              </label>
              <Input
                name="unitNumber"
                required
                placeholder="e.g. C-104 / R-01"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Usage Classification <span className="text-red-500">*</span>
              </label>
              <Select
                name="usageType"
                defaultValue="COMMERCIAL"
                disabled={isLoading}
              >
                <option value="COMMERCIAL">Commercial (تجاري)</option>
                <option value="ADMINISTRATIVE">Administrative (إداري)</option>
                <option value="MEDICAL">Medical (طبي)</option>
                <option value="RESIDENTIAL">Residential (سكني)</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Product Type <span className="text-red-500">*</span>
              </label>
              <Select
                name="unitType"
                defaultValue="RETAIL_STORE"
                disabled={isLoading}
              >
                <option value="RETAIL_STORE">Retail Store (محل)</option>
                <option value="RESTAURANT_CAFE">
                  Restaurant / Cafe (مطعم/كافيه)
                </option>
                <option value="PHARMACY">Pharmacy (صيدلية)</option>
                <option value="OFFICE">Office (مكتب)</option>
                <option value="CLINIC">Clinic (عيادة)</option>
                <option value="APARTMENT">Apartment (شقة)</option>
                <option value="DUPLEX">Duplex (دوبلكس)</option>
                <option value="PENTHOUSE">Penthouse (بنتهاوس)</option>
                <option value="STANDALONE_VILLA">Villa (فيلا)</option>
                <option value="TOWNHOUSE">Townhouse (تاون هاوس)</option>
                <option value="OTHER">Other (أخرى)</option>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Model / Label
              </label>
              <Input
                name="modelName"
                placeholder="e.g. Model A"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Floor
              </label>
              <Input
                name="floor"
                placeholder="e.g. Ground / 1st"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Gross Area (m²) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="1"
                name="grossArea"
                required
                placeholder="e.g. 75.5"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Total Price (EGP) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="1"
                min="1000"
                name="price"
                required
                placeholder="e.g. 3500000"
                disabled={isLoading}
              />
            </div>
          </div>

          <input type="hidden" name="currency" value="EGP" />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-subtle">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isLoading}
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isLoading}
              disabled={projects.length === 0}
            >
              Create Unit
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
