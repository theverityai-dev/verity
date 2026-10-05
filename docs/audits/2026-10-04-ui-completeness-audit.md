# UI completeness audit: which backend capabilities have screens (2026-10-04)

Run on `main` at `60bcd7e`, before the `/hr` screen was added. Read-only measurement. It answers the
product owner's concern that much of Verity's UI/UX is only partly built compared with Odoo and the
other systems in `D:\Code\R&D`.

## Method

For every capability under `src/server/capabilities/`, collect each registered command and query
key (`verity.<capability>.<name>`). A key counts as **wired** if its string appears in any file under
`src/app/(shell)`, `src/server/actions` or `src/components`. This is a proxy, not proof:

- It misses a command invoked through a computed or shared key.
- It counts a key as wired even if the screen only displays a result and never offers the action.
- Many "unwired" `list_*` and `get_*` queries are consumed through a different page, so they are not
  all real gaps.

Treat the numbers as a ranking of where to look, not a defect count.

## Result

| Capability | Keys | Unwired | Wired | Examples of unwired |
|---|---|---|---|---|
| outreach | 89 | 59 | 34% | set_team_co_leader, list_teams, list_available_parties |
| trading | 100 | 52 | 48% | list_business_activities, business_settings, onboarding_checklist |
| dinein | 30 | 14 | 53% | edit_menu_item, create_menu_variant, item_ready |
| manufacturing | 38 | 13 | 66% | list_batches, batch_detail, order_reservations |
| **hr** | 8 | **8** | **0%** | create_department, create_employee, set_employee_active |
| **inventory** | 8 | **8** | **0%** | create_item_group, create_item, set_item_active |
| **accounting** | 7 | **7** | **0%** | create_account, set_account_active, list_accounts |
| **billing** | 7 | **7** | **0%** | create_meter, set_meter_rate, record_meter_reading |
| plywood | 10 | 6 | 40% | preview_product_import, list_catalogue, stock_on_hand |
| **scheduling** | 5 | **5** | **0%** | create_resource, create_group, declare_unavailable |
| location | 8 | 4 | 50% | create_place, add_geofence, assign_user |
| asset | 4 | 3 | 25% | register, relocate, list |
| approval | 3 | 2 | 33% | request, list_pending |
| evidence | 2 | 1 | 50% | list_for |
| attendance | 5 | 0 | 100% | |
| complaint | 4 | 0 | 100% | |
| coupon | 3 | 0 | 100% | |
| crm | 2 | 0 | 100% | |
| finance | 5 | 0 | 100% | |
| loyalty | 2 | 0 | 100% | |
| recipe | 4 | 0 | 100% | |

## Findings

1. **Five capabilities are backend-only (0% wired):** hr, inventory, accounting, billing, scheduling.
   They were built ahead of demand under an earlier product-owner override (taskplans 72, 73, 77, 78
   and the scheduling slice) at "MVP scope", with commands and tests but no operator screens.
2. **Four registered nav links lead to a 404.** Checking every `href` in the capability navigation
   contributions against real pages found `/hr`, `/accounting`, `/billing` and `/inventory` with no
   page. `/hr` was fixed afterwards on `feat/hr-people-operations-ui` (commit `631dd5d`); the other
   three remain. This is the same defect class Task 117 fixed for Colonel Kebabz.
3. **Seven capabilities are fully wired** by this measure: attendance, complaint, coupon, crm,
   finance, loyalty, recipe. The Colonel Kebabz and PA-OMS client work is where the finished screens
   live, so those are the reference patterns for the rest.
4. **Large partially wired capabilities:** outreach (59 of 89) and trading (52 of 100) hold most of
   the absolute gap. A manual pass is needed to separate real missing screens from queries consumed
   elsewhere.
5. **Wired is not complete.** Even a fully wired capability can lack record detail pages, an activity
   log, confirmation with a reason on destructive actions, setup screens, or a responsive and
   accessible pass. The 12-row bar in `docs/reference/module-completeness-bar.md` defines the full
   standard; this audit measures only rows 1, 3, 4 and 5 roughly.

## Not measured

- Screen quality (hierarchy, density, copy), responsive behaviour, accessibility, loading and error
  states. Task 116 owns the visual matrix and is still in progress.
- Whether each wired screen works with real data. Only some Outreach, Senior and Junior paths have
  been live-verified.
- The comparison with Odoo and the other `D:\Code\R&D` systems at feature level. That needs a module
  by module read of the reference systems and was not done here.

## Follow-up

- Build `/inventory`, `/accounting`, `/billing` and wire `scheduling`, then close the nav 404s.
- Make nav-reachability (every `href` has a page) and command wiring an automated check.
- Manually triage the outreach and trading unwired keys.
- Scope: completing screens for the five backend-only capabilities is finishing existing work, not a
  new capability, but `CLAUDE.md` does not say so explicitly. Needs a product-owner confirmation.
