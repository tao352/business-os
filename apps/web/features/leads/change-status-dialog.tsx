"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { updateLeadStatusAction } from "@/lib/actions/lead-actions";
import type { LeadClosureReason, LeadStatus } from "@business-os/types";

interface ChangeStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  currentStatus: LeadStatus;
}

const CLOSURE_REASONS: Array<{
  value: Exclude<LeadClosureReason, "UNSPECIFIED">;
  label: string;
}> = [
  { value: "PRICE", label: "Price / السعر" },
  { value: "FINANCING", label: "Financing / التمويل" },
  {
    value: "UNIT_NOT_AVAILABLE",
    label: "Suitable unit unavailable / الوحدة المناسبة غير متاحة",
  },
  { value: "LOCATION", label: "Location / الموقع" },
  { value: "TIMING", label: "Not ready now / التوقيت غير مناسب" },
  { value: "COMPETITOR", label: "Bought from competitor / اشترى من منافس" },
  { value: "NO_RESPONSE", label: "No response / لا يرد" },
  { value: "NOT_QUALIFIED", label: "Not qualified / غير مؤهل" },
  { value: "DUPLICATE", label: "Duplicate lead / عميل مكرر" },
  { value: "OTHER", label: "Other / سبب آخر" },
];

export function ChangeStatusDialog({
  isOpen,
  onClose,
  leadId,
  currentStatus,
}: ChangeStatusDialogProps) {
  const { showToast } = useToast();
  const [selectedStatus, setSelectedStatus] =
    useState<LeadStatus>(currentStatus);
  const [lostReasonCode, setLostReasonCode] = useState<
    Exclude<LeadClosureReason, "UNSPECIFIED"> | ""
  >("");
  const [lostReasonNotes, setLostReasonNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosing =
    selectedStatus === "LOST" || selectedStatus === "UNQUALIFIED";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStatus === currentStatus) {
      onClose();
      return;
    }

    if (isClosing && !lostReasonCode) {
      setError("Choose a reason before closing this lead.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const res = await updateLeadStatusAction(
      leadId,
      selectedStatus,
      isClosing && lostReasonCode ? lostReasonCode : undefined,
      isClosing && lostReasonNotes.trim()
        ? lostReasonNotes.trim()
        : undefined,
    );
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to update status");
      return;
    }

    showToast(`Lead status updated to ${selectedStatus}`);
    setLostReasonCode("");
    setLostReasonNotes("");
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
            onChange={(e) => {
              setSelectedStatus(e.target.value as LeadStatus);
              setError(null);
            }}
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

        {isClosing && (
          <>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                Closure Reason
              </label>
              <Select
                value={lostReasonCode}
                onChange={(e) => {
                  setLostReasonCode(
                    e.target.value as Exclude<
                      LeadClosureReason,
                      "UNSPECIFIED"
                    >,
                  );
                  setError(null);
                }}
                disabled={isSubmitting}
              >
                <option value="">Choose a reason</option>
                {CLOSURE_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label
                htmlFor="closure-notes"
                className="block text-xs font-medium text-ink-secondary mb-1.5"
              >
                Notes (optional)
              </label>
              <textarea
                id="closure-notes"
                value={lostReasonNotes}
                onChange={(e) => setLostReasonNotes(e.target.value)}
                maxLength={1000}
                rows={3}
                disabled={isSubmitting}
                placeholder="Add useful context for the team..."
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink outline-none transition-colors focus:border-accent disabled:opacity-60"
              />
            </div>
          </>
        )}

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
            disabled={
              selectedStatus === currentStatus ||
              (isClosing && !lostReasonCode)
            }
          >
            Apply Status
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
