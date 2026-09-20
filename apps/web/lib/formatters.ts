/**
 * Formats an ISO date or timestamp into a clean operational date string.
 * Example: "Sep 20, 2026" or "Today, 2:30 PM"
 */
export function formatDateTime(
  dateInput: string | Date | null | undefined,
): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "—";

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (isToday) {
    return `Today, ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });

  return `${dateStr}, ${timeStr}`;
}

/**
 * Formats a short date for tables.
 * Example: "Sep 20, 2026"
 */
export function formatDate(
  dateInput: string | Date | null | undefined,
): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats currency values cleanly.
 * Example: 2500000 -> "EGP 2,500,000"
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency = "EGP",
): string {
  if (amount === null || amount === undefined) return "—";
  return `${currency} ${amount.toLocaleString("en-US")}`;
}

/**
 * Formats phone numbers into standard readable spacing.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  return phone.trim();
}
