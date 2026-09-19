# DATABASE ARCHITECTURE & RELATIONAL SCHEMA

## 1. Core Principles

- **Single Database, Shared Schema:** All tenants share the same PostgreSQL database instance and schema.
- **Row-Level Security (RLS):** Every single tenant-aware table enforces RLS policies. The database itself guarantees data isolation.
- **No Dynamic DDL for Custom Fields:** Tenant custom fields are stored as typed metadata in `custom_field_definitions` and value payloads in `custom_data` JSONB columns on core tables.
- **Zero-Downtime Migrations:** All schema changes must follow the **Expand-Migrate-Contract** pattern.

---

## 2. Core Entities

### Organizations & Tenancy

- `organizations`: The root tenant boundary (`id`, `name`, `slug`, `plan`, `settings`, `created_at`).
- `users`: User identity accounts (`id`, `email`, `full_name`, `password_hash`, `created_at`).
- `organization_memberships`: Relationship linking users to organizations with a designated role (`id`, `organization_id`, `user_id`, `role`, `is_active`).

### Real Estate Vertical Entities

- `projects`: Master developments / buildings (`id`, `organization_id`, `name`, `location`, `description`, `custom_data`).
- `units`: Individual properties/apartments (`id`, `organization_id`, `project_id`, `unit_number`, `unit_type`, `gross_area`, `price`, `status`, `payment_plan_template`, `custom_data`).
- `leads`: Prospective buyers (`id`, `organization_id`, `full_name`, `phone`, `email`, `status`, `assigned_user_id`, `campaign_id`, `custom_data`, `created_at`).
- `activities`: Logged actions (calls, WhatsApp messages, emails) (`id`, `organization_id`, `lead_id`, `user_id`, `activity_type`, `notes`, `created_at`).
- `tasks`: Reminders and follow-up deadlines (`id`, `organization_id`, `lead_id`, `assigned_user_id`, `title`, `due_date`, `status`).
- `visits`: Scheduled or completed site visits (`id`, `organization_id`, `lead_id`, `project_id`, `scheduled_at`, `status`).
- `reservations`: Formal holds on units (`id`, `organization_id`, `lead_id`, `unit_id`, `deposit_amount`, `status`, `expires_at`).
- `contracts`: Executed purchase agreements (`id`, `organization_id`, `reservation_id`, `contract_value`, `signed_at`, `status`).

### Customization & Metadata Entities

- `custom_field_definitions`: Metadata describing custom fields (`id`, `organization_id`, `entity_type`, `field_key`, `display_name`, `field_type`, `validation_rules`, `is_required`, `display_order`).
- `custom_entities`: Partitioned table for custom tenant modules (`id`, `organization_id`, `module_key`, `data`, `created_at`).

### Automation & Observability

- `smart_rules`: Automation definitions (`id`, `organization_id`, `name`, `trigger_type`, `conditions`, `actions`, `safety_level`, `is_active`, `version`).
- `audit_logs`: Tamper-evident event log (`id`, `organization_id`, `actor_id`, `actor_type`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, `ip_address`, `created_at`).
- `outbox_events`: Transactional outbox queue for reliable asynchronous event delivery (`id`, `organization_id`, `event_type`, `payload`, `status`, `attempts`, `idempotency_key`, `created_at`).
- `schema_migrations`: Migration audit and SHA-256 verification log (`name`, `applied_at`, `checksum`).

---

## 3. Relational Isolation & Composite Foreign Keys

In addition to Row-Level Security (RLS), the database enforces relational tenant isolation at the engine schema level using **Composite Foreign Keys**:

- Every core table has a composite unique constraint: `UNIQUE (organization_id, id)`.
- All relational foreign keys enforce composite references: `FOREIGN KEY (organization_id, parent_id) REFERENCES parent_table(organization_id, id) ON DELETE CASCADE`.
- This guarantees that an entity belonging to Organization A cannot reference an entity belonging to Organization B, even if an application defect attempts to do so.
- Enforced across:
  - `units (organization_id, project_id) -> projects (organization_id, id)`
  - `visits (organization_id, lead_id) -> leads (organization_id, id)`
  - `visits (organization_id, project_id) -> projects (organization_id, id)`
  - `reservations (organization_id, lead_id) -> leads (organization_id, id)`
  - `reservations (organization_id, unit_id) -> units (organization_id, id)`
  - `contracts (organization_id, reservation_id) -> reservations (organization_id, id)`
  - `deals (organization_id, lead_id) -> leads (organization_id, id)`
  - `deals (organization_id, unit_id) -> units (organization_id, id)`
  - `activities (organization_id, lead_id) -> leads (organization_id, id)`
  - `tasks (organization_id, lead_id) -> leads (organization_id, id)`

---

## 4. Database Indexes Strategy

- Foreign keys and tenant keys are strictly indexed: `(organization_id, id)`.
- Composite foreign key pairs are indexed for high-performance join traversal: `(organization_id, parent_id)`.
- Frequently queried JSONB keys (e.g. `budget` or `finishing_type`) are indexed via expression indexes:
  ```sql
  CREATE INDEX idx_leads_custom_budget ON leads ((custom_data->>'budget')) WHERE custom_data->>'budget' IS NOT NULL;
  ```
- pgvector indexes use HNSW for fast approximate nearest neighbor search:
  ```sql
  CREATE INDEX idx_doc_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);
  ```
