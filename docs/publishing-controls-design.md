# Publishing evidence, approvals and audit delivery

## Scope and decisions

This design extends the individual-authentication implementation at b9dd763. The authorized scope is the three highest-priority application additions: complete revision history, revision-bound independent approvals and reliable external audit delivery. Implementation follows this design in separate pull requests in that order. The reviewed user request supplies scope; no matching House Copy Linear issue was found by search.

The application remains a single process with one local SQLite database. It uses the existing configured template allowlist, field mappings, OIDC identities and editor/publisher roles. It never creates, deletes or sends an SES template. Synthetic fixtures and fake SES exercise every new workflow without credentials. No AWS deployment, real provider access, external collector provisioning or publication is authorized by implementation.

Backup/restore automation, retention administration, corporate offboarding events, broad access-review tooling and full external drift monitoring are later work. These additions enable controls and evidence; they do not establish SOC 2 compliance by themselves.

## Complete revision history

Each publish or restore creates an immutable publication record before contacting SES. It contains:

- Operation ID, UTC creation time and action.
- Exact source and intended destination templates, including absent parts, plus SHA-256 fingerprints.
- Actor, server-generated request ID, operator-configured environment, adapter/account/region scope and exact template name.
- Change reason and optional ticket/reference. Real SES writes require a nonempty reason. Synthetic local operations can use an explicitly labeled demo reason.
- Mapping/policy identity and approval reference when applicable.
- The prior revision ID used for restoration.

A separate append-only result records confirmed success, uncertain outcome, or the operator's later reconciliation. Results include the SES request ID when available. A destination stored before a write is intended content, not proof it reached SES. Only matching read-back or explicit recovery establishes a confirmed result. Unknown provider metadata remains null, never invented.

The existing prior-revision table remains readable and restorable. Legacy revisions are marked as preimages without manufactured publication outcomes. New publication records retain both sides even after later edits or service restarts. SQLite triggers reject application-level update/deletion of these immutable records. Host administrators can bypass database protections, so protected independent retention remains an operator responsibility.

Preimage, publication intent, pending operation and audit intent commit in one synchronous SQLite transaction before a remote update. A failed transaction makes no SES call. A confirmed result and audit outcome commit before pending evidence is cleared. If the process fails between those steps, the existing recovery block prevents another write. Recovery appends a result to the same operation and keeps its original actor/request context. It makes no remote update and never rewrites history.

Authenticated read APIs expose publication metadata and detailed before/after comparisons. The UI shows changed source for subject, HTML and text with bounded prefix/suffix highlighting and safe text nodes. HTML is never injected into the main page. A change review also offers sandboxed rendered previews using configured synthetic sample data. Missing parts are distinguished from empty strings. A persistent environment/account/region label accompanies review and publishing.

## Independent approvals

The root config can contain `publicationPolicy` with `requireApproval` and `requireTicket`, both defaulting to false. A template can override either boolean through its own `publicationPolicy`. Invalid policy values fail closed. Operators enable the requirements for production or selected high-risk templates. Policy changes invalidate old approvals. There is no emergency approval bypass in this scope. Restore follows the same policy as publish.

A saved draft records its authenticated contributors. A review request records an immutable snapshot of its proposed operation, source fingerprint, destination fingerprint, draft version or selected restore revision, mapping hash, effective policy hash, scope, reason, reference and requester. The requester and draft contributors cannot approve it. A publisher with current MFA-backed access can approve or reject it. Only one decision is accepted for a request. Approval is not transferable to another template, operation, account, mapping or draft.

The approval read API returns the exact comparison and rendered synthetic previews. The UI supports request, review, approve/reject and execution. A restore review is requested by a publisher. An editor may request review of a saved draft. Review decisions and execution require publisher authority at the API and service boundaries. When OIDC is active, execution also checks that the approver remains an enabled publisher and that the authorization policy has not changed. Actor strings supplied in request bodies or headers have no authority.

Publication recomputes all bindings under the template lock and rechecks SES. An edited/discarded draft, changed policy/mapping, changed SES content, revoked approver, mismatched operation or previous execution rejects approval reuse. An immutable execution row consumes the approval atomically with publication intent before SES access. An uncertain write still consumes its approval and requires recovery. A new attempt after reconciliation needs a new review. Legacy drafts with unknown authorship must be discarded and recreated before independent approval can be used.

Reasons and references belong in restricted publication/review records, not general audit payloads. User-entered sample recipients are not stored in approval records or audit events.

## Reliable audit delivery

Every audit event is inserted with a durable outbox envelope in the same SQLite transaction. The envelope has a stable UUID, sequence and schema version. Existing audit rows are backfilled transactionally at upgrade. Retries, restarts and backup replay preserve IDs so a collector can deduplicate. Events are not removed after delivery. Audit metadata includes operation, revision/review references, hashes, actor, scope, request ID and outcome. Templates, recipient samples, credentials, cookies, tokens and provider error bodies are excluded by an explicit field allowlist.

The initial integration is an operator-configured HTTPS JSON collector, authenticated with a bearer credential read from a private mounted file. The collector is outside House Copy and owns independently protected retention. HTTP, URL credentials, query-string secrets and redirects are rejected. The app never substitutes an insecure transport. Tests inject a transport trusting only their generated local CA.

The delivery contract is one POST per event, with `Idempotency-Key` set to the event UUID and body `{schemaVersion: 1, eventId, event}`. A successful acknowledgement must be a bounded JSON body containing the same `eventId` and `accepted: true`, returned with a 2xx status. The collector must durably store or deduplicate the event before acknowledging it. An empty 200 response is not acknowledgement. This is at-least-once delivery, not an exactly-once guarantee.

The worker delivers in sequence with a SQLite lease shared by the service and one-shot delivery CLI. Requests have a five-second timeout. Failures use durable exponential backoff capped at one minute. Stored errors are fixed categories without response bodies or credentials. A lost/expired lease cannot acknowledge work. Receiver success followed by local failure can cause replay with the same event ID. Retry does not repeat the SES operation.

The configured destination is bound to the database by its endpoint fingerprint. A changed collector URL fails startup instead of treating old receipts as evidence for a new destination. Collector migration is a separately reviewed operator procedure. Credential rotation for the same URL uses a mounted-file update and worker restart.

Real SES mode requires audit delivery configuration by default. The credential-free demo leaves delivery optional. A policy can pause publish/restore when undelivered events exceed a configured count or age. Defaults are 1,000 pending events or five minutes for required delivery. A short collector outage therefore retains local evidence and permits the configured grace period. A failure to durably record local intent always prevents an SES write. No events are silently pruned to regain capacity.

An authenticated publisher health endpoint exposes pending count, oldest pending age, last delivery success, retry state and whether publishing is paused. It excludes destination credentials, event bodies and identity lists. The public health endpoint remains minimal process liveness. Deployment monitoring must alert on backlog growth, stale delivery and disk capacity. Outbox storage can grow during outages; the operator owns capacity and incident response.

OIDC session creation and its login audit must commit together before issuing a session cookie. Revocation and logout continue to deny access even if later logging fails. Existing local operator audit export remains supported and includes stable event IDs. Manual export alone does not count as configured reliable external delivery.

## Migration and deployment

Use additive, versioned SQLite schema changes. Reject databases newer than the running application. Migration transactions preserve existing drafts, revisions, pending operations, sessions and audit history. Never infer successful publication or approval for old data.

Add generic environment variables for the environment label, collector URL, credential-file path, delivery requirement and backlog thresholds. Keep private values outside Git. The staging proposal mounts the collector credential file and accepts a reviewed collector URL. Its SES runtime permissions remain get/update on exact template ARNs. HTTPS collector egress must be reviewed separately. Do not reuse the Huskar role or add unrelated AWS permissions.

The container quickstart still uses fake SES and no external collector. The full security tests use signed local OIDC and a local durable fake collector. A one-shot CLI supports delivery jobs and debugging without sending email or making SES calls. No unauthenticated administration endpoint is added.

## Acceptance tests

### Revision history

- A confirmed publish retains exact before/after bytes, including absent/empty parts, hashes, actor, scope, reason, reference and provider request ID after subsequent edits and restart.
- Direct SQL update/delete of protected records fails. A source comparison renders content as text and preserves Handlebars and dynamic URLs.
- Pre-write persistence failure makes no SES call. Simulated timeout after acceptance retains intended content and original actor, and recovery appends the correct result without rewriting history.
- Existing legacy revisions restore correctly. History/read endpoints require normal authenticated template access.

### Approval enforcement

- Default demo workflow remains available. Effective global/template policy is visible and enforced server-side.
- Two distinct MFA-backed publishers can request and approve a real local HTTPS test flow. An editor can request draft review and cannot approve or execute.
- Requester/contributor self-approval, changed draft/mapping/policy/source/scope, disabled approver, wrong action/ID and consumed approval fail without SES writes.
- Restore requires the same independent approval when enabled. Rejection cannot be used as approval. Reasons/references and rendered synthetic previews correspond to the bound content.
- Concurrent decision/execution attempts produce one decision and at most one remote update.

### Audit delivery

- Every committed event has one durable envelope, including migrated events. Simulated transaction failure leaves neither a partial event nor an orphan envelope.
- A local HTTPS collector durably receives redacted events. Wrong acknowledgement, HTTP error, timeout and connection failure preserve the event and retry state.
- A receiver outage, service restart, acknowledgement loss and competing workers cause no event loss. Replays carry the original event ID.
- Backlog thresholds pause publish/restore before an SES call and clear after delivery. Logout/revocation remain effective during audit problems.
- Missing or unsafe required configuration refuses startup. No request follows a redirect or prints secrets. A changed destination cannot reuse delivery receipts.
- Authenticated health exposes backlog/failure signals without disclosing event content or credentials.

Final verification includes the complete local suite, fake-SES browser flow, two-person approval browser flow, local HTTPS collector tests, pinned Node 24 tests with external networking disabled, clean-source Compose workflow/restart checks, deployment lint and dependency/license checks. Real workforce IdP/MFA claims, collector durability/access/retention, CloudTrail correlation, authorized Staging writes and human usability remain separate live gates.
