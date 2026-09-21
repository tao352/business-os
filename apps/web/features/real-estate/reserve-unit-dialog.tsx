"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { reserveUnitAction } from "@/lib/actions/real-estate-actions";
import { formatCurrency } from "@/lib/formatters";
import { ShieldCheck } from "lucide-react";

interface ReserveUnitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  leadName?: string;
  unit: {
    id: string;
    unit_number: string;
    project_name: string;
    price: number;
    currency?: string;
  };
  onSuccess?: () => void;
}

export function ReserveUnitDialog({
  isOpen,
  onClose,
  leadId,
  leadName,
  unit,
  onSuccess,
}: ReserveUnitDialogProps) {
  const [depositAmount, setDepositAmount] = useState(
    Math.round(unit.price * 0.05),
  );
  const [holdDays, setHoldDays] = useState(3);
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Compute expiration ISO date
    const expiresAt = new Date(
      Date.now() + holdDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const res = await reserveUnitAction({
      leadId,
      unitId: unit.id,
      depositAmount: Number(depositAmount),
      currency: unit.currency || "EGP",
      expiresAt,
      paymentMethod,
      notes: notes.trim() || undefined,
    });

    if (!res.success) {
      setError(res.error || "Failed to place reservation");
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    onClose();
    if (onSuccess) onSuccess();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!isLoading) {
          onClose();
          setError(null);
        }
      }}
      title="Place Unit Reservation (حجز وحدة)"
      description={`Lock inventory for Unit #${unit.unit_number} in ${unit.project_name}.`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Unit Info Card */}
        <div className="p-3 bg-surface-subtle border border-line rounded-lg text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-ink-muted">Client:</span>
            <span className="font-semibold text-ink">{leadName || "Lead"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Development:</span>
            <span className="font-medium text-ink">{unit.project_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Unit Number:</span>
            <span className="font-semibold text-ink">#{unit.unit_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Total Price:</span>
            <span className="font-mono font-bold text-ink">
              {formatCurrency(unit.price, unit.currency || "EGP")}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Deposit Amount (EGP) <span className="text-red-500">*</span>
            </label>
            <Input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(Number(e.target.value))}
              step="1000"
              min="1000"
              required
              disabled={isLoading}
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              Hold Period (Days)
            </label>
            <Select
              value={holdDays}
              onChange={(e) => setHoldDays(Number(e.target.value))}
              disabled={isLoading}
              className="text-xs"
            >
              <option value="2">2 Days (48 Hours)</option>
              <option value="3">3 Days (72 Hours)</option>
              <option value="7">7 Days (1 Week)</option>
              <option value="14">14 Days (2 Weeks)</option>
            </Select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Payment Method
          </label>
          <Select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            disabled={isLoading}
            className="text-xs"
          >
            <option value="BANK_TRANSFER">Bank Transfer (تحويل بنكي)</option>
            <option value="CHEQUE">Cheque (شيك بنكي)</option>
            <option value="CASH">Cash (نقدي)</option>
            <option value="ONLINE_PAYMENT">
              Online / POS Card (بطاقة دفع)
            </option>
          </Select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Reservation Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Deposit reference number or customer agreement details..."
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
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isLoading}
            className="gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Confirm Reservation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
