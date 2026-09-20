"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { updateLeadStatusAction } from "@/lib/actions/lead-actions";
import type { LeadStatus } from "@business-os/types";

interface ChangeStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  currentStatus: LeadStatus;
}

export function ChangeStatusDialog({
  isOpen,
  onClose,
  leadId,
  currentStatus,
}: ChangeStatusDialogProps) {
  const { showToast } = useToast();
  const [selectedStatus, setSelectedStatus] =
    useState<LeadStatus>(currentStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStatus === currentStatus) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const res = await updateLeadStatusAction(leadId, selectedStatus);
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to update status");
      return;
    }

    showToast(`Lead status updated to ${selectedStatus}`);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Change Pipeline Status"
      description="Update the current operational stage of this prospect."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Select Stage
          </label>
          <Select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as LeadStatus)}
            disabled={isSubmitting}
          >
            <option value="NEW">New</option>
            <option value="CONTACTED">Contacted</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="MEETING_SCHEDULED">Meeting Scheduled</option>
            <option value="SITE_VISIT_BOOKED">Site Visit Booked</option>
            <option value="RESERVED">Reserved</option>
            <option value="CONTRACTED">Contracted</option>
            <option value="UNQUALIFIED">Unqualified</option>
            <option value="LOST">Lost</option>
          </Select>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
            disabled={selectedStatus === currentStatus}
          >
            Apply Status
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
