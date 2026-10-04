# Policy Test Matrix

For each sensitive command, define:
`Actor × Tenant × Capability × Record ownership × State × Expected result`.

Include allow and deny cases. Include cross-tenant cases and attempted direct API misuse.

Policy tests must run against the same authorization primitives used by production paths.
