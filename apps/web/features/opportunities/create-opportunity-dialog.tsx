"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOpportunityAction } from "@/lib/actions/opportunity-actions";

interface CreateOpportunityDialogProps {
  leadId: string;
  leadName: string;
  assignedUserId?: string | null;
  canCreate?: boolean;
}

export function CreateOpportunityDialog({
  leadId,
  leadName,
  assignedUserId,
  canCreate = true,
}: CreateOpportunityDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const value = Number(formData.get("value") || 0);

    const res = await createOpportunityAction({
      leadId,
      title: String(formData.get("title") || ""),
      value,
      currency: String(formData.get("currency") || "EGP"),
      expectedCloseDate:
        String(formData.get("expectedCloseDate") || "") || null,
      assignedUserId: assignedUserId || null,
    });

    if (!res.success) {
      setError(res.error || "Failed to create Opportunity");
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setIsOpen(false);
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsOpen(true)}
        className="text-xs"
      >
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        New Opportunity
      </Button>

      <Dialog
        isOpen={isOpen}
        onClose={() => {
          if (!isLoading) {
            setIsOpen(false);
            setError(null);
          }
        }}
        title="Create Sales Opportunity"
        description={`Open a commercial deal for ${leadName} without changing the customer Lead itself.`}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Opportunity Title <span className="text-red-500">*</span>
            </label>
            <Input
              name="title"
              required
              maxLength={200}
              placeholder="e.g. Al Safwa apartment / Stars Mall shop"
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Expected Value <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                name="value"
                min="0"
                step="0.01"
                required
                placeholder="2500000"
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Currency
              </label>
              <Input
                name="currency"
                defaultValue="EGP"
                maxLength={10}
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Expected Close Date
            </label>
            <Input type="date" name="expectedCloseDate" disabled={isLoading} />
          </div>

          <div className="p-3 rounded-md border border-line bg-surface-subtle text-xs text-ink-secondary">
            The Opportunity starts in <strong>DISCOVERY</strong>. Reservation
            and Contract events will advance the linked Opportunity through the
            shared Sales lifecycle.
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
              Create Opportunity
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
