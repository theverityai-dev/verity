# Taskplan archive

Closed taskplans, moved here on 2026-10-04 by `git mv`, so file history follows each one
(`git log --follow`). Nothing was deleted or edited in the move.

## What is here

The R&D audits (02–13), the portable-runtime and enterprise-hardening program (24–44), the plywood
workflow program (45–71), and a few one-off handoffs and prompts (00, 102). Each was marked Done in
[`../00_STATUS_INDEX.md`](../00_STATUS_INDEX.md) with evidence at the time.

## What stayed in `taskplans/`

- Anything `CLAUDE.md` cites as authority: 17A, 18, 19, 20, 21, 22, 23, 27, 84, 103, 104.
- Living references: 14, 15, 16, 65, 67.
- Every task from 72 onward, including all pending, partial and proposed work.

## Finding a plan by its old path

A source comment or document may still say `taskplans/NN_name.md`. If that file is not in
`taskplans/`, it is here as `taskplans/archive/NN_name.md`. Citations in live source, skills and
deploy files were rewritten in the same change. Two places keep the old path on purpose:

- `prisma/migrations/*`: applied migrations are checksummed, so their comments are not edited.
- `taskplans/*` and `taskplans/archive/*`: plans are historical record; a stale cross-reference
  inside one is expected.

## Rules

- Archive a plan only when it is closed and nothing live treats it as authority.
- Move with `git mv`, and rewrite live citations in the same commit.
- Never delete a plan from here.
