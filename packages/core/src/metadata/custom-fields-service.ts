import { withTenantContext } from '@business-os/database';
import type {
  TenantContext,
  CustomFieldDefinition,
  CustomFieldType,
  ValidationRules,
} from '@business-os/types';
import { assertPermission } from '../permissions/checker.js';
import { recordAuditLog } from '../crm/audit-helper.js';

const RESERVED_FIELD_KEYS = new Set([
  'id',
  'organization_id',
  'created_at',
  'updated_at',
  'status',
  'full_name',
  'phone',
  'email',
  'source',
  'campaign_id',
  'assigned_user_id',
  'last_contacted_at',
  'custom_data',
]);

export interface CreateCustomFieldInput {
  entityType: 'lead' | 'unit' | 'project' | 'deal' | 'contact';
  fieldKey: string;
  displayName: string;
  fieldType: CustomFieldType;
  validationRules?: ValidationRules;
  isRequired?: boolean;
  displayOrder?: number;
}

export interface UpdateCustomFieldInput {
  displayName?: string;
  validationRules?: ValidationRules;
  isRequired?: boolean;
  displayOrder?: number;
  isActive?: boolean;
}

/**
 * Creates a new custom field definition for a tenant entity without dynamic DDL migrations.
 */
export async function createCustomFieldDefinition(
  context: TenantContext,
  input: CreateCustomFieldInput
): Promise<CustomFieldDefinition> {
  assertPermission(context, 'create', 'custom_field');

  const keyNormalized = input.fieldKey.trim().toLowerCase();

  // 1. Validate field_key format and reserved keywords
  if (!/^[a-z0-9_]{2,50}$/.test(keyNormalized)) {
    throw new Error(
      "Field key must be lowercase alphanumeric with underscores (2-50 characters), e.g. 'finishing_type'"
    );
  }

  if (RESERVED_FIELD_KEYS.has(keyNormalized)) {
    throw new Error(`Field key '${keyNormalized}' is a reserved system keyword`);
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    // 2. Check for duplicate key in this organization for this entity type
    const existing = await tx.query(
      `SELECT id FROM custom_field_definitions
       WHERE organization_id = $1 AND entity_type = $2 AND field_key = $3`,
      [context.organizationId, input.entityType, keyNormalized]
    );

    if (existing.rows.length > 0) {
      throw new Error(
        `Field '${keyNormalized}' already exists for entity '${input.entityType}'`
      );
    }

    const res = await tx.query(
      `INSERT INTO custom_field_definitions (
        organization_id, entity_type, field_key, display_name,
        field_type, validation_rules, is_required, display_order, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      RETURNING *`,
      [
        context.organizationId,
        input.entityType,
        keyNormalized,
        input.displayName.trim(),
        input.fieldType,
        JSON.stringify(input.validationRules || {}),
        input.isRequired || false,
        input.displayOrder || 0,
      ]
    );

    const definition = res.rows[0];

    await recordAuditLog(tx, context, {
      action: 'CREATE',
      entityType: 'custom_field',
      entityId: definition.id,
      afterState: definition,
    });

    return definition;
  });
}

/**
 * Lists all active custom field definitions for a tenant and entity type.
 */
export async function listCustomFieldDefinitions(
  context: TenantContext,
  entityType: string
): Promise<CustomFieldDefinition[]> {
  assertPermission(context, 'read', 'custom_field');

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `SELECT * FROM custom_field_definitions
       WHERE organization_id = $1 AND entity_type = $2 AND is_active = true
       ORDER BY display_order ASC, created_at ASC`,
      [context.organizationId, entityType]
    );

    return res.rows;
  });
}

/**
 * Updates an existing custom field definition.
 * Field key and entity type are immutable to preserve historical data integrity.
 */
export async function updateCustomFieldDefinition(
  context: TenantContext,
  fieldId: string,
  input: UpdateCustomFieldInput
): Promise<CustomFieldDefinition> {
  assertPermission(context, 'update', 'custom_field');

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query(
      'SELECT * FROM custom_field_definitions WHERE id = $1',
      [fieldId]
    );

    if (existing.rows.length === 0) {
      throw new Error('Custom field definition not found');
    }

    const current = existing.rows[0];

    const updatedDisplayName = input.displayName !== undefined ? input.displayName.trim() : current.display_name;
    const updatedRules = input.validationRules !== undefined ? JSON.stringify(input.validationRules) : current.validation_rules;
    const updatedRequired = input.isRequired !== undefined ? input.isRequired : current.is_required;
    const updatedOrder = input.displayOrder !== undefined ? input.displayOrder : current.display_order;
    const updatedActive = input.isActive !== undefined ? input.isActive : current.is_active;

    const res = await tx.query(
      `UPDATE custom_field_definitions
       SET display_name = $1, validation_rules = $2, is_required = $3,
           display_order = $4, is_active = $5
       WHERE id = $6
       RETURNING *`,
      [updatedDisplayName, updatedRules, updatedRequired, updatedOrder, updatedActive, fieldId]
    );

    const updated = res.rows[0];

    await recordAuditLog(tx, context, {
      action: 'UPDATE',
      entityType: 'custom_field',
      entityId: fieldId,
      beforeState: current,
      afterState: updated,
    });

    return updated;
  });
}

/**
 * Deactivates or removes a custom field definition.
 */
export async function deleteCustomFieldDefinition(
  context: TenantContext,
  fieldId: string
): Promise<{ success: boolean }> {
  assertPermission(context, 'delete', 'custom_field');

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query(
      'SELECT * FROM custom_field_definitions WHERE id = $1',
      [fieldId]
    );

    if (existing.rows.length === 0) {
      throw new Error('Custom field definition not found');
    }

    const current = existing.rows[0];

    await tx.query('DELETE FROM custom_field_definitions WHERE id = $1', [fieldId]);

    await recordAuditLog(tx, context, {
      action: 'DELETE',
      entityType: 'custom_field',
      entityId: fieldId,
      beforeState: current,
    });

    return { success: true };
  });
}
