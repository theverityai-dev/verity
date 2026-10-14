# D & S Electric Works — On-premise Deployment

**Status:** Draft v1, 2026-10-14. **Nothing here is built or proven yet.**
Authority: ADR-031 (deployment modes), ADR-020 (OIDC), ADR-032 (public origin), `deploy/docs/install.md`.

## 1. Requirement

The client keeps confidential data (customer specs, designs, test reports, costs) on a server in
his own office. Product-owner decision 2026-10-14: sign-in is also self-hosted, using **Keycloak**.

## 2. Mode, stated honestly

| Piece | Where it runs | Existing support |
|---|---|---|
| Verity web + scheduler | His server (Docker Compose) | Mode A package, `deploy/scripts/install.sh` |
| PostgreSQL 16 (`verity_app`, NOBYPASSRLS) | His server | Mode A package |
| Uploaded files (photos, test reports) | His server, bundled SeaweedFS | `VERITY_WITH_BUNDLED_STORAGE=1` |
| Identity | His server, Keycloak | **New.** Only Dex (lab) exists |
| TLS reverse proxy | His server | Documented, not shipped |

A fully private network is **Mode B**, which ADR-031 does not promise. It may be described to the
client as "being validated for D & S", never as supported, until a clean install, a restore and a
sign-in have been reproduced (ADR-031 constraint 2). Any claim names the mode.

Keycloak is a standard OIDC provider, so it adds no new provider binding, identity flow or data
surface (ADR-031 constraint 5): no new ADR. If work shows otherwise, stop and write one.

## 3. To build

1. `deploy/compose/docker-compose.keycloak.yml` overlay: Keycloak with its own database container,
   realm `dsew`, confidential client `verity-web` with PKCE, exact redirect URI, issuer reachable by
   both browsers and the web container.
2. Pre-provisioning script: create the Keycloak user, take its UUID `sub`, then run Verity's
   `provisionIdentity` with that id as `authUserId` (OIDC subjects must be UUIDs; accounts are never
   created from a token).
3. TLS: internal CA or his own certificate in front of both Verity and Keycloak (production refuses
   a non-https public origin, ADR-032).
4. Backup and restore rehearsal for Verity DB, Keycloak DB and the file store together.
5. Runbook for his IT person: install, upgrade, backup, restore, add a user, rotate secrets.

## 4. Validation gate (all required before "validated on Mode B for D&S")

Clean install on a fresh host from the package; sign-in through Keycloak; create a Job and upload a
file; backup; destroy; restore; sign in again and see the same data; no outbound network call at
runtime (checked, not assumed).

## 5. Facts needed from the client

OS and hardware of the server; whether it has any internet (needed once for images unless they are
delivered offline); internal hostname and whether he has a certificate or will trust an internal CA;
how many staff sign in; who backs up and where; whether devices on the shop floor (phones, tablets)
reach the server over office Wi-Fi only.

## 6. Risks

- Docker Desktop was not running on the build machine on 2026-10-14, so none of this is tested yet.
- Keycloak is a second stateful service the client must back up and patch.
- An air-gapped server (Mode C) is out of scope; image delivery would need its own plan.
