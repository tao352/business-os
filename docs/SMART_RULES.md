# SMART RULES AUTOMATION ENGINE

## 1. Concept & Philosophy
Customers are business people, not programmers. They should never be asked to configure JSON payloads, webhook nodes, or visual graph flowcharts.

The platform provides **Smart Rules**: pre-validated, parameterized **Trigger-Condition-Action (TCA)** templates.

---

## 2. Trigger-Condition-Action (TCA) Schema

### Triggers
* `lead.created`: Fires when a new lead enters the system (via Meta Ads, Webhook, Form, or Manual entry).
* `lead.status_changed`: Fires when a lead advances or reverts in status.
* `task.due`: Fires when a scheduled task reaches its deadline.
* `inactivity.exceeded`: Fires when a lead has not received contact activity for X hours/days.
* `visit.scheduled`: Fires when an in-person site visit is booked.
* `reservation.expiring`: Fires 24 hours before a unit reservation hold expires.

### Conditions (Evaluated in pure TypeScript)
* Comparisons: `equals`, `not_equals`, `greater_than`, `less_than`, `contains`.
* Target Fields: Core entity fields (e.g. `budget`, `project_id`, `status`) and tenant custom fields (`custom_data.*`).

### Actions
* `lead.assign_round_robin`: Assigns the lead to the next active agent on a specific team.
* `task.create`: Automatically creates a follow-up task with a dynamic due date.
* `notification.internal`: Dispatches an in-app alert, email, or manager escalation.
* `whatsapp.send_template`: Dispatches a pre-approved official Meta WhatsApp message template.

---

## 3. Execution Engine & Safety Guarantees

* **Asynchronous Queue:** Evaluated inside `apps/worker` via BullMQ backed by Redis.
* **Idempotency:** Every external event has an `idempotency_key` cached in Redis with a 24-hour TTL.
* **Historical Simulation (Dry-Run):**
  Admins can test any rule before activation. The worker fetches the last 100-500 matching historical records and outputs a detailed preview:
  `Matched 42 records. Would execute: Assign User (42x), Send WhatsApp (42x). Zero mutations performed.`
* **Recursion Guard:** Actions spawned by rules carry `is_system_action = true`. Rules triggered by system actions cannot exceed an execution hop depth of 3.
