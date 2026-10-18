# DSEW on-premises: Stage 0 decisions and infrastructure survey

Status: DRAFT for the product owner and DSEW, 2026-10-18. Stage 0 and Stage 1 are authorised; Stages 2 to 7 are accepted
in principle only. Companion to `deployment-readiness-audit.md` and `onprem-stage1-evidence.md`.

Nothing here is decided by engineering. Where an answer needs DSEW or the product owner it is **BLOCKED**, with a
recommended default marked **PROPOSED**. A default is a starting point for a conversation, not an assumption the
pilot may build on.

## A. Decisions

| # | Decision | Recommended default | Owner | Status |
|---|---|---|---|---|
| S0-1 | **Host.** A Linux VM on the Windows Server 2019 host (Hyper-V), a separate small Linux machine, or something else | Separate Linux machine or Hyper-V VM, whichever the survey shows is permitted and supportable; **no claim** until the survey and a clean-host install pass | DSEW IT, product owner | BLOCKED (survey) |
| S0-2 | **Identity.** Self-hosted Keycloak, administrator-provisioned users only for the pilot | Keycloak; accounts created by an administrator in Keycloak, then linked to Verity by the operator provisioning step. **No in-app Keycloak adapter** in the pilot | Product owner | APPROVED in principle (design); implementation after Stage 1 review |
| S0-3 | **Recovery objectives (RPO and RTO).** How much data DSEW can lose, and how long it can be without the system | RPO 24 h (nightly backup) tightening to 4 h if DSEW wants; RTO 8 h (one working day). Neither is measured yet | DSEW | BLOCKED (DSEW to state; engineering to measure) |
| S0-4 | **Key and secret custody.** Where the env file, session secret, database passwords, object-store keys and the credential-encryption key live | Env file mode 0600 owned by a named administrator on the host; one sealed offline copy held by DSEW's owner; no KMS or Vault in the pilot (hardening.md section 8 says that needs its own ADR) | Product owner, DSEW owner | PROPOSED |
| S0-5 | **Failure behaviour.** What Verity does when the identity provider, scheduler or object store is down | See section B. Today: all three make `/api/ready` fail. Proposed: keep liveness separate, report each dependency, and keep serving authorised sessions when only the IdP is down | Product owner | PROPOSED (code change **not** authorised yet) |
| S0-6 | **Session revocation.** An account disabled in Keycloak keeps a valid Verity session until it expires | Accept up to 1 h idle / 8 h maximum for the pilot (current defaults), or shorten them; a disabled account cannot sign in again | Product owner, DSEW | PROPOSED; behaviour from code reading, not yet tested (see Stage 1 evidence) |
| S0-7 | **Network policy.** Is runtime outbound traffic from the Verity host forbidden, allow-listed, or unrestricted | Forbidden at runtime; installs and upgrades pull images from a connected build step that DSEW approves; the host firewall enforces it | DSEW IT | BLOCKED |
| S0-8 | **Upgrade and patch ownership.** Who patches the host, Docker, Postgres, Keycloak, SeaweedFS, and how often | A named DSEW administrator with Verity operator support; images are digest-pinned so every refresh is a deliberate, tested change | DSEW, product owner | BLOCKED |
| S0-9 | **Off-host backup destination and who owns it** | An encrypted copy on a second machine or disk outside the server room, plus the sealed key copy from S0-4 | DSEW | BLOCKED |
| S0-10 | **Support access.** How Verity staff reach the system for support | No standing remote access; time-boxed, client-approved sessions | Product owner, DSEW | BLOCKED |
| S0-11 | **Public surfaces.** Whether the self-order, passport and guest pages are exposed beyond the LAN | Not exposed; LAN only for the pilot | DSEW | PROPOSED |

## B. Failure-behaviour policy (proposal for S0-5)

Verity today answers `/api/health` (liveness, no I/O) and `/api/ready` (database, RLS, scheduler heartbeat, the identity
provider's OIDC discovery, and the object store). Any failing dependency makes the whole of `/api/ready` fail, and the
compose healthcheck points at `/api/ready`.

Proposed policy, to be agreed before it is built:

| Dependency down | New sign-in | Existing session | Reads and writes | Files | Readiness |
|---|---|---|---|---|---|
| Identity provider | Fails with a clear message | Continues until it expires | Work | Work | `degraded`, not `not ready` |
| Object store | Works | Works | Work | Upload and download fail with a clear message | `degraded` |
| Scheduler | Works | Works | Work | Work | `degraded` after the grace period; background jobs stop |
| Database | Fails | Fails | Fail | Fail | `not ready` |

This needs a small change to readiness reporting and the compose healthcheck. It is **not** authorised and is not built;
the Stage 1 evidence records current behaviour only.

## C. Infrastructure survey (to collect from DSEW; none of this is known)

Server make and model; CPU, RAM, free disk and storage health (RAID); Windows Server edition and build; whether the
Hyper-V role is installed, licensed and may be used; what else runs on the server; whether a separate Linux machine is
acceptable; network layout, router and firewall, address plan, internal DNS name; whether devices (phones, tablets) reach
the server over office Wi-Fi only; UPS runtime and shutdown behaviour; current backup method and last tested restore;
number of staff and concurrent users; remote-access constraints; whether the server has internet, and whether the firewall
can block outbound traffic; who administers it; whether DSEW can issue or trust an internal certificate authority on every
PC and phone.

## D. Not decided and not claimed

- Windows Server 2019 compatibility: **not verified**.
- The target host: **not surveyed**.
- Mode C (fully offline): **deferred**.
- Any recovery objective: **not measured**.
