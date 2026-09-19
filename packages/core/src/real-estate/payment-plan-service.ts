import {
  type Installment,
  type PaymentFrequency,
  type PaymentPlanInput,
  type PaymentScheduleResult,
  PaymentPlanInputSchema,
} from "@business-os/types";

function roundTwoDecimals(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function addMonthsToDate(dateStr: string, monthsToAdd: number): string {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr || "2026", 10);
  const month = parseInt(monthStr || "1", 10) - 1; // 0-indexed
  const day = parseInt(dayStr || "1", 10);

  const targetDate = new Date(Date.UTC(year, month + monthsToAdd, day));

  // Format as YYYY-MM-DD
  const yyyy = targetDate.getUTCFullYear();
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(targetDate.getUTCDate()).padStart(2, "0");
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

export function generatePaymentSchedule(
  rawInput: PaymentPlanInput,
): PaymentScheduleResult {
  const input = PaymentPlanInputSchema.parse(rawInput);

  const totalPrice = roundTwoDecimals(input.totalPrice);
  const downPaymentAmount = roundTwoDecimals(
    totalPrice * (input.downPaymentPercent / 100),
  );
  const deliveryPercent = input.deliveryPaymentPercent ?? 0;
  const deliveryAmount = roundTwoDecimals(totalPrice * (deliveryPercent / 100));

  const remainingForInstallments = roundTwoDecimals(
    totalPrice - downPaymentAmount - deliveryAmount,
  );

  const freqMonths = getFrequencyMonths(input.frequency);
  const installmentsPerYear = 12 / freqMonths;
  const installmentsCount = Math.round(
    input.installmentsYears * installmentsPerYear,
  );

  if (installmentsCount <= 0) {
    throw new Error("Installments count must be greater than zero");
  }

  const baseInstallmentAmount = roundTwoDecimals(
    remainingForInstallments / installmentsCount,
  );
  // To avoid floating-point drift, compute remainder for the last installment
  const totalBase = roundTwoDecimals(baseInstallmentAmount * installmentsCount);
  const drift = roundTwoDecimals(remainingForInstallments - totalBase);

  const schedule: Installment[] = [];
  let itemCounter = 1;

  // 1. Down Payment (Due on startDate)
  if (downPaymentAmount > 0) {
    schedule.push({
      installmentNumber: itemCounter++,
      dueDate: input.startDate,
      amount: downPaymentAmount,
      type: "DOWN_PAYMENT",
      percentage: input.downPaymentPercent,
    });
  }

  // 2. Regular Installments
  for (let i = 1; i <= installmentsCount; i++) {
    const dueDate = addMonthsToDate(input.startDate, i * freqMonths);
    // Add drift to the final installment so sum is mathematically exact
    const amount =
      i === installmentsCount
        ? roundTwoDecimals(baseInstallmentAmount + drift)
        : baseInstallmentAmount;

    schedule.push({
      installmentNumber: itemCounter++,
      dueDate,
      amount,
      type: "INSTALLMENT",
      percentage: roundTwoDecimals((amount / totalPrice) * 100),
    });
  }

  // 3. Delivery Payment (if applicable)
  if (deliveryAmount > 0) {
    const deliveryDueDate =
      input.deliveryDate ??
      addMonthsToDate(input.startDate, installmentsCount * freqMonths);
    schedule.push({
      installmentNumber: itemCounter++,
      dueDate: deliveryDueDate,
      amount: deliveryAmount,
      type: "DELIVERY",
      percentage: deliveryPercent,
    });
  }

  // 4. Maintenance Deposit (if specified)
  const maintenancePercent = input.maintenancePercent ?? 0;
  const maintenanceAmount = roundTwoDecimals(
    totalPrice * (maintenancePercent / 100),
  );
  if (maintenanceAmount > 0) {
    const maintenanceDueDate =
      input.deliveryDate ??
      addMonthsToDate(input.startDate, installmentsCount * freqMonths);
    schedule.push({
      installmentNumber: itemCounter++,
      dueDate: maintenanceDueDate,
      amount: maintenanceAmount,
      type: "MAINTENANCE",
      percentage: maintenancePercent,
    });
  }

  return {
    totalPrice,
    downPaymentAmount,
    installmentsCount,
    installmentAmount: baseInstallmentAmount,
    deliveryAmount,
    maintenanceAmount,
    schedule,
  };
}
