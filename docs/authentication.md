# Authentication and access

## Supported setup

House Copy supports a confidential OpenID Connect client using authorization code, PKCE S256 and client_secret_basic authentication. Register an RS256-signed ID token profile and configure the provider to return subject, audience, issuer, expiration, nonce and auth_time claims. The provider must support `prompt=login` and `max_age=0`. Use a maintained identity provider, including a self-hosted one. This repository's HTTPS test provider is test-only and must never authenticate real users.

The provider owns enrollment, password storage and recovery, credential throttling, account disabling and MFA. House Copy owns its sessions, user allowlist, role enforcement, CSRF protection and publishing audit. Network access to the app does not grant access to templates. No forwarded identity header has authority. No local password account or shared Basic credential is supported.

1. Choose a dedicated HTTPS hostname, such as `https://copy.example.test`, behind the operator's TLS reverse proxy. The container can receive HTTP on its private port. Set HOUSE_COPY_ORIGIN to the exact external origin, without a trailing slash. Do not derive it from client-supplied forwarded headers.
2. Register a confidential OIDC client. Its exact redirect URI is `https://copy.example.test/auth/callback`. Enable authorization-code flow and S256 PKCE. Disable wildcard callbacks and implicit flow. Enable client_secret_basic. Use the provider's HTTPS issuer URL.
3. Copy `config/auth.example.json` to a private location outside Git. Set issuer and clientId. Add approved users by their immutable OIDC subject, not email. Assign editor or publisher. A friendly label is optional. Set `disabled: true` to deny that subject. Unknown subjects always fail sign-in.
4. Require MFA in the provider's publisher policy. The signed ID token must contain `amr: ["mfa", ...]`, or an `acr` value explicitly listed in `mfaAcrValues`. Verify that the provider emits the selected value only after the required factors. A publisher without accepted signed evidence cannot sign in. Editors do not require MFA in House Copy, but the provider can require it for everyone.
5. Store the OIDC client secret in a separate file readable only by the runtime UID and operator. Mount both files read-only. Set HOUSE_COPY_AUTH=oidc, HOUSE_COPY_AUTH_CONFIG to the private JSON path and HOUSE_COPY_OIDC_SECRET_FILE to the secret path. Never place the client secret in the policy JSON, environment variables, logs, Git or image layers.
6. Review the dedicated SES runtime role, region and expected account. Use a separate persistent volume for each adapter/account/region. Complete the live authorization gates in deploy/README.md before any AWS call.

The Staging CloudFormation proposal mounts `/run/house-copy/auth.json` and `/run/house-copy/oidc-client-secret`. Its host directory also contains the private template mappings. Existing Basic-auth installations must replace their password setting with these OIDC settings. HOUSE_COPY_PASSWORD_FILE now refuses startup. An unavailable provider at startup prevents serving; it never enables demo mode. A missing or invalid allowlist denies authenticated access.

## Container configuration example

For an operator-owned HTTPS reverse proxy on the same host, the following overrides the default fake-SES demo with real OIDC authentication. The identity provider must already be registered as described above. Keep both required files in the private directory and make them readable by container UID 1000. The source path must be absolute and outside this checkout. The example continues using synthetic fake-SES templates, so it needs no AWS credentials:

```sh
HOUSE_COPY_PRIVATE_DIR=/private/house-copy \
HOUSE_COPY_PUBLIC_ORIGIN=https://copy.example.test \
docker compose -p house-copy-oidc -f compose.yaml -f compose.oidc.yaml config

HOUSE_COPY_PRIVATE_DIR=/private/house-copy \
HOUSE_COPY_PUBLIC_ORIGIN=https://copy.example.test \
docker compose -p house-copy-oidc -f compose.yaml -f compose.oidc.yaml up --build -d --wait
```

Point the reviewed HTTPS proxy at the localhost-published House Copy port. Do not expose that HTTP port externally. For concurrent demos, set a distinct HOUSE_COPY_PORT and HOUSE_COPY_SUBNET as in README.md. Use the same project, override files and variables when stopping this service. The Staging CloudFormation proposal is the separate reference for AWS-mode credentials, private template mappings and exact SES permissions. It does not reuse a host AWS profile.

## Permissions and policy updates

Editors can read configured templates and revisions, save/discard shared drafts, and preview. Publishers can do those actions plus publish and restore. A publisher may publish their own draft when policy permits direct publishing. When independent approval is required, another publisher must approve the exact change first. Both roles have the same configured template allowlist. Changes to AWS accounts, mappings and user access remain host-operator actions.

House Copy reads the allowlist on every authenticated request. Removing or disabling a user denies their next request and deletes their session. A role change applies to their next request. Publisher promotion also requires the session to contain the accepted MFA evidence. Update the private policy atomically so readers never see a partial JSON file. Mount the containing directory when using file replacement, because a bind mount of one file can retain its original inode. Changing the issuer or client ID requires a restart. Old sessions cannot cross an issuer/client change.

## Sessions, logout and revocation

Sessions expire after 15 minutes of inactivity or one hour from sign-in, whichever comes first. ID-token expiry can shorten that lifetime. House Copy does not store refresh tokens or silently extend the absolute limit. The Sign out button deletes the server session and expires its cookie. It does not log the person out of every application at the identity provider. A new House Copy sign-in requests fresh authentication.

When a session ends while someone is editing, the editor retains unsaved copy in that tab. Sign in in a new tab, return to the original tab, and choose Resume after sign-in. Then save again. Another editor's changes can still cause a version conflict. Sign out clears the visible template/sample state from that window. Saved drafts remain shared with the team.

Disabling an account only at the identity provider does not instantly revoke an existing House Copy session. It can remain usable for at most one hour. For immediate denial, disable/remove the subject in auth.json or run the local block command. Requests already in progress may complete.

Run these commands as the authorized host operator with the same database and private policy paths as the service. They work while the single process is running. They use SQLite transactions, make no AWS or provider calls, and record the local operator UID and target subject in audit history:

```sh
node scripts/auth-access.js revoke EXACT_SUBJECT
node scripts/auth-access.js block EXACT_SUBJECT
node scripts/auth-access.js unblock EXACT_SUBJECT
```

`revoke` removes existing sessions but permits another login if policy still allows the person. `block` also denies new login and any pending callback. `unblock` allows a new login if policy permits it, but never restores revoked sessions. A block is stored in the database and survives restart. Keep the private policy and database paths in the operator's service environment. Do not run commands against an arbitrary recovered database or another instance.

## Audit and limits

Publish and restore record a started event before SES access, then a success or uncertain result. Revision and pending-operation records identify the actor, request ID and preimage revision. Legacy revisions display Unknown actor. Draft changes, sign-in outcomes, access failures, logout, expiry observed on access and operator actions also produce events.

Export line-delimited JSON to an access-controlled operator destination:

```sh
node scripts/audit-export.js > /private/operator-backups/house-copy-audit.jsonl
```

The database is authoritative for local audit history. There is no audit deletion API. Host administrators can modify the database. [Durable audit delivery](audit-delivery.md) sends redacted events to a separately controlled HTTPS collector for independent retention. Exported records include stable event IDs but do not acknowledge delivery. Records contain stable identity identifiers and template names. Treat them as private. Audit events exclude tokens, cookies, callback codes, request bodies, sample recipients and template content. Do not configure a proxy to log callback query strings. Review ALB access-log behavior before enabling it, since that infrastructure can record the OIDC callback URL independently of House Copy.

Authentication starts/callbacks are limited to 60 requests per peer address per ten minutes. Session and API endpoints are limited to 600 requests per peer per minute. These are in-memory limits for the supported single process. Forwarded addresses are ignored. Behind a shared proxy, the peer is normally the proxy, so all users share that application limit. Configure complementary per-client throttling at the edge. Request bodies are limited to 200 KB and sample payloads to 50 KB. The identity provider must enforce its own credential-level protection.

## Local verification and release gates

`npm test` starts local HTTPS identity providers, checks real JWT signatures and PKCE, and verifies roles, MFA, session expiry, revocation, CSRF, rate limits and audit redaction. `npm run test:e2e` runs both the synthetic demo and secure browser workflows, including reauthentication without losing unsaved edits. Test certificates and signing keys are generated at runtime, remain outside Git, and are never accepted by the production client automatically. The host tests require the openssl CLI. To run unit/integration tests on the pinned Node 24 container runtime instead, use `docker build --target verification -t house-copy:security-tests .` followed by `docker run --rm --network none house-copy:security-tests`. That target includes test dependencies and openssl; the final runtime image excludes them. Playwright ignores certificate errors only in its local HTTPS test context; the OIDC client trusts only the generated test CA through an injected test transport.

The local tests establish protocol behavior, not compatibility with every provider. Before adoption, verify discovery, exact callback registration, publisher MFA claims, editor restrictions, logout, immediate local block and the provider-disable expiry bound with the chosen real provider. Keep real identities and test evidence private. Complete a non-developer usability session. Those checks, Staging deployment and public release remain owner-controlled gates.

See [independent approval](approvals.md) for revision-bound two-person publishing. Editors may request draft review. Publishers can approve another person's change and execute an approved publish/restore. User and MFA policy changes invalidate prior approval authority. The application does not grant an editor publish permission merely because a review was approved.
