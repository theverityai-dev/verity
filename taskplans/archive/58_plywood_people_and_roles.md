# Task 58 — People and roles in business language (slice 12)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: §1 (who uses what), §6 (people and roles).

## 1. The requirement is a prohibition

§6 does not ask for a role editor. One already existed, under HQ. What it asks
is that a **client** never sees `READ`, `MANAGE`, `DELETE` — that a role is
described by what a person does:

```
Sales Manager
✓ View catalogue          ✓ Change customer pricing
✓ View stock              ✓ View customer credit
✓ Create sales orders     ✓ Approve credit override
✕ Record supplier payment ✕ Manage tax settings
```

"Underneath, Verity can still map this into the existing permission system."

## 2. Why a rename does not work

The obvious shortcut is to relabel the verbs — call `Read` "View" and stop. It
fails immediately, and the reason is the design:

**A business activity is almost never one grant.** "Take sales orders" needs
`Create` on the order, and `Read` on the catalogue to pick a board, on stock to
know there is any, and on the customer to price it. A salesperson granted only
`Create sales_order` gets an authorization error part-way through an order, on a
screen that cannot tell them which of four permissions is missing.

So an activity is a **set** of grants, applied and withdrawn together.

## 3. Withdrawing is not the mirror of granting

The subtle part, and the reason this is a command rather than a loop in the UI.

Activities share grants — nearly all of them need `Read` on the product. Naively
revoking every grant behind "Take sales orders" would strip catalogue access
that "View catalogue" is still relying on, silently breaking an activity the
administrator did not touch and did not see change.

`setRoleActivity` therefore computes what the role still holds after the
activity is removed, and drops only those grants no remaining activity needs.

## 4. Where the vocabulary lives

`src/server/capabilities/plywood/activities.ts` — inside the capability, not the
platform.

The platform's model stays `Verb + Entity + Scope`, which is what lets a new
capability add entities without touching the ontology. This file is plywood's
own vocabulary for plywood's own entities. Another capability describes its
activities its own way and the platform learns neither. Putting this in
`administration.ts` would make the platform know what a plywood business does.

**Scope is not part of an activity.** Every grant is at `Organization` scope: the
activity says *what*, the membership's node says *where* (PLA-ORG-002). The same
activity on a role at the top of the tree reaches everything; on a Noida role it
reaches Noida. One vocabulary, and the tree decides the reach.

**The mapping never crosses to the browser.** The page receives activity keys and
booleans. If the client called `grantPermission` directly, §6's prohibition
would be cosmetic — the forbidden vocabulary would sit one view-source away.

## 5. Delivered

- `activities.ts` — 27 activities in five groups, `grantsFor`, `activitiesOf`,
  the `listBusinessActivities` query and the `setRoleActivity` command.
- `/people` — invite, see where each person works, assign a role.
- `/roles` — create a role, tick activities by group.
- Navigation: **People & Roles** under Administration.

## 6. Three things the screens refuse to hide

**A membership with no role.** It grants nothing, which is the correct
fail-closed behaviour and is also invisible — the person signs in and every
screen is empty. `/people` says so at the top, in a count.

**A partly-granted activity.** Held is all grants present; partial is some.
Rounding partial up would promise an ability that errors in use; rounding it
down would hide grants the role really has from the person reviewing it. It is
shown as its own state.

**Permissions no activity describes.** A role can hold grants made directly or
by another capability. The count is stated rather than omitted — a role editor
that silently ignores part of a role is a screen that lies about what someone
can do.

**A new role allows nothing** until activities are ticked. A role that starts
permissive is one nobody remembers to narrow.

## 7. Not in this slice

§1's mapping of role to a default home screen. Every role can reach everything
its permissions allow and the navigation already filters on those, so a default
landing page is a convenience rather than a control. It needs no new permission
work and is deferred rather than blocked.
