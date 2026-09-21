import type {
  LeadFollowUpHealthRow,
  LeadFollowUpHealthState,
} from "@business-os/core";
import { formatDateTime } from "@/lib/formatters";

export const HEALTH_META: Record<
  LeadFollowUpHealthState,
  {
    label: string;
    shortLabel: string;
    dot: string;
    text: string;
    surface: string;
    border: string;
  }
> = {
  OVERDUE_NEXT_ACTION: {
    label: "Overdue next action",
    shortLabel: "Overdue",
    dot: "bg-rose-500",
    text: "text-rose-700",
    surface: "bg-rose-50",
    border: "border-rose-200",
  },
  NO_NEXT_ACTION: {
    label: "No next action",
    shortLabel: "Unplanned",
    dot: "bg-amber-500",
    text: "text-amber-800",
    surface: "bg-amber-50",
    border: "border-amber-200",
  },
  STALE_CONTACT: {
    label: "Stale contact",
    shortLabel: "Stale",
    dot: "bg-blue-500",
    text: "text-blue-700",
    surface: "bg-blue-50",
    border: "border-blue-200",
  },
  HEALTHY: {
    label: "Healthy",
    shortLabel: "Healthy",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    surface: "bg-emerald-50",
    border: "border-emerald-200",
  },
};

export function percentage(value: number, total: number) {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

export function getAttentionCopy(row: LeadFollowUpHealthRow) {
  switch (row.health) {
    case "OVERDUE_NEXT_ACTION":
      return row.nextActionAt
        ? `Due ${formatDateTime(row.nextActionAt)}`
        : "Follow-up overdue";
    case "NO_NEXT_ACTION":
      return "Schedule the next customer action";
    case "STALE_CONTACT":
      return row.lastContactedAt
        ? `Last contact ${formatDateTime(row.lastContactedAt)}`
        : "Customer has not been contacted yet";
    case "HEALTHY":
      return row.nextActionAt
        ? `Next action ${formatDateTime(row.nextActionAt)}`
        : "Execution on track";
  }
}
