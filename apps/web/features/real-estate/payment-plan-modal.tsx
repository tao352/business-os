"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/formatters";
import { calculatePaymentPlanAction } from "@/lib/actions/real-estate-actions";
import type {
  PaymentFrequency,
  PaymentScheduleResult,
} from "@business-os/types";
import { Calculator, Calendar, DollarSign } from "lucide-react";

interface PaymentPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  unitNumber?: string;
  projectName?: string;
  initialPrice?: number;
}

export function PaymentPlanModal({
  isOpen,
  onClose,
  unitNumber,
  projectName,
  initialPrice = 3000000,
}: PaymentPlanModalProps) {
  const [totalPrice, setTotalPrice] = useState(initialPrice);
  const [downPaymentPercent, setDownPaymentPercent] = useState(10);
  const [installmentsYears, setInstallmentsYears] = useState(5);
  const [frequency, setFrequency] = useState<PaymentFrequency>("QUARTERLY");
  const [deliveryPercent, setDeliveryPercent] = useState(10);
  const [maintenancePercent, setMaintenancePercent] = useState(8);
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0] || "2026-06-01",
  );

  const [scheduleResult, setScheduleResult] =
    useState<PaymentScheduleResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrice > 0) {
      setTotalPrice(initialPrice);
    }
  }, [initialPrice]);

  const calculate = useCallback(async () => {
    setIsCalculating(true);
    setCalcError(null);

    const res = await calculatePaymentPlanAction({
      totalPrice: Number(totalPrice),
      downPaymentPercent: Number(downPaymentPercent),
      installmentsYears: Number(installmentsYears),
      frequency,
      deliveryPaymentPercent: Number(deliveryPercent) || 0,
      maintenancePercent: Number(maintenancePercent) || 0,
      startDate,
    });

    if (!res.success || !res.data) {
      setCalcError(res.error || "Failed to calculate payment schedule");
      setIsCalculating(false);
      return;
    }

    setScheduleResult(res.data);
    setIsCalculating(false);
  }, [
    totalPrice,
    downPaymentPercent,
    installmentsYears,
    frequency,
    deliveryPercent,
    maintenancePercent,
    startDate,
  ]);

  useEffect(() => {
    if (isOpen) {
      calculate();
    }
  }, [isOpen, calculate]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Payment Plan Calculator ${unitNumber ? `— Unit #${unitNumber}` : ""}`}
      description={
        projectName
          ? `Authoritative financial schedule calculation for ${projectName}.`
          : "Authoritative financial schedule calculation based on developer terms."
      }
    >
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        {calcError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            {calcError}
          </div>
        )}

        {/* Input Parameters */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3.5 bg-surface-subtle border border-line rounded-lg">
          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
              Total Price (EGP)
            </label>
            <Input
              type="number"
              value={totalPrice}
              onChange={(e) => setTotalPrice(Number(e.target.value))}
              step="50000"
              min="10000"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
              Down Payment (%)
            </label>
            <Input
              type="number"
              value={downPaymentPercent}
              onChange={(e) => setDownPaymentPercent(Number(e.target.value))}
              step="1"
              min="0"
              max="100"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
              Period (Years)
            </label>
            <Input
              type="number"
              value={installmentsYears}
              onChange={(e) => setInstallmentsYears(Number(e.target.value))}
              step="1"
              min="1"
              max="20"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
              Frequency
            </label>
            <Select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PaymentFrequency)}
              className="text-xs"
            >
              <option value="MONTHLY">Monthly (شهري)</option>
              <option value="QUARTERLY">Quarterly (ربع سنوي)</option>
              <option value="SEMI_ANNUAL">Semi-Annual (نصف سنوي)</option>
              <option value="ANNUAL">Annual (سنوي)</option>
            </Select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
              Delivery (%)
            </label>
            <Input
              type="number"
              value={deliveryPercent}
              onChange={(e) => setDeliveryPercent(Number(e.target.value))}
              step="1"
              min="0"
              max="50"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
              Maintenance (%)
            </label>
            <Input
              type="number"
              value={maintenancePercent}
              onChange={(e) => setMaintenancePercent(Number(e.target.value))}
              step="1"
              min="0"
              max="20"
              className="font-mono text-xs"
            />
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={calculate}
            isLoading={isCalculating}
            className="gap-1.5"
          >
            <Calculator className="w-3.5 h-3.5" />
            Recalculate Schedule
          </Button>
        </div>

        {/* Schedule Summary Cards */}
        {scheduleResult && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-surface border border-line rounded-lg">
                <div className="text-[11px] text-ink-muted">Down Payment</div>
                <div className="text-sm font-bold font-mono text-ink mt-0.5">
                  {formatCurrency(scheduleResult.downPaymentAmount, "EGP")}
                </div>
                <div className="text-[10px] text-ink-faint mt-0.5">
                  {downPaymentPercent}% of total
                </div>
              </div>

              <div className="p-3 bg-surface border border-line rounded-lg">
                <div className="text-[11px] text-ink-muted">Installment</div>
                <div className="text-sm font-bold font-mono text-ink mt-0.5">
                  {formatCurrency(scheduleResult.installmentAmount, "EGP")}
                </div>
                <div className="text-[10px] text-ink-faint mt-0.5">
                  {scheduleResult.installmentsCount} {frequency.toLowerCase()}{" "}
                  payments
                </div>
              </div>

              <div className="p-3 bg-surface border border-line rounded-lg">
                <div className="text-[11px] text-ink-muted">Delivery</div>
                <div className="text-sm font-bold font-mono text-ink mt-0.5">
                  {formatCurrency(scheduleResult.deliveryAmount, "EGP")}
                </div>
                <div className="text-[10px] text-ink-faint mt-0.5">
                  {deliveryPercent}% on handover
                </div>
              </div>

              <div className="p-3 bg-surface border border-line rounded-lg">
                <div className="text-[11px] text-ink-muted">Maintenance</div>
                <div className="text-sm font-bold font-mono text-ink mt-0.5">
                  {formatCurrency(scheduleResult.maintenanceAmount, "EGP")}
                </div>
                <div className="text-[10px] text-ink-faint mt-0.5">
                  {maintenancePercent}% deposit
                </div>
              </div>
            </div>

            {/* Schedule Breakdown Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-ink">
                  Payment Schedule Breakdown ({scheduleResult.schedule.length}{" "}
                  installments)
                </h4>
              </div>

              <div className="border border-line rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-subtle sticky top-0 border-b border-line text-[11px] font-semibold text-ink-muted uppercase">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Due Date</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3 font-mono">Amount (EGP)</th>
                        <th className="py-2 px-3 text-right">% of Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-subtle">
                      {scheduleResult.schedule.map((item) => (
                        <tr
                          key={item.installmentNumber}
                          className="hover:bg-surface-subtle transition-colors"
                        >
                          <td className="py-2 px-3 text-ink-faint font-mono">
                            {item.installmentNumber}
                          </td>
                          <td className="py-2 px-3 text-ink font-medium">
                            {item.dueDate}
                          </td>
                          <td className="py-2 px-3">
                            <Badge
                              variant={
                                item.type === "DOWN_PAYMENT"
                                  ? "info"
                                  : item.type === "DELIVERY"
                                    ? "purple"
                                    : item.type === "MAINTENANCE"
                                      ? "warning"
                                      : "neutral"
                              }
                            >
                              {item.type}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 font-mono font-medium text-ink">
                            {formatCurrency(item.amount, "EGP")}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-ink-secondary">
                            {item.percentage}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end pt-4 border-t border-line-subtle mt-4">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
