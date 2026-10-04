# Audit 11 — Cal.diy (calcom/cal.com)

**Current Status**: Complete
**Audit Snapshot**: Commit `176037d` (Branch: `main`)
**License**: MIT License (cal.diy fork analysis)
**Primary Research Goal**: Learn the architecture of availability schedules, timezone calculations, reservation status flows, and calendar integrations in a full Next.js/Prisma application.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Service professionals, consultants, enterprise teams, and scheduling administrators.
*   **Buyers**: Mid-market businesses and developers looking to self-host a booking and appointment framework without paying Calendly.

### Problems Solved
*   **Timezone Arithmetic Errors**: Managing schedule availability correctly when booking across different local timezones.
*   **Double-Booking & Conflict Checks**: Syncing with multiple calendars (Google, Outlook) in real time to verify open slots.

---

## 2. Technical Architecture & Dataflow

Cal.diy runs as a monorepo in the Next.js ecosystem:

*   **`apps/web/`**: Next.js web application housing the client booking views, admin dashboards, and API route handlers.
*   **`packages/prisma/`**: Canonical Prisma schema, database utilities, and repository query methods.
*   **`packages/core/`**: Shared scheduling logic (availability matching, timezone converters).

---

## 3. Domain & Data Architecture

### Core Booking Models
*   **Schedule & Booking**:
    *   *Availability*: A model defining days of the week and start/end millisecond offsets representing a user's working hours.
    *   *Booking*: A transactional record storing booking date-time ranges (stored in UTC), attendee details, and reservation status (`confirmed`, `cancelled`, `pending`).
*   **Concurrency Locks**: Prevents double-booking via transactional DB inserts check.

---

## 4. Verity Relevance & Verdict

### ADOPT
*   **Availability Time Slot Arithmetic**: Adopt the timezone-agnostic representation of slot availability (offsets from midnight stored in minutes/milliseconds) for scheduling dispatch tasks and warehouse shifts.
*   **Prisma Monorepo Decoupling**: Adopt packaging database schemas as a separate workspaces library (`packages/prisma`) so they can be consumed by both Next.js and external CLI seeds.

### ADAPT
*   **Webhook Dispatch System**: Adapt Cal's trigger logic (e.g. notify external systems when a booking is created) for Verity's delivery updates.

### REJECT
*   **Cal.com Proprietary Licenses**: Reject incorporating cal.com enterprise plugins directly due to licensing changes; limit research exclusively to MIT/Cal.diy structures.

---

## 5. Proposed Verity Changes

1.  **Extract Prisma Client Package**: Move `prisma/` folder into a workspace package to cleanly separate the schema definition from the Next.js routes.
2.  **UTC Storage Enforcements**: Guarantee that all date-time parameters are stored in UTC format in Postgres tables, handling timezone formatting exclusively at the client rendering layer.
