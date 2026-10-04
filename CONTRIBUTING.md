# Contributing to Verity

Read [CLAUDE.md](./CLAUDE.md) first. It carries the constitutional invariants, the authority
order and the stop conditions. This file is the short practical version for day-to-day work.

## Where to look

| Question | File |
|---|---|
| What is being worked on, in what order? | [taskplans/handoffs/README.md](./taskplans/handoffs/README.md) |
| Every taskplan ever written | [taskplans/00_STATUS_INDEX.md](./taskplans/00_STATUS_INDEX.md) |
| Why was it decided this way? | `verity-spec/17_decisions/adr/` |
| What is the platform required to do? | [verity-bible/](./verity-bible/), [verity-spec/](./verity-spec/) |
| How do I deploy and operate it? | [deploy/](./deploy/) and `docs/` |

## Setup

```bash
nvm use                    # Node version pinned in .nvmrc
npm ci
cp .env.example .env.local # fill in values; never commit real secrets
npx prisma generate
npm run dev
```

The runtime database role must be `verity_app` (`NOSUPERUSER NOBYPASSRLS`). The app refuses to
start against a role that bypasses row-level security. See "Database connection roles" in CLAUDE.md.

## Before you push

```bash
npm run typecheck
npm run lint
npm run test:pure          # no database needed
npm test                   # full suite; needs a database
```

A change that touches the schema also needs the migration-safety checks in
`.claude/skills/verity-migration-safety`. Never edit a migration that has been applied.

## Rules that are enforced, not suggested

- **Tenancy.** Every read and write is tenant-scoped through `withTenant()`. Tenant context comes
  from the authenticated actor, never from a request payload.
- **Write path.** Business mutations go through a registered Command. Do not write to the database
  from a page, component or route handler directly.
- **Boundaries.** No UI or hooks in `src/server/`. No Prisma imports in `src/app/` (except API
  routes) or `src/components/`.
- **Terminology.** Use the canonical words in CLAUDE.md (`Party`, `Location`, `Work`, ...).
- **Forbidden legacy patterns** (VEDA) are listed in CLAUDE.md and must not reappear.
- **Accent colour** is never hard-coded. It derives from `--accent-seed`.
- **Citations.** Each technology choice cites its authority, for example `Authority: V2-ADR-N`.

## Commits and history

- One logical change per commit, with the type prefix the log already uses: `feat`, `fix`, `docs`,
  `chore`, `test`, `refactor`.
- Do not mix a refactor with a behaviour change.
- Taskplans are historical record. Archive them (see `taskplans/archive/`); do not delete them.
- If you change active work, update `taskplans/handoffs/README.md` in the same commit.

## Open decisions

If a change needs an ADR that does not exist, or two authorities conflict, stop and raise it
rather than choosing silently. CLAUDE.md lists the stop conditions.
