# Verity

Verity is a module-driven business operating platform designed for service-driven organizations.

The product goal is a platform where internal admins assemble reusable capabilities, packs, and system templates into configured tenant workspaces.

## Canonical Documentation & Authority Hierarchy

The canonical product and architecture authority lives in the following locations in the repository:

1. **[verity-bible/](./verity-bible/)** (The Verity Master Bible): The supreme product charter, constitutional laws, meta-model primitives, execution design, and UX constitution.
2. **[verity-spec/](./verity-spec/)** (The Master Platform Specification): Complete, trace-compliant requirements and capability registers.
3. **[implementation/](./implementation/)** (The Implementation Handoff Corpus): The detailed operational handoff for Claude Code/Fable containing the topological roadmap, bootstrap instructions, and conformance checks.

---

## Repository Layout (Greenfield Target)

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js App Router pages, layouts, and route groups mapping to the 4 Experience Shells |
| `src/server/` | Server-side business logic, database transactions, platform runtime, and capability folders |
| `src/components/` | Reusable UI design system components and layout structures |
| `prisma/schema.prisma` | Database schema Client and Datasource configurations |
| `verity-bible/` | The supreme product charter and core primitive specifications |
| `verity-spec/` | Complete operational requirements and specifications |
| `implementation/` | Implementation contracts and transition roadmaps |

---

## Start here

- **What is being worked on:** [taskplans/handoffs/README.md](./taskplans/handoffs/README.md)
- **How to contribute:** [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Rules, invariants and authority order:** [CLAUDE.md](./CLAUDE.md)
- **Deploying and operating it:** [deploy/](./deploy/)

## Related repository

[`verity-explore`](https://github.com/theverityai-dev/verity-explore) is the public marketing site
(theverityai.xyz) and brand films. It describes what Verity is for, business type by business type.
Treat its pages as positioning, not as proof that a capability is built here; the handoffs README and
`taskplans/00_STATUS_INDEX.md` record what is actually built.

## Development Commands

```bash
npm run typecheck
npm run lint
npm run test:pure   # no database required
npm run test        # full suite; requires a database
npm run build
```

Read `AGENTS.md` before editing UI. This repo uses Next.js 16; read the local Next.js docs in `node_modules/next/dist/docs/` before changing framework-sensitive code.
