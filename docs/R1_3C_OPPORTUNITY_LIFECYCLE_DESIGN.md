# R1.3C — Opportunity Lifecycle Design Proposal

> **Status:** PROPOSED — human approval required before implementation.
>
> **Scope:** Domain design only. No runtime behavior is changed by this document.
>
> **Base:** `main@0ec0774c838477c9ece9faa923fbe9d50b5dc6a1`.

## 1. Why R1.3C exists

R1.3A made **Opportunity** the Sales-domain commercial deal.

R1.3B linked Real Estate execution records to that Opportunity:

```text
Lead
  ↓
Opportunity
  ↓
Reservation
  ↓
Contract
```

The missing piece is lifecycle behavior.

Today:

- Reservation creation progresses the Lead to `RESERVED`, but does not move the linked Opportunity.
- Contract execution progresses the Lead to `CONTRACTED`, but does not move the linked Opportunity.
- Reservation expiry/cancellation does not define what should happen to the Opportunity.
- Opportunity `LOST` has no structured Opportunity-level loss reason.
- Analytics still count `WON` in forecast pipeline value because the query only excludes `LOST`.

R1.3C should make Opportunity lifecycle authoritative without making the Sales module depend on Real Estate.

## 2. Governing principles

1. **Lead is the person. Opportunity is the deal.**
2. **Only the linked Opportunity changes.** One Lead may own many Opportunities.
3. **Real Estate may call generic Sales lifecycle primitives. Sales must not import Real Estate concepts.**
4. **Operational events may advance a deal when they are authoritative evidence.**
5. **Operational events must not silently decide that a deal is lost.**
6. **No automatic backward stage movement.**
7. **Forecast value and realized revenue remain different truths.**
8. **Legacy unlinked Reservations/Contracts remain valid and must not receive guessed Opportunity links.**
9. **System-derived transitions are different from manual Sales permissions.**
10. **Every lifecycle transition must be auditable and tenant-safe.**

## 3. Canonical Opportunity stages

Keep the existing stages unchanged:

`DISCOVERY → PROPOSAL → NEGOTIATION → WON / LOST`

Open stages:

- `DISCOVERY`
- `PROPOSAL`
- `NEGOTIATION`

Closed stages:

- `WON`
- `LOST`

No new Real Estate-specific Opportunity stage should be added.

In particular, do **not** add stages such as:

- RESERVED
- CONTRACTED
- SITE_VISIT_BOOKED

Those are execution or vertical-specific concepts and would make Sales depend on Real Estate.

## 4. Reservation lifecycle rule

### Proposed decision

Creating a **linked Reservation** advances the linked Opportunity to `NEGOTIATION`, but only forward.

Behavior:

- `DISCOVERY` → `NEGOTIATION`
- `PROPOSAL` → `NEGOTIATION`
- `NEGOTIATION` → no-op
- `WON` → reject creation of a new linked Reservation
- `LOST` → reject creation of a new linked Reservation

Why `NEGOTIATION`?

A Reservation is stronger commercial evidence than discovery or a proposal. The customer and company are now committing inventory, often with a deposit. It is therefore a late open-pipeline event, but it is **not yet a win**.

### Unlinked Reservations

If `opportunity_id IS NULL`:

- preserve the existing Reservation flow;
- do not create an Opportunity automatically;
- do not infer an Opportunity from Lead;
- do not change any Opportunity stage.

## 5. Reservation expiry and cancellation

### Proposed decision

Reservation expiry or cancellation does **not** automatically:

- mark the Opportunity `LOST`;
- move it backward to `PROPOSAL` or `DISCOVERY`;
- alter another Opportunity belonging to the same Lead.

The linked Opportunity remains where it is, normally `NEGOTIATION`.

Why?

An expired/cancelled Reservation can mean many things:

- the customer wants another Unit;
- payment timing changed;
- inventory changed;
- the salesperson is still negotiating;
- the deal is genuinely lost.

Only the last case means `LOST`, and that is a commercial decision rather than an inventory event.

This follows **AI Executes, Human Decides**: the system records the event, but a human explicitly closes the Opportunity when the business decides the deal is dead.

## 6. Contract lifecycle rule

### Draft Contract

Creating a `DRAFT` Contract:

- does not change Opportunity stage;
- does not convert the Reservation;
- does not count as realized revenue.

This preserves current behavior.

### Executed Contract

A linked Contract becoming an executed state is authoritative evidence that the commercial Opportunity was won.

Proposed executed states for lifecycle purposes:

- `SIGNED`
- `ACTIVE`
- `COMPLETED`

Behavior:

- open Opportunity → `WON`
- already `WON` → no-op
- `LOST` → reject execution until the Opportunity is explicitly reopened or the link is corrected

`signContract()` therefore implies Opportunity `WON` when `opportunity_id` exists.

Creating a Contract directly with status `SIGNED`, `ACTIVE`, or `COMPLETED` should apply the same rule.

### Contract termination after a win

A later `TERMINATED` Contract does **not** retroactively change Opportunity from `WON` to `LOST`.

Reason:

The sale was won and a Contract was executed. Contract termination is a post-sale operational/financial event. Rewriting the original Opportunity outcome would corrupt historical sales conversion.

Revenue reversal/refund logic belongs to a future payments/accounting model, not Opportunity stage.

## 7. Manual Opportunity transitions

Manual movement is different from system-derived movement.

### Open stages

A user with Opportunity update permission may move between open stages:

- DISCOVERY
- PROPOSAL
- NEGOTIATION

This allows real sales processes to move backward or forward when negotiation changes.

### Closing

A user may close an open Opportunity as:

- `WON`
- `LOST`

Manual `LOST` requires a structured loss reason.

Manual `WON` remains allowed because the Sales domain must stay generic. Future non-Real-Estate verticals may not have a Real Estate Contract entity.

Realized revenue remains Contract-backed, so manually marking an Opportunity `WON` must never create revenue by itself.

### Reopening

Proposed initial rule:

- `LOST` may be explicitly reopened to an open stage through a dedicated lifecycle action.
- reopening clears closure metadata and records history.
- `WON` remains terminal in normal product flow.

Corrections to an incorrectly marked `WON` should be treated as an administrative data-correction workflow rather than ordinary salesperson stage movement.

## 8. Opportunity-level loss reason

Loss reason must belong to Opportunity, not Lead.

Add generic Sales-domain fields to the physical `deals` table through a new additive migration:

- `stage_entered_at TIMESTAMPTZ NULL`
- `closed_at TIMESTAMPTZ NULL`
- `lost_reason_code VARCHAR(...) NULL`
- `lost_reason_notes TEXT NULL`

Existing rows remain unknown where truth cannot be derived.

Do not backfill `stage_entered_at` from `updated_at`; that would guess when the current stage actually began.

Do not fabricate `closed_at` for legacy WON/LOST rows.

### Proposed generic loss reason codes

Keep codes reusable outside Real Estate:

- `PRICE`
- `FINANCING`
- `TIMING`
- `COMPETITOR`
- `NO_RESPONSE`
- `AVAILABILITY`
- `REQUIREMENTS_MISMATCH`
- `CUSTOMER_WITHDREW`
- `DUPLICATE`
- `OTHER`

Do not reuse Lead closure metadata as the Opportunity source of truth.

## 9. Opportunity stage history

Add a dedicated tenant-isolated history table:

`opportunity_stage_history`

It should record:

- organization ID
- Opportunity ID
- from stage
- to stage
- changed-by user ID when applicable
- transition source
- loss reason when applicable
- metadata
- timestamp

Examples of transition source:

- `manual`
- `reservation_created`
- `contract_executed`
- `opportunity_reopened`

The database table must use:

- FORCE RLS;
- tenant-safe composite foreign keys;
- append-only behavior for runtime callers.

This gives future analytics reliable stage velocity and conversion history.

## 10. Core service design

Introduce a generic transaction-aware Sales lifecycle primitive, conceptually:

`transitionOpportunityStageInTransaction(...)`

Responsibilities:

- lock and load the Opportunity;
- verify tenant/Lead expectations;
- enforce transition rules;
- update stage metadata;
- append stage history;
- append audit data;
- make same-stage operations idempotent.

The existing public `updateOpportunityStage()` becomes the **manual** wrapper and continues to assert Opportunity update permission.

Real Estate services call the internal transaction-aware lifecycle primitive after their own authorized business action.

### Why this matters for Finance

Finance currently has Contract permissions but does not have arbitrary Opportunity-update permission.

Signing a Contract must therefore be able to derive `WON` without granting Finance the ability to manually edit Sales Opportunities.

The rule is:

**authorization to execute a Contract authorizes the resulting system-derived Opportunity transition, not general Opportunity mutation.**

The internal lifecycle primitive must not become a public permission bypass.

## 11. Cross-domain dependency direction

Correct direction:

```text
Real Estate Contract/Reservation service
              ↓
generic Sales Opportunity lifecycle primitive
              ↓
Database
```

Incorrect direction:

```text
Sales Opportunity service
        ↓
Real Estate Reservation/Contract service
```

Sales must remain usable by future non-Real-Estate verticals.

## 12. Locking and concurrency

Existing Real Estate execution uses a deliberate lock order around Unit and Reservation.

R1.3C should append Opportunity locking after the Real Estate execution locks rather than introducing a reverse dependency.

Conceptually:

- Reservation flow: Unit → Reservation when relevant → Opportunity
- Contract flow: Unit → Reservation when relevant → Opportunity
- Manual Opportunity flow: Opportunity only

This avoids a cycle where Sales locks an Opportunity and then tries to enter Real Estate inventory locking.

All stage changes must remain inside the same database transaction as the authoritative Reservation/Contract event.

If the Opportunity transition fails, the execution transaction must roll back rather than leave contradictory partial state.

## 13. Multiple Opportunities on one Lead

Only the explicitly linked Opportunity changes.

Example:

Ahmed has:

- Opportunity A — apartment
- Opportunity B — shop

If Opportunity A receives a Reservation:

- A may advance to NEGOTIATION;
- B is untouched.

If Opportunity A's Contract is signed:

- A becomes WON;
- B remains open.

Lead compatibility status may still progress to `RESERVED` / `CONTRACTED` during the migration period, but Lead status is not forecast truth.

Reservation cancellation/expiry must not roll Lead status backward because one Lead may have other active or won Opportunities.

## 14. Analytics switch

As part of R1.3C, change forecast pipeline value to include **open Opportunities only**:

- DISCOVERY
- PROPOSAL
- NEGOTIATION

Explicitly exclude:

- WON
- LOST

This resolves the current bug where `stage != 'LOST'` also counts WON Opportunities.

### Realized revenue

Realized/booked sales value remains Contract-backed.

Recommended current Contract states counted as executed/booked:

- SIGNED
- ACTIVE
- COMPLETED

Exclude:

- DRAFT
- TERMINATED

This Contract-status normalization should have dedicated tests because it changes reporting semantics.

It must not use Opportunity `WON` value as realized revenue.

## 15. Compatibility behavior retained during R1.3C

Keep current transitional Lead behavior:

- Reservation creation may still progress Lead to `RESERVED`.
- Contract execution may still progress Lead to `CONTRACTED`.

Do not use those statuses for Opportunity forecasting.

Do not remove old Deal compatibility APIs.

Do not rename the physical `deals` table.

Do not rewrite historical migrations.

## 16. Database safety

New migration must be additive.

Proposed migration responsibilities:

1. add nullable Opportunity lifecycle metadata columns;
2. add Opportunity stage-history table;
3. FORCE RLS on history;
4. add tenant-safe composite FK to Opportunity;
5. grant only the runtime access required;
6. preserve existing legacy rows without guessed timestamps/reasons.

Existing migration `0023` must never be edited.

## 17. Required tests before merge

R1.3C implementation is not complete without tests for at least:

- Reservation linked to DISCOVERY → NEGOTIATION.
- Reservation linked to PROPOSAL → NEGOTIATION.
- Reservation linked to NEGOTIATION → no-op.
- Reservation linked to WON/LOST → rejected.
- Unlinked Reservation leaves Opportunities untouched.
- Reservation cancellation does not mark Opportunity LOST.
- Reservation expiry does not mark Opportunity LOST.
- Draft Contract leaves Opportunity unchanged.
- SIGNED Contract → linked open Opportunity WON.
- ACTIVE Contract creation → linked open Opportunity WON.
- COMPLETED Contract creation → linked open Opportunity WON, if direct completed creation remains supported.
- Executing Contract against LOST Opportunity → rejected.
- Executing Contract against already WON Opportunity → idempotent.
- Finance can sign an authorized Contract and trigger system-derived WON without receiving manual Opportunity-update permission.
- Manual LOST requires Opportunity loss reason.
- LOST reason is stored on Opportunity, not Lead.
- LOST reopen clears closure metadata and records history.
- only the linked Opportunity changes when a Lead owns multiple Opportunities.
- stage history is tenant-isolated.
- cross-tenant lifecycle attempts fail.
- pipeline value excludes WON and LOST.
- realized revenue remains Contract-backed.
- transaction rollback leaves no partial Reservation/Contract/Opportunity state if lifecycle transition fails.

Run the full existing tenant-isolation, migration, security, Vitest, Browser E2E, and Visual QA suites as well.

## 18. Explicit non-goals

R1.3C should not:

- physically rename `deals` to `opportunities`;
- remove transitional Lead statuses;
- automatically create Opportunities from Reservations;
- infer old Opportunity links;
- move Property Interest files yet;
- split read-models yet;
- redesign the entire Contract lifecycle;
- build accounting/refund recognition;
- create Real Estate-specific stages in Sales.

## 19. Proposed implementation slices after approval

To keep risk small:

1. **Lifecycle foundation**
   - additive migration;
   - Opportunity lifecycle helper;
   - stage metadata/history;
   - manual LOST/reopen semantics;
   - focused Sales tests.

2. **Real Estate event integration**
   - Reservation → NEGOTIATION;
   - Contract execution → WON;
   - terminal-state guards;
   - rollback/concurrency tests.

3. **Analytics correctness**
   - open Opportunity forecast only;
   - Contract-backed executed revenue-status normalization;
   - analytics tests.

4. **Full regression**
   - security/RLS;
   - all Vitest;
   - E2E;
   - Visual QA.

No implementation slice should merge independently if it leaves contradictory domain truth visible to users.
