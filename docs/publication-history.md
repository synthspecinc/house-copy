# Publication history and comparisons

Every new publish or restore keeps an append-only intent containing exact before/after content, hashes, actor, request ID, environment, account/region, change reason, reference and preimage revision. Separate results distinguish confirmed success from uncertain outcomes. An intended after-image is not evidence of SES acceptance until read-back or recovery confirms it. Provider request IDs are kept when the adapter supplies them; missing IDs remain null.

The UI's Review saved changes button compares the saved draft with current SES. Publication evidence in Revision history remains available after subsequent changes. Source is rendered as text with changed ranges highlighted. Missing parts are labeled as absent. Enter a change reason before real SES writes. A ticket/reference is optional unless a publication policy requires it. The fake demo explicitly records a synthetic reason when none is supplied.

Set HOUSE_COPY_ENVIRONMENT to an operator-owned label such as staging. The UI displays that label alongside account/region. The adapter/account/region remain bound to the database. Do not reuse a database across accounts or regions. The environment label is descriptive and does not grant permissions.

Schema version 1 adds publication intents/results and protection against application-level update/delete of history. It preserves legacy prior revisions without inventing publication evidence. Older applications refuse newer schema versions. Keep a database backup before upgrading. SQLite host administrators can bypass triggers, so independently protected audit retention remains necessary.

Preimage, intent, pending evidence and audit intent commit before any SES update. Failed local persistence makes no remote write. An uncertain write blocks publishing. Run the existing offline recovery procedure with the service stopped. Recovery appends recovered_success or recovered_unchanged to the original publication when SES matches one recorded candidate; unknown content remains blocked. It never rewrites the original intent or invents the original actor.

Local acceptance covers exact bytes and missing parts, repeated edits/restart, immutable records, atomic intent failure, uncertain-write recovery, legacy migration, source comparison and fake/AWS-adapter request metadata. Live AWS request IDs and real CloudTrail correlation remain unverified until separately authorized.

When independent approval is enabled, publication evidence also identifies the consumed review request. The immutable request retains the exact approved content and decision. See [approval workflow](approvals.md).
