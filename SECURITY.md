# Security

## Reporting vulnerabilities

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/synthspecinc/house-copy/security/advisories/new). That feature was verified enabled on 2026-11-03. Do not open a public issue containing credentials, private templates or exploit details. Maintainers should acknowledge reports within 14 days, investigate privately, and publish an advisory with fixed versions when appropriate. Contributors should use synthetic reproductions.

The initial supported release line is 0.1.x. Security fixes target the newest patch in that line. Older patches must be upgraded. No tagged release has been published yet. Follow repository security advisories and release notes for updates. Run dependency checks before each release and regularly while maintaining the project.

## Deployment boundary

Keep the synthetic fake-SES demo bound to localhost. Real SES connections require individual OpenID Connect authentication, an HTTPS public origin, an explicit user allowlist, persistent storage and an HTTPS audit collector by default. Run one application process behind a private reverse proxy on a dedicated hostname. The public shell and minimal /health endpoint contain no template data. Templates, previews, drafts, revisions and session details require authentication.

House Copy implements OIDC sign-in with state, nonce, PKCE and signed ID-token verification through openid-client. It ignores forwarded user and role headers. The identity provider owns enrollment, credential verification, login throttling, account recovery and MFA. Operators must verify their provider's signed MFA claim configuration. Publishers require MFA evidence. Editors can prepare drafts and previews. Only publishers can publish and restore. There is no public account registration or local password login. See [authentication setup](docs/authentication.md).

Sessions use Secure, HttpOnly, SameSite=Lax host-only cookies, a 15-minute idle expiry and an absolute expiry of at most one hour. Expiry may occur earlier when the provider's ID token expires. Logout invalidates the local server session. Local blocking or allowlist removal denies access on the next request. Provider-only account disabling can leave a local session usable for up to one hour. Use the local block command for emergency revocation. Requests already executing may complete.

## Content, credentials and audit

The server enforces configured template/field allowlists, protected expressions, dynamic URLs and stale-write checks. Every application write requires the exact Origin, JSON and a custom request header. OIDC writes also require a session-bound CSRF token. Previews run in a sandbox that blocks scripts, forms, external resources and navigation. The visual editor shares an origin with its parent to support editing, but cannot execute scripts. House Copy never sends email.

Mount auth configuration and client secrets outside the image and repository. Use dedicated AWS roles with exact template permissions. Store the database on an operator-controlled encrypted volume. It contains complete before/after publication and review snapshots, template preimages, drafts, pending operations, identity records and audit events. Restrict backups and audit exports. House Copy stores session hashes, not bearer session cookies, and discards provider tokens after establishing the session. It does not persist user-entered sample recipient data. General application audit records exclude credentials, headers, login codes, tokens, sample values and template bodies. Proxy logs require separate configuration to avoid logging callback query parameters.

Audit records identify publish/restore actors and their revisions. The server durably records intent before contacting SES. An uncertain outcome retains prior content and pending-operation evidence, then blocks further writes until operator recovery. SQLite triggers reject updates/deletes of publication, review and audit evidence. A host administrator can bypass these protections. [Audit delivery](docs/audit-delivery.md) forwards redacted events through a durable outbox to a separately controlled HTTPS collector. The receiver owns protected retention. Required-delivery backlog limits pause publish/restore. Operators must monitor delivery and disk capacity.

[Independent approval](docs/approvals.md) can require another enabled publisher to approve the exact source/destination, mapping, policy, scope and draft or restore revision. Requesters and draft contributors cannot self-approve. Changed bindings or revoked approval authority reject execution. The default synthetic demo leaves this policy off. Enable approval and ticket requirements in the internal deployment configuration.

SES has no conditional update API. House Copy checks current content before a write and verifies it afterward, but another SES writer can race between those calls. Restrict template writers to this service during editing. SQLite locking coordinates local writes. Follow [recovery and backup procedures](docs/operations.md) and retain evidence after an uncertain publish.
