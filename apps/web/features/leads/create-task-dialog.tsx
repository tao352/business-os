"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createFollowupTaskAction } from "@/lib/actions/lead-actions";
import type { TaskPriority } from "@business-os/core";

interface CreateTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
}

export function CreateTaskDialog({
  isOpen,
  onClose,
  leadId,
}: CreateTaskDialogProps) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  );
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;

    setIsSubmitting(true);
    setError(null);

    const res = await createFollowupTaskAction(
      leadId,
      title,
      dueDate,
      priority,
      description,
    );
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to schedule follow-up");
      return;
    }

    showToast("Follow-up task scheduled");
    setTitle("");
    setDescription("");
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Follow-up"
      description="Create a task with a deadline for this lead."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Task Title *
          </label>
          <Input
            required
            placeholder="e.g. Call to discuss 3-bedroom payment plan"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              Due Date *
            </label>
            <Input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              Priority
            </label>
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              disabled={isSubmitting}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Details / Instructions
          </label>
          <textarea
            rows={3}
            className="w-full p-2.5 text-xs bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            placeholder="Additional context or notes for the follow-up..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
            Schedule Task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
