import { withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  TimeTriggerEvaluationResult,
} from "@business-os/types";
import { triggerRules } from "./rule-runner.js";
import { expireStaleReservations } from "../real-estate/reservation-service.js";

/**
 * Scans for leads that have not received contact activity within the threshold window
 * and triggers `lead.inactivity_exceeded` Smart Rules.
 */
export async function scanInactivityExceededLeads(
  context: TenantContext,
  thresholdHours = 24,
): Promise<TimeTriggerEvaluationResult> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const startedAt = new Date();

    const staleLeadsRes = await tx.query(
      `SELECT * FROM leads
       WHERE organization_id = $1
         AND status IN ('NEW', 'CONTACTED')
         AND (
           (last_contacted_at IS NOT NULL AND last_contacted_at <= NOW() - ($2 || ' hours')::interval)
           OR (last_contacted_at IS NULL AND created_at <= NOW() - ($2 || ' hours')::interval)
         )
       ORDER BY created_at ASC`,
      [context.organizationId, String(thresholdHours)],
    );

    const leads = staleLeadsRes.rows;
    let rulesTriggeredTotal = 0;
    const details: Array<{ entityId: string; rulesFiredCount: number }> = [];

    for (const lead of leads) {
      const execs = await triggerRules(
        context,
        "lead.inactivity_exceeded",
        "lead",
        lead,
      );
      rulesTriggeredTotal += execs.length;
      details.push({ entityId: lead.id, rulesFiredCount: execs.length });
    }

    // Record scheduled job run
    await tx.query(
      `INSERT INTO scheduled_job_runs (
        organization_id, job_type, entities_evaluated, rules_triggered,
        status, started_at, completed_at
      ) VALUES ($1, 'INACTIVITY_CHECK', $2, $3, 'COMPLETED', $4, NOW())`,
      [context.organizationId, leads.length, rulesTriggeredTotal, startedAt],
    );

    return {
      jobType: "INACTIVITY_CHECK",
      entitiesEvaluated: leads.length,
      rulesTriggered: rulesTriggeredTotal,
      details,
    };
  });
}

/**
 * Scans for active unit reservations approaching expiration (within windowHours)
 * and triggers `reservation.expiring` Smart Rules.
 */
export async function scanExpiringReservations(
  context: TenantContext,
  windowHours = 24,
): Promise<TimeTriggerEvaluationResult> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const startedAt = new Date();

    const expiringRes = await tx.query(
      `SELECT * FROM reservations
       WHERE organization_id = $1
         AND status IN ('CONFIRMED', 'PENDING')
         AND expires_at IS NOT NULL
         AND expires_at >= NOW()
         AND expires_at <= NOW() + ($2 || ' hours')::interval
       ORDER BY expires_at ASC`,
      [context.organizationId, String(windowHours)],
    );

    const reservations = expiringRes.rows;
    let rulesTriggeredTotal = 0;
    const details: Array<{ entityId: string; rulesFiredCount: number }> = [];

    for (const res of reservations) {
      const execs = await triggerRules(
        context,
        "reservation.expiring",
        "reservation",
        res,
      );
      rulesTriggeredTotal += execs.length;
      details.push({ entityId: res.id, rulesFiredCount: execs.length });
    }

    await tx.query(
      `INSERT INTO scheduled_job_runs (
        organization_id, job_type, entities_evaluated, rules_triggered,
        status, started_at, completed_at
      ) VALUES ($1, 'RESERVATION_EXPIRING_CHECK', $2, $3, 'COMPLETED', $4, NOW())`,
      [
        context.organizationId,
        reservations.length,
        rulesTriggeredTotal,
        startedAt,
      ],
    );

    return {
      jobType: "RESERVATION_EXPIRING_CHECK",
      entitiesEvaluated: reservations.length,
      rulesTriggered: rulesTriggeredTotal,
      details,
    };
  });
}

/**
 * Scans for overdue tasks that have passed their deadline and are still uncompleted,
 * triggering `task.due` Smart Rules.
 */
export async function scanDueTasks(
  context: TenantContext,
): Promise<TimeTriggerEvaluationResult> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const startedAt = new Date();

    const dueTasksRes = await tx.query(
      `SELECT * FROM tasks
       WHERE organization_id = $1
         AND is_completed = false
         AND due_date <= NOW()
       ORDER BY due_date ASC`,
      [context.organizationId],
    );

    const tasks = dueTasksRes.rows;
    let rulesTriggeredTotal = 0;
    const details: Array<{ entityId: string; rulesFiredCount: number }> = [];

    for (const task of tasks) {
      const execs = await triggerRules(context, "task.due", "task", task);
      rulesTriggeredTotal += execs.length;
      details.push({ entityId: task.id, rulesFiredCount: execs.length });
    }

    await tx.query(
      `INSERT INTO scheduled_job_runs (
        organization_id, job_type, entities_evaluated, rules_triggered,
        status, started_at, completed_at
      ) VALUES ($1, 'TASK_DUE_CHECK', $2, $3, 'COMPLETED', $4, NOW())`,
      [context.organizationId, tasks.length, rulesTriggeredTotal, startedAt],
    );

    return {
      jobType: "TASK_DUE_CHECK",
      entitiesEvaluated: tasks.length,
      rulesTriggered: rulesTriggeredTotal,
      details,
    };
  });
}

/**
 * Protection B: Scheduled sweeper scanning and expiring all past-due active reservations.
 * Idempotently transitions expired reservations to EXPIRED, restores units to AVAILABLE,
 * and records execution in scheduled_job_runs.
 */
export async function sweepExpiredReservations(
  context: TenantContext,
): Promise<TimeTriggerEvaluationResult> {
  const startedAt = new Date();
  const result = await expireStaleReservations(context);

  await withTenantContext(context.organizationId, async (tx) => {
    await tx.query(
      `INSERT INTO scheduled_job_runs (
        organization_id, job_type, entities_evaluated, rules_triggered,
        status, started_at, completed_at
      ) VALUES ($1, 'RESERVATION_EXPIRATION_SWEEP', $2, 0, 'COMPLETED', $3, NOW())`,
      [context.organizationId, result.expiredCount, startedAt],
    );
  });

  return {
    jobType: "RESERVATION_EXPIRATION_SWEEP",
    entitiesEvaluated: result.expiredCount,
    rulesTriggered: 0,
    details: result.expiredReservationIds.map((id) => ({
      entityId: id,
      rulesFiredCount: 0,
    })),
  };
}

/**
 * Runs all time-based scheduled scanners sequentially for an organization.
 */
export async function runAllScheduledScanners(
  context: TenantContext,
): Promise<TimeTriggerEvaluationResult[]> {
  const r1 = await scanInactivityExceededLeads(context);
  const r2 = await scanExpiringReservations(context);
  const r3 = await sweepExpiredReservations(context);
  const r4 = await scanDueTasks(context);
  return [r1, r2, r3, r4];
}
