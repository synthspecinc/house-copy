# Individual authentication and publishing security

## Decision and scope

The baseline app is committed in f2b7515271e756be43b1ec46db9d4165e3c1a933 and reviewed separately in PR #1. This follow-up replaces shared Basic authentication with OpenID Connect, local revocable sessions, two application roles and actor-attributed auditing. It preserves the synthetic demo and all existing editing and recovery behavior. No live AWS or identity-provider access is authorized by this design.

House Copy edits templates an application sends under a trusted identity. A publishing account can change messages received by customers. Template access, draft content, revisions and session credentials are sensitive. The supported deployment remains one organization, one application process and one local persistent database behind HTTPS. The host operator and identity provider are trusted. Host compromise and a malicious operator are outside the application boundary.

## Authentication ownership

House Copy uses the maintained openid-client library with the authorization-code flow, PKCE S256, a random state value and a nonce. It validates the issuer, audience, signature, nonce, expiration and recent authentication. The redirect URI is the configured origin plus /auth/callback. It never derives redirects from Host or forwarded headers. Discovery and provider endpoints require HTTPS in the shipped server. Request timeouts and login throttling bound authentication traffic.

The identity provider owns enrollment, password recovery, password hashing, credential throttling and MFA enrollment. A self-hosted OIDC provider is supported. House Copy stores no passwords, ID tokens, access tokens or refresh tokens. A client secret is read from an operator-mounted file. Users are authorized by the configured issuer and immutable subject identifier, never by an email domain or a client-supplied identity header. Forwarded identity headers have no authority.

A private auth.json allowlist assigns each subject either editor or publisher. All other users are denied. The operator can disable a subject in that file. The application reads and validates the access policy on every authenticated request, so policy removal, role changes and disabled users apply to existing sessions. Invalid or missing policy denies access. Issuer and client changes require restarting the service.

Publishers must present signed MFA evidence in the ID token. By default the amr claim must include mfa. Operators can configure accepted acr values for their provider. These values are policy, not proof by themselves. Operators must verify their provider issues them only after the required factors. Editor access does not require MFA in this initial design. No auto-enrollment, user administration API or group-to-role mapping is included.

## Authorization

| Actor | Allowed actions |
| --- | --- |
| Anonymous | Load the sign-in shell, start/complete login and read the minimal health endpoint. |
| Editor | Read configured templates, edit/save/discard shared drafts and preview with sample data. |
| Publisher | All editor actions, plus publish and restore approved template revisions. MFA evidence is required. |
| Host operator | Maintain private configuration, block identities, revoke sessions, export audit records, back up data and recover uncertain writes. These are local commands, not application API privileges. |

API middleware enforces the role before invoking the template service. UI buttons explain the available permissions but do not enforce security. There is no separate approval workflow. The same person may hold publisher access and edit their own draft. Existing configuration remains the template allowlist for both roles.

## Sessions and revocation

The browser receives a 256-bit opaque session ID in a host-only __Host-house-copy cookie with Secure, HttpOnly, Path=/ and SameSite=Lax. SQLite stores only its SHA-256 digest, stable identity, MFA evidence, issue/last-use/expiry times and a random CSRF token. Successful authentication replaces any prior local session. Sessions have a 15-minute idle limit and a one-hour absolute limit, capped by the ID token's expiration. Login requires recent provider authentication. No refresh tokens extend that limit.

Logout is a same-origin JSON POST with a session-bound CSRF token. It deletes the server session and expires the browser cookie. Browser closure is not logout. Provider logout is separate. The next login asks the provider to authenticate again, even if its own browser session survives.

An operator command can revoke all sessions for a subject or block it. Blocking denies both new logins and existing sessions. Unblocking does not restore old sessions. Removing or disabling the subject in the private allowlist also denies access on the next request. A provider-only account disable can leave a House Copy session usable until its absolute expiry, at most one hour. Emergency revocation uses the local block command. This bound must be stated in operator instructions and checked before adoption.

OIDC state, nonce and PKCE verifier live only in a five-minute, browser-bound, single-use login transaction. The transaction cookie is also Secure, HttpOnly and host-only. Failed or replayed callbacks cannot create a session. Expired transactions and sessions are pruned. Login and API routes have bounded rate limits. Rate-limit keys use the socket peer, not untrusted forwarded headers. Operators behind a shared reverse proxy must configure a complementary edge limit and size the app-wide peer limit for their team.

## Request and browser boundaries

All state-changing application and logout requests require the exact configured Origin, JSON content type and the existing custom request header. OIDC sessions additionally require the session CSRF token. Authentication callbacks use the OIDC state/nonce/PKCE checks instead. Cookies and auth tokens never enter URLs or localStorage. HTML and sample data remain isolated in the existing sandbox and restrictive preview CSP. Authentication endpoints and application responses use no-store. HTTPS deployments add HSTS. Only the minimal health endpoint is exempt from authentication for data routes.

A missing authentication configuration prevents startup in real SES mode. Shared Basic authentication is removed. The demo is an explicit authentication mode, only valid with the fake adapter and a loopback public origin. Compose binds its published port to localhost. The demo actor is labeled synthetic and has no AWS permissions. No implicit fallback from OIDC failure to demo is allowed.

## Audit and recovery evidence

SQLite gains append-only application audit records with UTC time, request identifier, action, outcome, issuer/subject when known, template name and revision identifier where applicable. Record successful and failed authentication, denied access, logout, expired/revoked sessions, draft changes, publish/restore intent and outcome, and operator revocation/block actions. Do not record headers, cookies, codes, claims blobs, credentials, recipient sample values, provider error bodies or template content in audit events.

Publish and restore must durably record an intent and the acting identity before the SES call. Revisions and pending-operation records retain that identity and their audit request ID. Success and uncertain failure are distinct outcomes. This makes an interrupted remote operation traceable even if the process stops before writing its result. Existing revisions remain readable and display an unknown actor. The existing preimage and uncertain-write recovery procedure stays authoritative. Recovery writes a local operator audit event and never invents the publisher's identity.

SQLite does not make logs tamper-proof against the host operator. Restrict database access and document export to an operator-managed log destination. There is no audit-deletion endpoint. The operator owns retention and encrypted backups.

## Deployment and open-source operations

Ship a private-config example with generic issuer/client/subject values, role mapping and MFA settings. Document exact callback registration, secret file permissions, MFA claim verification, account disable semantics, logout, revocation, HTTPS termination, database protection and recovery. Update the Staging proposal to mount auth.json and the OIDC client secret instead of a shared editor password. No private values or real templates enter Git.

Keep the app usable with operator-selected and self-hosted providers. Supply a local test identity provider that signs real ID tokens and checks PKCE. It is test-only, uses synthetic identities and has no public production mode. CI verifies the protocol and browser flow without an external account. Real provider configuration, live AWS checks and human usability remain separate deployment gates.

The release must document supported versions, a usable private vulnerability-reporting channel, security-update instructions and dependency checks. Until the owner supplies a private reporting contact, document GitHub private vulnerability reporting and require the owner to enable it before release. Do not claim the channel is enabled without checking it.

## Acceptance tests

1. Existing credential-free demo, content preservation, previews, publish, restore and clean-container restart tests still pass.
2. Valid signed OIDC login establishes an individual session. Unknown/disabled subjects, missing publisher MFA, expired tokens, wrong issuer/audience/signature/nonce/state, code replay and invalid PKCE fail without creating one.
3. Editor API calls can save/preview but cannot publish or restore. Publisher API calls can complete both workflows. Forged role/identity headers and direct API calls do not bypass checks.
4. Cookies have all required attributes. Idle and absolute expiry, logout, allowlist removal, operator revocation and blocking invalidate sessions. Revoked cookie replay fails. Unblocking does not restore a session.
5. Missing or invalid CSRF tokens, foreign origins, oversized requests and throttled requests fail. Login callback failures return a generic error and retain no code/token values in audit records.
6. UI shows signed-in identity, role and logout. Editors see why publishing is unavailable. Session expiry preserves unsaved editor content and offers sign-in in a separate tab, then a way to resume without reloading the draft.
7. Publish and restore snapshots, pending operations and audit events carry the acting identity, request ID and revision. Errors and interrupted updates retain intent evidence. Audit export contains no supplied passwords, tokens, codes, sample values or template bodies.
8. AWS mode refuses demo, Basic auth and missing OIDC/HTTPS configuration. Startup and identity tests never call a real AWS account. Offline deployment lint, dependency audit and third-party notices pass.

## References

The implementation follows the openid-client protocol API and OWASP guidance. These are design references, not a claim of certification.

- [openid-client authorization-code example](https://github.com/panva/openid-client/blob/main/examples/oidc.ts)
- [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
