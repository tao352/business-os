"use client";

import React, { useState } from "react";
import type {
  OpenOpportunityStage,
  OpportunityLostReason,
  OpportunityStage,
} from "@business-os/core";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  reopenOpportunityAction,
  updateOpportunityStageAction,
} from "@/lib/actions/opportunity-actions";

const LOSS_REASONS: Array<{
  value: OpportunityLostReason;
  label: string;
}> = [
  { value: "PRICE", label: "Price" },
  { value: "FINANCING", label: "Financing" },
  { value: "TIMING", label: "Timing" },
  { value: "COMPETITOR", label: "Competitor" },
  { value: "NO_RESPONSE", label: "No response" },
  { value: "AVAILABILITY", label: "Availability" },
  { value: "REQUIREMENTS_MISMATCH", label: "Requirements mismatch" },
  { value: "CUSTOMER_WITHDREW", label: "Customer withdrew" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "OTHER", label: "Other" },
];

interface OpportunityStageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  opportunityId: string;
  currentStage: OpportunityStage;
}

export function OpportunityStageDialog({
  isOpen,
  onClose,
  opportunityId,
  currentStage,
}: OpportunityStageDialogProps) {
  const { showToast } = useToast();
  const [selectedStage, setSelectedStage] =
    useState<OpportunityStage>(currentStage);
  const [lostReasonCode, setLostReasonCode] = useState<
    OpportunityLostReason | ""
  >("");
  const [lostReasonNotes, setLostReasonNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLost = selectedStage === "LOST";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStage === currentStage) {
      onClose();
      return;
    }
    if (isLost && !lostReasonCode) {
      setError("Choose a loss reason before closing this Opportunity.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const res = await updateOpportunityStageAction(
      opportunityId,
      selectedStage,
      isLost && lostReasonCode ? lostReasonCode : undefined,
      isLost && lostReasonNotes.trim() ? lostReasonNotes.trim() : undefined,
    );
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to update Opportunity stage");
      return;
    }

    showToast(`Opportunity moved to ${selectedStage}`);
    setLostReasonCode("");
    setLostReasonNotes("");
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Change Opportunity Stage"
      description="Update the commercial deal stage. Execution events may also advance the stage automatically."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Sales Stage
          </label>
          <Select
            value={selectedStage}
            onChange={(e) => {
              setSelectedStage(e.target.value as OpportunityStage);
              setError(null);
            }}
            disabled={isSubmitting}
          >
            <option value="DISCOVERY">Discovery</option>
            <option value="PROPOSAL">Proposal</option>
            <option value="NEGOTIATION">Negotiation</option>
            <option value="WON">Won</option>
            <option value="LOST">Lost</option>
          </Select>
        </div>

        {isLost && (
          <>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                Loss Reason
              </label>
              <Select
                value={lostReasonCode}
                onChange={(e) => {
                  setLostReasonCode(
                    e.target.value as OpportunityLostReason | "",
                  );
                  setError(null);
                }}
                disabled={isSubmitting}
              >
                <option value="">Choose a reason</option>
                {LOSS_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                Notes (optional)
              </label>
              <textarea
                value={lostReasonNotes}
                onChange={(e) => setLostReasonNotes(e.target.value)}
                maxLength={1000}
                rows={3}
                disabled={isSubmitting}
                placeholder="Add useful context for the sales team..."
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
              selectedStage === currentStage || (isLost && !lostReasonCode)
            }
          >
            Apply Stage
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface ReopenOpportunityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  opportunityId: string;
}

export function ReopenOpportunityDialog({
  isOpen,
  onClose,
  opportunityId,
}: ReopenOpportunityDialogProps) {
  const { showToast } = useToast();
  const [targetStage, setTargetStage] =
    useState<OpenOpportunityStage>("DISCOVERY");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const res = await reopenOpportunityAction(opportunityId, targetStage);
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to reopen Opportunity");
      return;
    }

    showToast(`Opportunity reopened in ${targetStage}`);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Reopen Opportunity"
      description="Return this lost deal to the active sales pipeline."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Reopen Into
          </label>
          <Select
            value={targetStage}
            onChange={(e) =>
              setTargetStage(e.target.value as OpenOpportunityStage)
            }
            disabled={isSubmitting}
          >
            <option value="DISCOVERY">Discovery</option>
            <option value="PROPOSAL">Proposal</option>
            <option value="NEGOTIATION">Negotiation</option>
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
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Reopen Opportunity
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
