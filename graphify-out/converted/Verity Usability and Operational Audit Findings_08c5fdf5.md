<!-- converted from Verity Usability and Operational Audit Findings.docx -->

Verity Usability and Operational Audit Findings
Interaction based assessment of the current local application
Assessment date  6 September 2026
Application  Verity local development environment at localhost:3000
Repository state  main was up to date with origin/main and one local commit ahead
Method  Manual browser interaction only; no product source inspection and no product changes
Status  Incomplete because database failure blocks every authenticated workflow

# Executive summary
Release conclusion  Verity is not currently usable for an authenticated end user or HQ operative. Valid credentials initiate authentication, but the application then fails while resolving organizational memberships because Prisma cannot establish its configured Supabase database connection. The same failure prevents direct access to Overview and produces an HTTP 500 after a long wait.
Audit limitation  This is a verified blocker report, not a complete audit of the authenticated product. Operations, Assets, Workforce, Tasks, Analytics, Reports, Settings, role boundaries, record creation, editing, deletion, reporting, exports, and persistence could not be exercised. These areas must be audited after database service is restored.
# Scope and test method
The assessment treated Verity as a real product. Testing was performed through the rendered browser interface at standard desktop and compact mobile sizes. It covered initial routing, protected-route behavior, theme controls, required-field validation, invalid credentials, password visibility, keyboard entry points, recovery navigation, responsive fit, authentication submission, runtime failure behavior, reload behavior, and direct Overview access.
The repository was pulled before testing. Git reported that main was already current with origin/main. No application files were edited. The supplied credentials are intentionally omitted from this report.
# Observed user journeys
Unauthenticated arrival
Opening the application redirects to Sign in. The page presents a marketing preview, theme controls, email and password fields, a password visibility control, password recovery, and a primary Sign in action.
Invalid submission
Required-field validation is browser-native. A rejected authentication attempt displays “Those credentials were not accepted.” Both fields are cleared and focus falls away from the form.
Password recovery
Selecting Forgot password opens /reset-password, which renders the stock Next.js 404 response.
Valid authentication
The supplied account starts authentication and the interface changes to the disabled “Signing in…” state. After about 18 seconds, the request fails with HTTP 500 because membership resolution cannot query the database.
Protected navigation
Opening /overview in the authenticated browser session fails in the shared application shell with the same Prisma database initialization error.

# Detailed findings
## F01  Database failure blocks authenticated use
Severity  P0 Blocking    Location  Authentication and application shell
Evidence
Valid authentication cannot resolve memberships. Sign in and direct Overview access terminate in a PrismaClientInitializationError because the configured Supabase pooler database connection cannot be established. A TCP connectivity check to the advertised host and port succeeded, so the failure requires database configuration and connection-level diagnosis.
Impact
Every authenticated user and HQ operative is prevented from entering the product. No operational task can be completed.
Recommendation
Validate the active database URL, credentials, TLS requirements, Supabase project state, pooler mode and region, and Prisma pooler compatibility. Add a startup readiness check that fails clearly before serving the application. Do not release until membership lookup works reliably.
Retest criterion
A valid account signs in, membership data resolves, Overview loads, and repeated cold and warm requests complete without Prisma errors.
## F02  Password recovery route is missing
Severity  P0 Blocking    Location  Sign in and /reset-password
Evidence
Forgot password links to /reset-password, but that route returns the stock Next.js 404 page.
Impact
A locked-out user cannot recover access and has no alternative support or identity-provider path.
Recommendation
Implement the complete recovery journey, including request confirmation, invalid and expired token states, rate-limit feedback, successful reset, and return to Sign in. If recovery is externally managed, link to the correct provider instead.
Retest criterion
The link reaches a branded recovery page and the complete valid, invalid, expired, and repeated-request flows work.
## F03  Authentication failure is excessively slow
Severity  P1 Major    Location  Sign in submission
Evidence
The failed POST /sign-in request took approximately 17.8 seconds before returning HTTP 500. During the wait, the primary action remains disabled and reads Signing in.
Impact
Users experience an apparent freeze and may reload, abandon the product, or duplicate attempts.
Recommendation
Use bounded database connection and query timeouts, fail quickly with a recoverable error, and expose a retry path. Track sign-in latency separately from successful authentication latency.
Retest criterion
Database-unavailable responses arrive within the agreed service objective and the interface never appears frozen.
## F04  Internal diagnostics are exposed
Severity  P1 Major    Location  Runtime error overlay
Evidence
The browser exposes Prisma error type, database hostname and port, source file paths, source excerpts, function names, call stacks, framework version, and development controls.
Impact
Operational details increase security exposure and confuse users. Source paths can reveal system structure and local usernames.
Recommendation
Ensure non-development deployments never expose framework overlays or raw exceptions. Log detailed diagnostics privately and show a stable public error reference with safe language.
Retest criterion
A forced server failure shows only the branded error boundary while restricted logs retain the technical detail.
## F05  Fatal error recovery is inadequate
Severity  P1 Major    Location  Sign in and shared shell error boundary
Evidence
The fallback says “This page couldn’t load” and offers only Reload plus an opaque numeric error. Reloading reproduces the failure. There is no return to Sign in, status information, support route, or preserved context.
Impact
Users enter a dead end and cannot distinguish an outage from an account problem.
Recommendation
Provide a branded, accessible error state with retry, return, status/support guidance, and a copyable incident reference. Preserve safe user context where appropriate.
Retest criterion
Keyboard and pointer users can recover or reach support from every fatal state.
## F06  Security event recording depends on the same failing database
Severity  P1 Major    Location  Authentication success processing
Evidence
Runtime evidence reports that recording the AuthSuccess security event fails when the database query is unavailable. Authentication then continues into membership resolution and fails again.
Impact
Successful identity verification may not produce the expected audit trail, reducing operational accountability during an incident.
Recommendation
Define whether audit-event failure is fail-open or fail-closed, make that policy explicit, decouple durable event capture from membership queries, and monitor event-delivery failures.
Retest criterion
A controlled database interruption produces the intended authentication outcome and a complete, durable security-event record or queued event.
## F07  Invalid credential recovery creates unnecessary rework
Severity  P1 Major    Location  Sign in form
Evidence
After rejected credentials, both email and password are cleared and focus lands on the page body. The error remains visible but has no interactive dismiss control.
Impact
Users must re-enter their email, keyboard users lose their place, and assistive-technology users are not guided to the error or field.
Recommendation
Retain the email, clear only the password, focus the error summary or password field according to a documented pattern, associate the error with the form, and make any visible close affordance a real labeled button.
Retest criterion
After rejection, email remains, password clears, focus is useful, and the error is announced and dismissible.
## F08  Autofocus bypasses skip navigation
Severity  P1 Major    Location  Initial Sign in focus order
Evidence
On load, focus is placed directly in the email field rather than beginning at the Skip to content link.
Impact
Keyboard and screen-reader users cannot encounter the bypass control in the expected first position and may experience an inconsistent tab sequence.
Recommendation
Remove unconditional autofocus or ensure the skip link remains first in the focus order. Test keyboard navigation after reload and after validation errors.
Retest criterion
The first Tab reveals Skip to content, Enter moves focus to main content, and the remaining order follows the visual layout.
## F09  Mobile controls use small hit areas
Severity  P2 Minor    Location  Sign in at compact viewports
Evidence
Measured theme controls were about 31.5 by 31.5 pixels. The visible password control was about 17 pixels square and the recovery link about 20 pixels high.
Impact
Users with reduced dexterity and users operating a moving device may miss or trigger the wrong control.
Recommendation
Provide at least a 44 by 44 CSS-pixel interaction area while preserving the current visual scale. Ensure spacing prevents overlapping targets.
Retest criterion
Every mobile interactive target meets the chosen touch-target standard at 320 and 390 pixel widths.
## F10  Light mode supporting text is visually weak
Severity  P2 Minor    Location  Sign in marketing copy, labels and secondary branding
Evidence
Supporting text and placeholders appear very faint against the light background, particularly at compact scale.
Impact
Low-vision users and users in bright environments may struggle to read essential guidance.
Recommendation
Measure rendered foreground/background pairs and raise contrast to WCAG AA. Do not rely on visual inspection alone when implementing the fix.
Retest criterion
Automated and manual contrast checks pass in light and dark themes for normal, placeholder, disabled and error text.
## F11  Authentication messaging lacks recovery guidance
Severity  P2 Minor    Location  Rejected credentials and fatal sign-in error
Evidence
The rejected-credentials message states only that credentials were not accepted. The fatal state likewise gives no likely causes or next action beyond Reload.
Impact
Users cannot decide whether to retry, reset their password, check service status, or contact an administrator.
Recommendation
Use concise, security-safe guidance that connects rejection to recovery and outage errors to service/support routes. Avoid revealing whether a specific account exists.
Retest criterion
Messages remain enumeration-safe while giving a clear next action.
## F12  Framework surfaces leak into product journeys
Severity  P2 Minor    Location  404 and server failure states
Evidence
Users encounter the stock Next.js 404 page, framework version indicators, development controls, and a raw error overlay.
Impact
The product feels unfinished and exposes implementation details during high-stress moments.
Recommendation
Create branded not-found and error boundaries, and verify production builds with development tooling disabled.
Retest criterion
Unknown and failed routes render consistent Verity states with no framework or developer UI.
# Systemic gaps
- Critical identity and membership resolution has no resilient or gracefully degraded behavior.
- Error handling is implementation-led rather than task-led: technical failures become dead ends instead of actionable user states.
- Account recovery is not complete enough to support a real production identity lifecycle.
- Accessibility intent is present through labels, a skip link, theme roles and semantic controls, but focus management and target sizing are not consistently production-ready.
- Development and user-facing surfaces are insufficiently separated in the environment that was audited.
# Positive findings
- Protected Overview access does not silently expose application content to an unauthenticated browser.
- The password visibility control correctly switches between concealed and visible text states.
- Light and dark theme selection persists across a page reload.
- Email and password controls expose required labels and appropriate autocomplete purposes.
- The tested Sign in layout avoided horizontal document overflow at 320 by 568, 390 by 844, and 1366 by 768 viewports.
- The fatal error boundary provides a Reload action and an incident-style error number, which can be developed into a useful recovery pattern.

# Required remediation order
## 1  Restore database backed membership resolution
Resolve F01 before additional product testing. Verify cold start, repeated sign in, session restoration, direct protected routes, and controlled database interruption.
## 2  Complete account recovery
Implement and test the complete Forgot password journey described in F02.
## 3  Harden authentication and error handling
Address F03 through F07 together so latency, audit-event behavior, safe diagnostics, recovery paths, and focus behavior form one coherent failure model.
## 4  Complete accessibility and responsive corrections
Address F08 through F10 across keyboard, screen reader, mobile touch, light theme and dark theme.
## 5  Replace framework surfaces and clarify copy
Address F11 and F12, then verify a production build rather than relying only on development mode.
## 6  Resume the full user and HQ audit
Only after the blockers are resolved, exercise every authenticated feature, permission boundary, destructive action, empty state, loading state, error path, export, report and persistence rule.
# Authenticated retest checklist
☐  Sign in, sign out, session restoration, session expiry and concurrent sessions
☐  User versus HQ role selection, tenant selection and cross-tenant isolation
☐  Overview data accuracy, drill-down links, freshness indicators and empty states
☐  Operations workflows from creation through assignment, completion and exception handling
☐  Asset creation, editing, status changes, maintenance history and retirement
☐  Workforce onboarding, role changes, availability, permissions and offboarding
☐  Task creation, assignment, prioritization, deadlines, recurrence and completion
☐  Analytics filters, date ranges, comparisons, definitions, no-data states and data freshness
☐  Reports creation, preview, export, scheduling, delivery failure and authorization
☐  Settings persistence, validation, unsaved-change warnings and organization-wide impact
☐  Search, sorting, pagination, filtering and deep-link restoration across every catalog
☐  Create, update and delete confirmation behavior, including undo or recovery where appropriate
☐  Network interruption, database interruption, slow responses, partial failure and retry safety
☐  Keyboard-only operation, screen-reader announcements, zoom, text scaling and reduced motion
☐  Responsive behavior at compact mobile, tablet, laptop and standard HQ desktop dimensions
☐  Light and dark theme contrast, charts, focus indicators, disabled states and print or export output
# Completion standard
This report should be considered complete only for the reachable sign-in and failure surfaces. The Verity application should not be declared fully usable until every P0 and P1 item is closed and the authenticated retest checklist is executed for both an ordinary user and an HQ operative. Any newly discovered issue must receive its own severity, evidence, impact, remediation, and retest criterion.
| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F01 | P0 | Database failure blocks all authenticated use | Open |
| F02 | P0 | Password recovery route returns a raw 404 | Open |
| F03 | P1 | Authentication failure takes approximately 18 seconds | Open |
| F04 | P1 | Internal stack traces and source paths are exposed | Open |
| F05 | P1 | Failure handling offers no meaningful recovery path | Open |
| F06 | P1 | Authentication success event recording fails with the database | Open |
| F07 | P1 | Invalid credential recovery clears both fields and loses focus | Open |
| F08 | P1 | Initial autofocus bypasses the skip link | Open |
| F09 | P2 | Several mobile interaction targets are undersized | Open |
| F10 | P2 | Light mode supporting text appears too faint | Open |
| F11 | P2 | Authentication copy lacks actionable recovery guidance | Open |
| F12 | P2 | Framework and development UI leak into user journeys | Open |