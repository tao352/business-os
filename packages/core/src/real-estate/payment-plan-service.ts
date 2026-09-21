import {
  type Installment,
  type PaymentFrequency,
  type PaymentPlanInput,
  type PaymentScheduleResult,
  PaymentPlanInputSchema,
} from "@business-os/types";

/**
 * Convert major currency units (e.g. EGP) to integer minor currency units (piastres).
 * 1 EGP = 100 piastres.
 */
function toPiastres(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert integer minor currency units (piastres) back to major currency units (EGP).
 */
function toMajorCurrency(piastres: number): number {
  return piastres / 100;
}

/**
 * Adds months to an ISO date string (YYYY-MM-DD) with strict month-end clamping.
 * Prevents JavaScript Date.UTC rollover bugs (e.g. Jan 31 -> March 3).
 *
 * Examples:
 * - 2026-01-31 + 1 month  => 2026-02-28
 * - 2028-01-31 + 1 month  => 2028-02-29 (leap year)
 * - 2026-03-31 + 1 month  => 2026-04-30
 * - 2026-12-31 + 1 month  => 2027-01-31
 */
export function addMonthsClamped(dateStr: string, monthsToAdd: number): string {
  const parts = dateStr.split("-");
  const year = parseInt(parts[0] || "2026", 10);
  const month = parseInt(parts[1] || "1", 10) - 1; // 0-indexed
  const originalDay = parseInt(parts[2] || "1", 10);

  const totalMonths = month + monthsToAdd;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // Day 0 of the month following targetMonth returns the last day of targetMonth
  const maxDaysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(originalDay, maxDaysInTargetMonth);

  const yyyy = targetYear;
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(clampedDay).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getFrequencyMonths(freq: PaymentFrequency): number {
  switch (freq) {
    case "MONTHLY":
      return 1;
    case "QUARTERLY":
      return 3;
    case "SEMI_ANNUAL":
      return 6;
    case "ANNUAL":
      return 12;
  }
}

/**
 * Generates an installment payment schedule using integer piastre arithmetic.
 * Guarantees the invariant: downPayment + sum(installments) + deliveryPayment === unitPrice
 * exactly to the piastre, allocating integer drift to the final installment.
 */
export function generatePaymentSchedule(
  rawInput: PaymentPlanInput,
): PaymentScheduleResult {
  const input = PaymentPlanInputSchema.parse(rawInput);

  // Convert contract components to integer piastres (1 EGP = 100 piastres)
  const totalPiastres = toPiastres(input.totalPrice);
  const downPaymentPiastres = Math.round(
    (totalPiastres * input.downPaymentPercent) / 100,
  );
  const deliveryPercent = input.deliveryPaymentPercent ?? 0;
  if (input.downPaymentPercent + deliveryPercent >= 100) {
    throw new Error(
      "Combined down payment and delivery payment percentages must be strictly less than 100%",
    );
  }
  const deliveryPiastres = Math.round((totalPiastres * deliveryPercent) / 100);

  // Principal balance remaining for periodic installments
  const remainingInstallmentsPiastres =
    totalPiastres - downPaymentPiastres - deliveryPiastres;

  if (remainingInstallmentsPiastres <= 0) {
    throw new Error(
      "Remaining balance for installments must be strictly greater than zero",
    );
  }

  const freqMonths = getFrequencyMonths(input.frequency);
  const installmentsPerYear = 12 / freqMonths;
  const installmentsCount = Math.round(
    input.installmentsYears * installmentsPerYear,
  );

  if (installmentsCount <= 0) {
    throw new Error("Installments count must be greater than zero");
  }

  // Integer division with remainder distribution on the last installment
  const baseInstallmentPiastres = Math.floor(
    remainingInstallmentsPiastres / installmentsCount,
  );

  if (baseInstallmentPiastres <= 0) {
    throw new Error("Installment amount must be greater than zero");
  }

  const remainderPiastres =
    remainingInstallmentsPiastres - baseInstallmentPiastres * installmentsCount;

  const schedule: Installment[] = [];
  let itemCounter = 1;

  // 1. Down Payment (Due on startDate)
  if (downPaymentPiastres > 0) {
    schedule.push({
      installmentNumber: itemCounter++,
      dueDate: input.startDate,
      amount: toMajorCurrency(downPaymentPiastres),
      type: "DOWN_PAYMENT",
      percentage: Number(
        ((downPaymentPiastres / totalPiastres) * 100).toFixed(2),
      ),
    });
  }

  // 2. Regular Installments
  for (let i = 1; i <= installmentsCount; i++) {
    const dueDate = addMonthsClamped(input.startDate, i * freqMonths);
    // Allocate the integer remainder to the final installment so sum is exact to 1 piastre
    const currentPiastres =
      i === installmentsCount
        ? baseInstallmentPiastres + remainderPiastres
        : baseInstallmentPiastres;

    schedule.push({
      installmentNumber: itemCounter++,
      dueDate,
      amount: toMajorCurrency(currentPiastres),
      type: "INSTALLMENT",
      percentage: Number(((currentPiastres / totalPiastres) * 100).toFixed(2)),
    });
  }

  // 3. Delivery Payment (if applicable)
  if (deliveryPiastres > 0) {
    const deliveryDueDate =
      input.deliveryDate ??
      addMonthsClamped(input.startDate, installmentsCount * freqMonths);
    schedule.push({
      installmentNumber: itemCounter++,
      dueDate: deliveryDueDate,
      amount: toMajorCurrency(deliveryPiastres),
      type: "DELIVERY",
      percentage: deliveryPercent,
    });
  }

  // 4. Maintenance / Auxiliary Deposit (explicitly separated from contract principal)
  const maintenancePercent = input.maintenancePercent ?? 0;
  const maintenancePiastres = Math.round(
    (totalPiastres * maintenancePercent) / 100,
  );
  if (maintenancePiastres > 0) {
    const maintenanceDueDate =
      input.deliveryDate ??
      addMonthsClamped(input.startDate, installmentsCount * freqMonths);
    schedule.push({
      installmentNumber: itemCounter++,
      dueDate: maintenanceDueDate,
      amount: toMajorCurrency(maintenancePiastres),
      type: "MAINTENANCE",
      percentage: maintenancePercent,
    });
  }

  return {
    totalPrice: toMajorCurrency(totalPiastres),
    downPaymentAmount: toMajorCurrency(downPaymentPiastres),
    installmentsCount,
    installmentAmount: toMajorCurrency(baseInstallmentPiastres),
    deliveryAmount: toMajorCurrency(deliveryPiastres),
    maintenanceAmount: toMajorCurrency(maintenancePiastres),
    schedule,
  };
}
