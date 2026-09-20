"use client";

import React, { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createLeadAction } from "@/lib/actions/lead-actions";

interface CreateLeadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateLeadDrawer({ isOpen, onClose }: CreateLeadDrawerProps) {
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await createLeadAction(formData);

    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || "Failed to create lead");
      return;
    }

    showToast("Lead created successfully");
    onClose();
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Lead"
      description="Add a prospect to the CRM pipeline."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Full Name *
          </label>
          <Input
            name="fullName"
            required
            placeholder="e.g. Omar Abdelrahman"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Phone Number *
          </label>
          <Input
            name="phone"
            type="tel"
            required
            placeholder="e.g. +201001234567"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Email Address
          </label>
          <Input
            name="email"
            type="email"
            placeholder="e.g. omar@example.com"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1.5">
            Acquisition Source
          </label>
          <Select name="source" defaultValue="MANUAL" disabled={isSubmitting}>
            <option value="MANUAL">Direct Entry (Manual)</option>
            <option value="WEBSITE">Company Website</option>
            <option value="META_ADS">Meta Lead Ads</option>
            <option value="WHATSAPP">WhatsApp Inbound</option>
            <option value="REFERRAL">Referral / Broker</option>
            <option value="COLD_CALL">Cold Outreach</option>
          </Select>
        </div>

        <div className="pt-4 flex items-center justify-end gap-3 border-t border-line">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Create Lead
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
