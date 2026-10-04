# Audit 06 — Keycloak (keycloak/keycloak)

**Current Status**: Complete
**Audit Snapshot**: Commit `10ffa4a1` (Branch: `main`)
**License**: Apache License 2.0
**Primary Research Goal**: Learn the industry-standard architecture for B2B enterprise Identity & Access Management (IAM), single sign-on (SSO) protocols, and active user federations.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: System administrators, corporate security teams, and application developers.
*   **Buyers**: Enterprise organizations, government ministries (PSUs), and financial institutions requiring centralized, secure credential control.

### Problems Solved
*   **Decentralized Credentials**: Preventing each app from storing passwords, reducing hacking vectors.
*   **Enterprise SSO Absence**: Allowing workers to log in once and gain secure access to all internal tools (ERP, payroll, email).
*   **Integration Obstacles with Corporate Directories**: Syncing users from Active Directory (AD) or LDAP without importing passwords into the application DB.

---

## 2. Repository Map & Codebase Anatomy

Managed as a large Java-based server:

*   **`core/`**: Shared interfaces, JSON representations of keys/tokens, and protocol adapters.
*   **`services/`**: Core implementation of OIDC, SAML, OAuth2, and database user federations.
*   **`model/`**: Storage engines (JPA/Hibernate) abstraction layers.
*   **`themes/`**: Custom stylesheets and templates for login and registration portals.

---

## 3. Technical Architecture & Dataflow

Keycloak runs on Quarkus (high-performance Java) and routes credentials via OIDC/OAuth2 protocols:

```
                      KEYCLOAK SSO FLOW
                      
   Client App (Verity) ──[Redirects]──> Keycloak Login Screen
                                               │
        ┌──────────────────────────────────────┴──────────────────────────────────────┐
        ▼ (Check Directory)                                                           ▼ (If authenticated)
  ┌─────────────┐                                                               ┌─────────────┐
  │ LDAP / AD / │                                                               │ Issue JWT   │
  │ Local DB    │                                                               │ Token       │
  └─────────────┘                                                               └──────┬──────┘
                                                                                       │
                                                                                       ▼
                                                                                ┌─────────────┐
                                                                                │ Verity reads│
                                                                                │ Roles inside│
                                                                                │  decrypted  │
                                                                                │  JWT token  │
                                                                                └─────────────┘
```

---

## 4. Domain & Data Architecture

### Realm-based Partitioning
*   **Realms**: Keycloak groups users and clients into Realms. A Realm is an isolated administrative namespace.
*   **User Federations**: Keycloak does not store passwords for users synced via LDAP/AD. It acts as an authentication proxy, querying the corporate directory at login time.
*   **User & Group Mappings**: Users are assigned to Groups, and Roles (permissions) are granted to Groups or directly to Users.

---

## 5. Identity & RBAC Model
*   **Role Mapping System**: Keycloak supports:
    *   *Realm Roles*: Global permissions across the system.
    *   *Client Roles*: Permissions specific to an app (e.g. `administrator` in Verity).
*   **Federated Identity Providers**: Connect to external OpenID Connect/SAML providers (e.g. Google Workspace, Azure AD).

---

## 6. Verity Relevance & Verdict

### ADOPT
*   **JWT Role-Decoding Integration**: Adopt JWT-token validation for user sessions. Instead of querying the database for roles on every page request, Verity should decrypt the JWT token, extract the assigned roles, and process permissions instantly.

### ADAPT
*   **Federated Identity Adapters**: Adapt the design pattern of delegating login challenges to external ID providers. The Verity Core should expose a pluggable configuration where clients can point user logins to Keycloak or Azure AD.

### REJECT
*   **Embedded Identity Registries**: Reject building identity federation (LDAP sync, SAML parsing) directly inside Verity's code. Keycloak is a dedicated tool; Verity will delegate SSO flows to Keycloak rather than writing custom federations from scratch.

---

## 7. Proposed Verity Changes

1.  **JWT Validation Middleware**: Add a NextAuth OIDC adapter module to Verity. If `SSO_ENABLED=true`, bypass NextAuth database checks and decrypt Keycloak-signed tokens to authenticate sessions.
2.  **External Role Mapping**: Map external IDP claims (e.g. `roles` list from Keycloak) to internal Verity permission roles at session startup.
