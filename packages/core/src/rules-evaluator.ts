import type { RuleCondition } from '@business-os/types';

/**
 * Resolves a field value from an entity record, supporting nested paths (e.g. 'custom_data.budget')
 */
export function getFieldValue(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = record;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluates a single Smart Rule condition against an entity record in pure TypeScript.
 * Absolutely deterministic and safe — zero eval or dynamic code execution.
 */
export function evaluateCondition(
  record: Record<string, unknown>,
  condition: RuleCondition
): boolean {
  const actualValue = getFieldValue(record, condition.field);
  const targetValue = condition.value;

  switch (condition.operator) {
    case 'equals':
      return actualValue === targetValue;

    case 'not_equals':
      return actualValue !== targetValue;

    case 'greater_than':
      if (typeof actualValue === 'number' && typeof targetValue === 'number') {
        return actualValue > targetValue;
      }
      return false;

    case 'less_than':
      if (typeof actualValue === 'number' && typeof targetValue === 'number') {
        return actualValue < targetValue;
      }
      return false;

    case 'contains':
      if (typeof actualValue === 'string' && typeof targetValue === 'string') {
        return actualValue.toLowerCase().includes(targetValue.toLowerCase());
      }
      if (Array.isArray(actualValue)) {
        return actualValue.includes(targetValue);
      }
      return false;

    case 'is_empty':
      return (
        actualValue === null ||
        actualValue === undefined ||
        actualValue === '' ||
        (Array.isArray(actualValue) && actualValue.length === 0)
      );

    case 'is_not_empty':
      return (
        actualValue !== null &&
        actualValue !== undefined &&
        actualValue !== '' &&
        (!Array.isArray(actualValue) || actualValue.length > 0)
      );

    default:
      return false;
  }
}

/**
 * Evaluates an entire list of conditions. Returns true only if ALL conditions match.
 */
export function evaluateAllConditions(
  record: Record<string, unknown>,
  conditions: RuleCondition[]
): boolean {
  if (conditions.length === 0) {
    return true;
  }
  return conditions.every((cond) => evaluateCondition(record, cond));
}
