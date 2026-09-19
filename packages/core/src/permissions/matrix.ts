import type { TenantRole } from '@business-os/types';
import type { Resource, Action } from './types.js';

export const ALL_RESOURCES: Resource[] = [
  'organization',
  'user',
  'member',
  'lead',
  'unit',
  'project',
  'campaign',
  'contract',
  'reservation',
  'smart_rule',
  'custom_field',
  'audit_log',
  'report',
];

export const ALL_ACTIONS: Action[] = [
  'create',
  'read',
  'read_all',
  'update',
  'update_all',
  'delete',
  'export',
  'manage',
];

export type RolePermissionMap = Record<TenantRole, Partial<Record<Resource, Action[]>>>;

export const ROLE_PERMISSIONS: RolePermissionMap = {
  OWNER: {
    organization: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    user: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    member: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    lead: ['create', 'read', 'read_all', 'update', 'update_all', 'delete', 'export', 'manage'],
    unit: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    project: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    campaign: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    contract: ['create', 'read', 'read_all', 'update', 'delete', 'export', 'manage'],
    reservation: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    smart_rule: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    custom_field: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    audit_log: ['read', 'read_all', 'export'],
    report: ['read', 'read_all', 'export'],
  },

  ADMIN: {
    organization: ['read', 'read_all', 'update', 'manage'], // cannot delete organization
    user: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    member: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    lead: ['create', 'read', 'read_all', 'update', 'update_all', 'delete', 'export', 'manage'],
    unit: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    project: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    campaign: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    contract: ['create', 'read', 'read_all', 'update', 'delete', 'export', 'manage'],
    reservation: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    smart_rule: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    custom_field: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    audit_log: ['read', 'read_all', 'export'],
    report: ['read', 'read_all', 'export'],
  },

  SALES_MANAGER: {
    lead: ['create', 'read', 'read_all', 'update', 'update_all', 'export'],
    unit: ['read', 'read_all'],
    project: ['read', 'read_all'],
    contract: ['read', 'read_all'],
    reservation: ['create', 'read', 'read_all', 'update'],
    report: ['read', 'read_all', 'export'],
    member: ['read', 'read_all'],
  },

  SALESPERSON: {
    lead: ['create', 'read', 'update'], // only assigned
    unit: ['read', 'read_all'],
    project: ['read', 'read_all'],
    reservation: ['create', 'read'], // only assigned
    report: ['read'],
  },

  MARKETING_MANAGER: {
    campaign: ['create', 'read', 'read_all', 'update', 'delete', 'manage'],
    lead: ['read', 'read_all', 'export'],
    report: ['read', 'read_all', 'export'],
    unit: ['read', 'read_all'],
    project: ['read', 'read_all'],
  },

  MARKETING_USER: {
    campaign: ['read', 'read_all'],
    report: ['read', 'read_all'],
    lead: ['read_all'], // aggregated only, cannot export or see individual lead contacts
  },

  OPERATIONS: {
    project: ['create', 'read', 'read_all', 'update'],
    unit: ['create', 'read', 'read_all', 'update', 'manage'],
    reservation: ['read', 'read_all', 'update'],
    lead: ['read', 'read_all'],
    report: ['read', 'read_all'],
  },

  FINANCE: {
    contract: ['create', 'read', 'read_all', 'update', 'manage', 'export'],
    reservation: ['read', 'read_all', 'update'],
    lead: ['read', 'read_all'],
    unit: ['read', 'read_all'],
    report: ['read', 'read_all', 'export'],
  },

  READ_ONLY: {
    lead: ['read', 'read_all'],
    unit: ['read', 'read_all'],
    project: ['read', 'read_all'],
    contract: ['read', 'read_all'],
    reservation: ['read', 'read_all'],
    report: ['read', 'read_all'],
  },
};
