"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { addLeadNoteAction } from "@/lib/actions/lead-actions";

interface AddNoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
}

export function AddNoteDialog({ isOpen, onClose, leadId }: AddNoteDialogProps) {
  const { showToast } = useToast();
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsSubmitting(true);
    setError(null);

    const res = await addLeadNoteAction(leadId, content);
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to add note");
      return;
    }

    showToast("Note added to timeline");
    setContent("");
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Add Note"
      description="Record an interaction, customer detail, or update to the timeline."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <textarea
            rows={4}
            required
            className="w-full p-3 text-xs bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            placeholder="Type your note here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={isSubmitting}
          />
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
            Save Note
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
