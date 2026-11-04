# Durable audit delivery

House Copy records a redacted event and its delivery envelope in one SQLite transaction. A worker forwards envelopes in sequence to an operator-owned HTTPS collector. Delivery is at least once. The collector must deduplicate by event ID and commit durable evidence before acknowledging it. House Copy cannot verify a receiver's retention policy or independence.

## Configuration

AWS mode requires delivery configuration by default. The credential-free fake demo leaves it optional and still records local envelopes. Configure these private deployment values outside this repository:

```sh
HOUSE_COPY_AUDIT_URL=https://audit.example.test/house-copy/events
HOUSE_COPY_AUDIT_TOKEN_FILE=/run/house-copy/audit-collector-token
HOUSE_COPY_AUDIT_REQUIRED=true
HOUSE_COPY_AUDIT_MAX_PENDING=1000
HOUSE_COPY_AUDIT_MAX_AGE_SECONDS=300
```

The mounted file contains a printable ASCII bearer credential. The app trims surrounding whitespace. Mount it read-only and restrict access to the operator and container UID. Rotate the credential at the same URL, replace the file and restart only this worker/service. Credentials never enter SQLite, health output or application error messages.

For a generic Compose deployment with an existing HTTPS reverse proxy, combine `compose.yaml`, `compose.oidc.yaml` and `compose.audit.yaml`. Set HOUSE_COPY_PRIVATE_DIR to a private absolute directory containing `auth.json`, `oidc-client-secret` and `audit-collector-token`. Set HOUSE_COPY_PUBLIC_ORIGIN and HOUSE_COPY_AUDIT_URL. The fake adapter remains selected until an operator separately configures an authorized SES connection. The Staging proposal includes the collector parameter and file mount.

Only HTTPS URLs without user information, query parameters or fragments are accepted. Redirects fail. Standard Node TLS certificate validation stays enabled. Configure a private trusted CA through the deployment's normal trust store if needed. Do not disable certificate verification. Tests inject a transport that trusts only their generated local certificate.

The database stores the endpoint fingerprint. A different endpoint refuses startup. Migration to another collector requires a separate reviewed procedure that reconciles destination retention and old receipts. Changing a value in SQLite is not proof of delivery to a new collector. Stable IDs survive ordinary restarts, backups and replays to the original receiver. New events use UUIDs. Upgrade backfills legacy events using a deterministic hash of their original scope, row ID and document.

An operator can explicitly set HOUSE_COPY_AUDIT_REQUIRED=false to disable the backlog publishing gate. This weakens the required-delivery policy and needs the operator's control review. The Staging proposal fixes it to true. Configured collectors still receive events when the gate is disabled.

## Receiver contract

The worker sends a POST with `Content-Type: application/json`, `Authorization: Bearer CREDENTIAL` and `Idempotency-Key: EVENT_ID`. The body is:

```json
{
  "schemaVersion": 1,
  "eventId": "synthetic-event-id",
  "event": {
    "eventId": "synthetic-event-id",
    "created": "2026-01-01T00:00:00.000Z",
    "action": "template.publish",
    "outcome": "success",
    "requestId": "synthetic-request-id",
    "publicationId": "synthetic-publication-id",
    "actor": {"issuer": "https://identity.example.test", "subject": "synthetic-subject", "role": "publisher"},
    "scope": {"mode": "fake", "environment": "demo", "account": null, "region": null}
  }
}
```

A valid acknowledgement is a 2xx response with at most 16 KiB of JSON containing the same eventId and `accepted: true`. For example:

```json
{"eventId":"synthetic-event-id","accepted":true}
```

The receiver must commit or find an existing identical event before replying. If an existing ID has different content, reject and investigate it. Authenticate each request, restrict the ingestion credential to its source, limit request sizes, and store evidence under a retention/access policy independent of the app runtime. No production collector is bundled. The test receiver commits to a separate SQLite file before acknowledgement and exercises duplicate suppression over local HTTPS.

An empty 200, a wrong ID, a redirect or a response outside the size limit leaves the event pending. A five-second timeout bounds each delivery. Fixed failure categories are `http_error`, `ack_error`, `timeout` and `transport_error`. Provider response bodies are discarded. Body-read failures use `ack_error`. Exponential retry delays start at one second and cap at one minute. A SQLite lease prevents the service and delivery CLI from draining concurrently. An expired worker cannot record an acknowledgement. A crash or lost acknowledgement can replay an event with the same ID. Audit retry never repeats a template update.

Only explicit metadata fields leave the app. These include actor issuer/subject/role, scope, request ID, action/outcome, template name, revision/publication/review references, fingerprints and provider request IDs. Template source, preview samples, free-text reasons/references, tokens, cookies, user labels and error bodies are excluded. Treat even redacted metadata as restricted operational evidence. Exact change content stays in the restricted publication/review tables.

## Health and operator commands

A signed-in publisher can GET `/api/audit-delivery` using their normal session. It returns configuration/requirement flags, pending count, oldest pending age, last acknowledged time, current retry attempts/time/category and publishingPaused. It returns no URL, credential, event body or identity list. Editors cannot access it. `/health` remains public process liveness and does not prove external delivery.

Required delivery pauses publish and restore when pending count reaches HOUSE_COPY_AUDIT_MAX_PENDING or oldest age exceeds HOUSE_COPY_AUDIT_MAX_AGE_SECONDS. The worker continues during a pause. Successful delivery clears the pause when the backlog falls below both limits. Reading, drafting, reviewing and signing out remain available. A failure to persist local publication/audit intent always prevents an SES call.

Alert on rising pending count, stale lastDeliveryAt, publishingPaused, health-query failure and disk capacity. Choose limits that allow the approved outage grace period and fit the storage budget. The app retains events and receipts after delivery and never deletes evidence to regain capacity.

Run one bounded delivery pass with the same private configuration and volume as the service:

```sh
node scripts/audit-deliver.js --once
```

The CLI sends at most 50 events, respects existing backoff and shares the worker lease. Exit 0 means no pending events, 2 means evidence remains pending, and 1 means configuration or execution failed. Its JSON result includes health and the number delivered. A busy lease can return 2. There is no command that resets retry state or silently changes destinations. The collector token file and URL are required even when the demo's background delivery is optional.

Manual export remains available:

```sh
HOUSE_COPY_DB=/private/path/house-copy.sqlite node scripts/audit-export.js > /private/path/audit.jsonl
```

Export includes stable event IDs. It does not mark delivery complete. Manual export alone does not meet required external delivery. Keep the output out of Git.

Login inserts its session and audit envelope atomically before setting a cookie. Logout deletes the session before attempting its audit. Operator block/revoke normally commits state and audit together. If audit fails, the command retries only the restrictive state change and reports failure. Verify the resulting access state and repair evidence recording. Unblock never grants access without its audit record.

Local tests prove protocol behavior with synthetic identities and events. Operators still need to verify their receiver's durable acknowledgement, duplicate handling, access restrictions, retention, alerts, credential rotation and outage recovery. Those live checks and authorized Staging checks remain separate acceptance gates.
