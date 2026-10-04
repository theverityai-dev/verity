# Claude Code Implementation Contract

You are implementing the AstraGrid demo on top of the existing Verity platform.

## Before coding
1. Audit the current Verity capability.
2. Search for existing equivalent primitives.
3. Read relevant migrations, policies, tests and UI patterns.
4. Record reuse/gap decision before creating new infrastructure.

## While coding
- Do not copy Odoo/ERPNext source code by default.
- Do not create parallel tenant/user/party abstractions.
- Keep business mutations behind the command boundary.
- Preserve RLS and authorization.
- Build one complete vertical slice at a time.
- Keep UI, state machine, API, data model and tests synchronized.

## Before completion
Run relevant tests, verify tenant/security paths, inspect UX states and demonstrate the complete workflow from seed data.
