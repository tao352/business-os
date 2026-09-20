"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { assignLeadAction } from "@/lib/actions/lead-actions";

interface ReassignLeadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  currentAssigneeId?: string | null;
  members: Array<{ user_id: string; full_name: string; role: string }>;
}

export function ReassignLeadDialog({
  isOpen,
  onClose,
  leadId,
  currentAssigneeId,
  members,
}: ReassignLeadDialogProps) {
  const { showToast } = useToast();
  const [targetUserId, setTargetUserId] = useState(
    currentAssigneeId || members[0]?.user_id || "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId) return;

    setIsSubmitting(true);
    setError(null);

    const res = await assignLeadAction(leadId, targetUserId);
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to reassign lead");
      return;
    }

    const assignedMember = members.find((m) => m.user_id === targetUserId);
    showToast(`Lead reassigned to ${assignedMember?.full_name || "agent"}`);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Reassign Lead"
      description="Transfer primary lead ownership to another team member."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Assign To
          </label>
          <Select
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            disabled={isSubmitting}
          >
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name} ({m.role})
              </option>
            ))}
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
            Confirm Reassignment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
