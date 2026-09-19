import { describe, it, expect, beforeAll } from 'vitest';
import {
  compileFilterGroup,
  compileSortToSql,
  compileSearchToSql,
  InvalidQueryFieldError,
  InvalidQueryOperatorError,
  queryEntities,
  createSavedView,
  listSavedViews,
  getSavedView,
  updateSavedView,
  deleteSavedView,
  executeSavedView,
  ViewForbiddenError,
  ViewNotFoundError,
} from '../packages/core/src/index.js';
import { registerUser, createOrganization } from '../packages/core/src/auth/auth-service.js';
import { inviteMember } from '../packages/core/src/permissions/member-service.js';
import { createLead } from '../packages/core/src/crm/lead-service.js';
import { createCustomFieldDefinition } from '../packages/core/src/metadata/custom-fields-service.js';
import type { TenantContext, FilterGroup } from '@business-os/types';

describe('Phase 6: Views, Virtualized Tables, Safe AST Filters & Search', () => {
  describe('Unit: Filter AST & Query Compiler Security', () => {
    it('should compile an empty filter group to TRUE', () => {
      const params: unknown[] = [];
      const res = compileFilterGroup('leads', { logical: 'AND', conditions: [] }, 1, params);
      expect(res.sql).toBe('TRUE');
      expect(params).toHaveLength(0);
    });

    it('should compile standard column EQUALS and CONTAINS', () => {
      const params: unknown[] = [];
      const group: FilterGroup = {
        logical: 'AND',
        conditions: [
          { field: 'status', operator: 'EQUALS', value: 'NEW' },
          { field: 'full_name', operator: 'CONTAINS', value: 'Ahmed' },
        ],
      };
      const res = compileFilterGroup('leads', group, 1, params);
      expect(res.sql).toBe('"status" = $1 AND "full_name" ILIKE $2');
      expect(params).toEqual(['NEW', '%Ahmed%']);
    });

    it('should compile BETWEEN operator with numeric parameters', () => {
      const params: unknown[] = [];
      const group: FilterGroup = {
        logical: 'AND',
        conditions: [{ field: 'created_at', operator: 'BETWEEN', value: ['2026-01-01', '2026-12-31'] }],
      };
      const res = compileFilterGroup('leads', group, 1, params);
      expect(res.sql).toBe('"created_at" BETWEEN $1 AND $2');
      expect(params).toEqual(['2026-01-01', '2026-12-31']);
    });

    it('should compile custom fields with numeric cast when value is a number', () => {
      const params: unknown[] = [];
      const group: FilterGroup = {
        logical: 'AND',
        conditions: [
          { field: 'budget', operator: 'GREATER_THAN_OR_EQUAL', value: 1500000, is_custom: true },
          { field: 'district', operator: 'EQUALS', value: 'New Cairo', is_custom: true },
        ],
      };
      const res = compileFilterGroup('leads', group, 1, params);
      expect(res.sql).toBe("NULLIF(custom_data->>'budget', '')::numeric >= $1 AND (custom_data->>'district') = $2");
      expect(params).toEqual([1500000, 'New Cairo']);
    });

    it('should compile nested AND / OR filter structures', () => {
      const params: unknown[] = [];
      const group: FilterGroup = {
        logical: 'AND',
        conditions: [
          {
            logical: 'OR',
            conditions: [
              { field: 'status', operator: 'EQUALS', value: 'NEW' },
              { field: 'status', operator: 'EQUALS', value: 'CONTACTED' },
            ],
          },
          { field: 'budget', operator: 'GREATER_THAN', value: 1000000, is_custom: true },
        ],
      };
      const res = compileFilterGroup('leads', group, 1, params);
      expect(res.sql).toBe(
        '("status" = $1 OR "status" = $2) AND NULLIF(custom_data->>\'budget\', \'\')::numeric > $3'
      );
      expect(params).toEqual(['NEW', 'CONTACTED', 1000000]);
    });

    it('should strictly reject malicious field names (SQL injection defense)', () => {
      const params: unknown[] = [];
      const maliciousGroup: FilterGroup = {
        logical: 'AND',
        conditions: [
          { field: 'full_name; DROP TABLE leads;--', operator: 'EQUALS', value: 'bad' },
        ],
      };
      expect(() => compileFilterGroup('leads', maliciousGroup, 1, params)).toThrow(
        InvalidQueryFieldError
      );
    });

    it('should strictly reject invalid operators', () => {
      const params: unknown[] = [];
      const invalidGroup = {
        logical: 'AND' as const,
        conditions: [
          { field: 'status', operator: 'MALICIOUS_OP' as any, value: 'bad' },
        ],
      };
      expect(() => compileFilterGroup('leads', invalidGroup, 1, params)).toThrow(
        InvalidQueryOperatorError
      );
    });

    it('should compile sort configurations safely', () => {
      const sortSql = compileSortToSql('leads', [
        { field: 'status', direction: 'asc' },
        { field: 'created_at', direction: 'desc', nulls: 'last' },
        { field: 'budget', direction: 'desc', is_custom: true },
      ]);
      expect(sortSql).toBe('ORDER BY "status" ASC, "created_at" DESC NULLS LAST, (custom_data->>\'budget\') DESC');
    });

    it('should compile entity search queries', () => {
      const params: unknown[] = [];
      const res = compileSearchToSql('leads', 'Mohamed', 1, params);
      expect(res.sql).toBe('("full_name" ILIKE $1 OR "phone" ILIKE $1 OR "email" ILIKE $1)');
      expect(params).toEqual(['%Mohamed%']);
    });
  });

  describe('Integration: Live Database Querying, Filtering, Views & Tenant Isolation', () => {
    let orgAContext: TenantContext;
    let salespersonAContext: TenantContext;
    let salespersonBContext: TenantContext;
    let orgBContext: TenantContext;

    beforeAll(async () => {
      const uniqueSuffix = Date.now().toString();

      // 1. Setup Tenant A
      const userA = await registerUser({
        email: `owner.a.${uniqueSuffix}@test.com`,
        password: 'Password123!',
        fullName: 'Owner Org A',
      });
      const orgA = await createOrganization({
        userId: userA.id,
        name: `Real Estate Org A ${uniqueSuffix}`,
        slug: `org-a-${uniqueSuffix}`,
      });

      orgAContext = {
        organizationId: orgA.id,
        userId: userA.id,
        role: 'OWNER',
        correlationId: `corr-a-${uniqueSuffix}`,
      };

      // 2. Setup Salesperson A in Tenant A
      const salesA = await inviteMember(orgAContext, {
        email: `sales.a.${uniqueSuffix}@test.com`,
        role: 'SALESPERSON',
        fullName: 'Salesperson A',
      });
      salespersonAContext = {
        organizationId: orgA.id,
        userId: salesA.userId,
        role: 'SALESPERSON',
        correlationId: `corr-sales-a-${uniqueSuffix}`,
      };

      // 3. Setup Salesperson B in Tenant A
      const salesB = await inviteMember(orgAContext, {
        email: `sales.b.${uniqueSuffix}@test.com`,
        role: 'SALESPERSON',
        fullName: 'Salesperson B',
      });
      salespersonBContext = {
        organizationId: orgA.id,
        userId: salesB.userId,
        role: 'SALESPERSON',
        correlationId: `corr-sales-b-${uniqueSuffix}`,
      };

      // 4. Setup Tenant B (Foreign Tenant)
      const userB = await registerUser({
        email: `owner.b.${uniqueSuffix}@test.com`,
        password: 'Password123!',
        fullName: 'Owner Org B',
      });
      const orgB = await createOrganization({
        userId: userB.id,
        name: `Foreign Org B ${uniqueSuffix}`,
        slug: `org-b-${uniqueSuffix}`,
      });
      orgBContext = {
        organizationId: orgB.id,
        userId: userB.id,
        role: 'OWNER',
        correlationId: `corr-b-${uniqueSuffix}`,
      };

      // 5. Define Custom Fields in Org A
      await createCustomFieldDefinition(orgAContext, {
        entityType: 'lead',
        fieldKey: 'budget',
        displayName: 'Budget',
        fieldType: 'NUMBER',
      });
      await createCustomFieldDefinition(orgAContext, {
        entityType: 'lead',
        fieldKey: 'district',
        displayName: 'District',
        fieldType: 'TEXT',
      });

      // 6. Seed Leads in Org A
      // Lead 1: Ahmed (Assigned to Salesperson A)
      await createLead(orgAContext, {
        fullName: 'Ahmed El-Masry',
        phone: '01011111111',
        email: 'ahmed@test.com',
        status: 'NEW',
        assignedUserId: salesA.userId,
        customData: { budget: 1500000, district: 'New Cairo' },
      });

      // Lead 2: Mona (Assigned to Salesperson A)
      await createLead(orgAContext, {
        fullName: 'Mona Zaki',
        phone: '01022222222',
        email: 'mona@test.com',
        status: 'CONTACTED',
        assignedUserId: salesA.userId,
        customData: { budget: 800000, district: 'Zayed' },
      });

      // Lead 3: Karim (Assigned to Salesperson B)
      await createLead(orgAContext, {
        fullName: 'Karim Abdelaziz',
        phone: '01033333333',
        email: 'karim@test.com',
        status: 'NEW',
        assignedUserId: salesB.userId,
        customData: { budget: 3000000, district: 'New Cairo' },
      });

      // Lead 4: Tamer (Assigned to Salesperson B)
      await createLead(orgAContext, {
        fullName: 'Tamer Hosny',
        phone: '01044444444',
        email: 'tamer@test.com',
        status: 'QUALIFIED',
        assignedUserId: salesB.userId,
        customData: { budget: 500000, district: 'Maadi' },
      });

      // 7. Seed Lead in Foreign Tenant B
      await createLead(orgBContext, {
        fullName: 'Secret Org B Buyer',
        phone: '01099999999',
        email: 'secret.b@test.com',
        status: 'NEW',
      });
    });

    it('should query all leads in Org A with pagination and total count', async () => {
      const res = await queryEntities(orgAContext, 'leads', { limit: 2, offset: 0 });
      expect(res.total).toBe(4);
      expect(res.data).toHaveLength(2);
      expect(res.hasMore).toBe(true);
    });

    it('should filter leads by status', async () => {
      const res = await queryEntities(orgAContext, 'leads', {
        filter_ast: {
          logical: 'AND',
          conditions: [{ field: 'status', operator: 'EQUALS', value: 'NEW' }],
        },
      });
      expect(res.total).toBe(2);
      const names = res.data.map((l: any) => l.full_name);
      expect(names).toContain('Ahmed El-Masry');
      expect(names).toContain('Karim Abdelaziz');
    });

    it('should filter leads by custom numeric field (budget >= 1,000,000)', async () => {
      const res = await queryEntities(orgAContext, 'leads', {
        filter_ast: {
          logical: 'AND',
          conditions: [{ field: 'budget', operator: 'GREATER_THAN_OR_EQUAL', value: 1000000, is_custom: true }],
        },
      });
      expect(res.total).toBe(2);
      const names = res.data.map((l: any) => l.full_name);
      expect(names).toContain('Ahmed El-Masry');
      expect(names).toContain('Karim Abdelaziz');
    });

    it('should execute complex nested filter: (district = New Cairo OR district = Zayed) AND budget > 2,000,000', async () => {
      const res = await queryEntities(orgAContext, 'leads', {
        filter_ast: {
          logical: 'AND',
          conditions: [
            {
              logical: 'OR',
              conditions: [
                { field: 'district', operator: 'EQUALS', value: 'New Cairo', is_custom: true },
                { field: 'district', operator: 'EQUALS', value: 'Zayed', is_custom: true },
              ],
            },
            { field: 'budget', operator: 'GREATER_THAN', value: 2000000, is_custom: true },
          ],
        },
      });
      expect(res.total).toBe(1);
      expect((res.data[0] as any).full_name).toBe('Karim Abdelaziz');
    });

    it('should search leads by full text term', async () => {
      const nameSearch = await queryEntities(orgAContext, 'leads', { search: 'Mona' });
      expect(nameSearch.total).toBe(1);
      expect((nameSearch.data[0] as any).full_name).toBe('Mona Zaki');

      const phoneSearch = await queryEntities(orgAContext, 'leads', { search: '0103333' });
      expect(phoneSearch.total).toBe(1);
      expect((phoneSearch.data[0] as any).full_name).toBe('Karim Abdelaziz');
    });

    it('should enforce Salesperson row-level isolation automatically during queries', async () => {
      // Salesperson A queries with NO filter
      const resA = await queryEntities(salespersonAContext, 'leads');
      expect(resA.total).toBe(2);
      const namesA = resA.data.map((l: any) => l.full_name);
      expect(namesA).toEqual(expect.arrayContaining(['Ahmed El-Masry', 'Mona Zaki']));
      expect(namesA).not.toContain('Karim Abdelaziz');
      expect(namesA).not.toContain('Tamer Hosny');

      // Salesperson B queries with NO filter
      const resB = await queryEntities(salespersonBContext, 'leads');
      expect(resB.total).toBe(2);
      const namesB = resB.data.map((l: any) => l.full_name);
      expect(namesB).toEqual(expect.arrayContaining(['Karim Abdelaziz', 'Tamer Hosny']));
      expect(namesB).not.toContain('Ahmed El-Masry');
    });

    it('should strictly guarantee zero data leakage between tenants', async () => {
      // Org B queries all leads
      const resB = await queryEntities(orgBContext, 'leads');
      expect(resB.total).toBe(1);
      expect((resB.data[0] as any).full_name).toBe('Secret Org B Buyer');

      // None of Org A's leads are present
      const names = resB.data.map((l: any) => l.full_name);
      expect(names).not.toContain('Ahmed El-Masry');
      expect(names).not.toContain('Karim Abdelaziz');
    });

    it('should create, retrieve, execute, update and delete a Saved View', async () => {
      // 1. Create View in Org A
      const savedView = await createSavedView(orgAContext, {
        entity_type: 'leads',
        name: 'High Budget New Cairo',
        description: 'Leads interested in New Cairo with budget >= 1M',
        filter_ast: {
          logical: 'AND',
          conditions: [
            { field: 'district', operator: 'EQUALS', value: 'New Cairo', is_custom: true },
            { field: 'budget', operator: 'GREATER_THAN_OR_EQUAL', value: 1000000, is_custom: true },
          ],
        },
        sort_config: [{ field: 'budget', direction: 'desc', is_custom: true }],
        columns_config: ['full_name', 'phone', 'budget', 'district'],
        is_default: true,
        is_shared: true,
      });

      expect(savedView.id).toBeDefined();
      expect(savedView.is_default).toBe(true);

      // 2. Retrieve View
      const fetched = await getSavedView(orgAContext, savedView.id);
      expect(fetched.name).toBe('High Budget New Cairo');

      // 3. Execute View
      const exec = await executeSavedView(orgAContext, savedView.id);
      expect(exec.result.total).toBe(2);
      expect((exec.result.data[0] as any).full_name).toBe('Karim Abdelaziz'); // Budget 3M > 1.5M
      expect((exec.result.data[1] as any).full_name).toBe('Ahmed El-Masry');

      // 4. Update View
      const updated = await updateSavedView(orgAContext, savedView.id, {
        name: 'VIP New Cairo Leads',
      });
      expect(updated.name).toBe('VIP New Cairo Leads');

      // 5. Delete View
      await deleteSavedView(orgAContext, savedView.id);
      await expect(getSavedView(orgAContext, savedView.id)).rejects.toThrow(ViewNotFoundError);
    });

    it('should enforce private vs shared view permissions within the same tenant', async () => {
      // Salesperson A creates a private view
      const privateView = await createSavedView(salespersonAContext, {
        entity_type: 'leads',
        name: 'My Secret Follow-ups',
        filter_ast: { logical: 'AND', conditions: [] },
        is_shared: false,
      });

      // Salesperson A can see it in list
      const viewsA = await listSavedViews(salespersonAContext, 'leads');
      expect(viewsA.some((v) => v.id === privateView.id)).toBe(true);

      // Salesperson B CANNOT see it in list
      const viewsB = await listSavedViews(salespersonBContext, 'leads');
      expect(viewsB.some((v) => v.id === privateView.id)).toBe(false);

      // Salesperson B attempting to fetch private view directly throws ViewForbiddenError
      await expect(getSavedView(salespersonBContext, privateView.id)).rejects.toThrow(
        ViewForbiddenError
      );

      // Salesperson B attempting to delete private view throws ViewForbiddenError
      await expect(deleteSavedView(salespersonBContext, privateView.id)).rejects.toThrow(
        ViewForbiddenError
      );
    });
  });
});
