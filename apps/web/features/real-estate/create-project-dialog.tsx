"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createProjectAction } from "@/lib/actions/real-estate-actions";
import { Plus } from "lucide-react";

interface CreateProjectDialogProps {
  canCreate?: boolean;
}

export function CreateProjectDialog({
  canCreate = true,
}: CreateProjectDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await createProjectAction(formData);

    if (!res.success) {
      setError(res.error || "Failed to create project");
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
        New Project
      </Button>

      <Dialog
        isOpen={isOpen}
        onClose={() => {
          if (!isLoading) {
            setIsOpen(false);
            setError(null);
          }
        }}
        title="Add Real Estate Project"
        description="Configure a new master development or commercial property in portfolio."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Project Name <span className="text-red-500">*</span>
            </label>
            <Input
              name="name"
              required
              placeholder="e.g. Ten Point Mall / حي الصفوة"
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Location <span className="text-red-500">*</span>
            </label>
            <Input
              name="location"
              required
              placeholder="e.g. New Cairo / Sheikh Zayed / Shorouk"
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Project Type
              </label>
              <Select
                name="projectType"
                defaultValue="COMMERCIAL"
                disabled={isLoading}
              >
                <option value="COMMERCIAL">Commercial (تجاري)</option>
                <option value="RESIDENTIAL">Residential (سكني)</option>
                <option value="MIXED_USE">Mixed Use (متعدد)</option>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Construction
              </label>
              <Select
                name="constructionStatus"
                defaultValue="UNDER_CONSTRUCTION"
                disabled={isLoading}
              >
                <option value="PLANNING">Planning (تخطيط)</option>
                <option value="UNDER_CONSTRUCTION">
                  Under Construction (إنشاء)
                </option>
                <option value="READY_FOR_DELIVERY">Ready (جاهز للتسليم)</option>
                <option value="COMPLETED">Completed (مكتمل)</option>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Sales Status
              </label>
              <Select
                name="salesStatus"
                defaultValue="SELLING"
                disabled={isLoading}
              >
                <option value="UPCOMING">Upcoming (قريباً)</option>
                <option value="SELLING">Selling (متاح للبيع)</option>
                <option value="SOLD_OUT">Sold Out (تم البيع)</option>
                <option value="RENTAL_ONLY">Rental Only (إيجار)</option>
                <option value="ON_HOLD">On Hold (معلق)</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Planned Units Count
            </label>
            <Input
              type="number"
              name="totalUnits"
              min="0"
              defaultValue="0"
              placeholder="0"
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Description / Notes
            </label>
            <textarea
              name="description"
              rows={3}
              placeholder="Commercial retail, clinics, and offices specifications..."
              disabled={isLoading}
              className="w-full text-xs p-2.5 rounded-md border border-line bg-surface text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

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
            >
              Create Project
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
