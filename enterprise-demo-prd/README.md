# AstraGrid Operations — Enterprise Demo PRD

## Purpose
Build one coherent fictional enterprise deployment that demonstrates PlotArmour/Verity's ability to understand and implement a serious operational business system. This is a demo client, not a real customer's requirement set.

## Demo client
**AstraGrid Services Pvt. Ltd.** is a fictional multi-region field operations, maintenance and project-services organization.

## Product
**AstraGrid Operations Cloud — powered by Verity**

The application must feel client-specific and operational rather than like a generic admin panel or disconnected ERP clone.

## Core business story
Lead → Opportunity → Quote → Sales Order → Procurement → Receipt → Inventory → Work Order → Field Execution → Evidence → Quality/Exception → Approval → Invoice → Payment Status → Reporting → Audit.

## Folder contract
- `00-context`: product intent, demo company, boundaries and assumptions.
- `01-prd`: functional/non-functional product requirements.
- `02-tdd`: technical architecture and implementation boundaries.
- `03-user-flows`: complete user journeys and the flagship demo story.
- `04-design`: UX/UI system, navigation and page standards.
- `05-data-model`: canonical entities and relationships.
- `06-api`: command/query/integration contracts.
- `07-state-machines`: explicit lifecycle states and transitions.
- `08-policies`: security, authorization and business rules.
- `09-adr`: architectural decisions.
- `10-execution`: phased implementation and evidence plan.
- `11-rnd`: Odoo/ERPNext/reference-system research.
- `12-founder-decisions`: decisions requiring founder approval.
- `13-launch-plan`: seeded demo deployment and operator runbook.
- `14-qa`: functional, security, UX and regression gates.
- `superpowers`: differentiated capabilities added only after the core workflow is stable.

## Non-negotiable rules
1. Existing Verity implementation/invariants outrank this PRD for platform behavior.
2. Reuse existing Verity primitives before creating duplicates.
3. Odoo and ERPNext are research references. Their source code is not copied into Verity by default.
4. Never present demo dataset numbers as scale/capacity claims.
5. `UNKNOWN` is valid; never invent implementation, evidence, integrations or compliance.
6. A feature is not complete if its UI exists but the workflow, persistence, authorization, audit and tests are incomplete.
7. Do not build a huge ERP clone merely to increase module count.
8. One complete end-to-end business workflow outranks ten disconnected modules.
