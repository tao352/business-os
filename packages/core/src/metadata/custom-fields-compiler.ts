import { z } from 'zod';
import type { CustomFieldDefinition } from '@business-os/types';

export class CustomFieldValidationError extends Error {
  public readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super(`Custom field validation failed: ${JSON.stringify(errors)}`);
    this.name = 'CustomFieldValidationError';
    this.errors = errors;
  }
}

/**
 * Compiles a single custom field definition into a dynamic Zod validator.
 */
export function compileCustomFieldZodType(definition: CustomFieldDefinition): z.ZodTypeAny {
  const { field_type, validation_rules, is_required } = definition;
  let schema: z.ZodTypeAny;

  switch (field_type) {
    case 'TEXT':
    case 'LONG_TEXT': {
      let strSchema = z.string();
      if (validation_rules.min !== undefined) {
        strSchema = strSchema.min(validation_rules.min);
      }
      if (validation_rules.max !== undefined) {
        strSchema = strSchema.max(validation_rules.max);
      }
      if (validation_rules.regex) {
        strSchema = strSchema.regex(new RegExp(validation_rules.regex));
      }
      schema = strSchema;
      break;
    }

    case 'NUMBER':
    case 'CURRENCY': {
      let numSchema = z.number({
        invalid_type_error: `Field '${definition.display_name}' must be a number`,
      });
      if (validation_rules.min !== undefined) {
        numSchema = numSchema.min(validation_rules.min);
      }
      if (validation_rules.max !== undefined) {
        numSchema = numSchema.max(validation_rules.max);
      }
      schema = numSchema;
      break;
    }

    case 'BOOLEAN': {
      schema = z.boolean({
        invalid_type_error: `Field '${definition.display_name}' must be a boolean`,
      });
      break;
    }

    case 'DATE':
    case 'DATETIME': {
      schema = z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: `Field '${definition.display_name}' must be a valid date or ISO timestamp`,
      });
      break;
    }

    case 'SINGLE_SELECT': {
      const allowedOptions = validation_rules.options || [];
      schema = z.string().refine((val) => allowedOptions.includes(val), {
        message: `Value must be one of: ${allowedOptions.join(', ')}`,
      });
      break;
    }

    case 'MULTI_SELECT': {
      const allowedOptions = validation_rules.options || [];
      schema = z.array(z.string()).refine((arr) => arr.every((item) => allowedOptions.includes(item)), {
        message: `All values must be from: ${allowedOptions.join(', ')}`,
      });
      break;
    }

    case 'EMAIL': {
      schema = z.string().email({
        message: `Field '${definition.display_name}' must be a valid email address`,
      });
      break;
    }

    case 'PHONE': {
      schema = z.string().min(5).max(30);
      break;
    }

    case 'URL': {
      schema = z.string().url({
        message: `Field '${definition.display_name}' must be a valid URL`,
      });
      break;
    }

    case 'RELATION': {
      schema = z.string().uuid({
        message: `Field '${definition.display_name}' must be a valid UUID record reference`,
      });
      break;
    }

    default:
      schema = z.unknown();
  }

  if (!is_required) {
    return schema.nullable().optional();
  }

  return schema;
}

/**
 * Compiles a list of tenant custom field definitions into a unified dynamic Zod schema.
 */
export function compileCustomDataSchema(
  definitions: CustomFieldDefinition[]
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const def of definitions) {
    if (def.is_active) {
      shape[def.field_key] = compileCustomFieldZodType(def);
    }
  }

  return z.object(shape).passthrough();
}

/**
 * Validates a payload against tenant custom field definitions.
 * Throws a formatted CustomFieldValidationError if any field is invalid.
 */
export function validateCustomData(
  definitions: CustomFieldDefinition[],
  data: Record<string, unknown>
): Record<string, unknown> {
  const schema = compileCustomDataSchema(definitions);
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorMap: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'root';
      errorMap[key] = issue.message;
    }
    throw new CustomFieldValidationError(errorMap);
  }

  return result.data;
}
