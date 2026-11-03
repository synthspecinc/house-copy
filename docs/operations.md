# Operations

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| HOUSE_COPY_ADAPTER | fake | `fake` or `aws`. Other values fail startup. |
| HOUSE_COPY_CONFIG | ./config/templates.json | Operator-owned mappings and synthetic default samples. |
| HOUSE_COPY_DB | ./data/house-copy.sqlite | Persistent SQLite database. |
| HOUSE_COPY_ORIGIN | http://localhost:3210 | Exact origin, without trailing slash, for write request checks. AWS requires HTTPS. |
| HOUSE_COPY_PASSWORD_FILE | unset | File containing the password for username `editor`. Required in AWS mode, at least 24 characters. |
| AWS_REGION | unset | Required in AWS mode. No implicit region. |
| HOUSE_COPY_AWS_ACCOUNT_ID | unset | Expected 12-digit account ID. Checked with STS before serving in AWS mode. |
| HOST | 127.0.0.1 | Bind address. The container sets 0.0.0.0 and Compose publishes only localhost. |
| PORT | 3210 | Server port. |
| HOUSE_COPY_PORT | 3210 | Compose host port. Open using localhost at this port. |

AWS credentials use the SDK default provider chain. Prefer the dedicated ECS runtime role. Never put access keys in the repository or container image. Use separate volumes for each adapter/account/region. The server refuses to reuse a database bound to another connection.

Drafts are shared within the instance. Version checks reject another window's stale saves. Publishing rechecks SES, saves the complete prior template durably, updates the same name, and reads it back. Restore saves the current version first, then writes the selected prior revision exactly. An external writer can race with SES updates because SES has no conditional write. Run one House Copy process and coordinate all other template writers.

## Backup and retention

The volume contains private drafts, complete revision preimages and pending write evidence. Stop this service alone before copying the database and its SQLite sidecars together. Use an encrypted operator backup location with access restrictions. Start the same service afterward. Verify a restore into a separate disposable volume before relying on backups. Do not remove the original volume. Docker Compose `down` without `--volumes` preserves it.

House Copy keeps all revisions. There is no automatic retention pruning or destructive cleanup. Operators own volume capacity and retention policy. The health endpoint proves the HTTP process responds; live SES availability is checked when opening or writing a template.

## Recovering an uncertain publish

A timeout may mean SES accepted a write even though the client did not receive confirmation. House Copy blocks further writes and retains both candidate states, the preimage revision and the draft. It never retries the business operation automatically. SDK request-level retries can occur within the failed call. Read-back mismatches also require recovery.

Stop the selected service and retain a database backup first. With the same mounted volume and configuration, run:

```sh
docker compose stop house-copy
docker compose run --rm --no-deps house-copy node scripts/recover.js house-copy-welcome --server-stopped
docker compose start house-copy
```

This example is for fake mode only. For an authorized AWS deployment, run the same script inside the reviewed task environment while the service is scaled to zero, with the approved AWS region, expected account, private config, volume and dedicated role. The script verifies the account and only reads SES. It makes no remote update. Running it against Staging requires explicit live authorization.

The script reconciles only when the remote template exactly matches either the recorded previous or intended state. A confirmed new state removes the saved draft; a confirmed previous state retains it. It retains every prior revision. It then clears the selected template's operation and stale lock. It refuses unknown remote content. In that case an operator must compare the protected evidence privately and choose the correct revision. Never clear all locks or operations on a running server. A crash without a pending operation can leave a lock; the same offline script clears the selected lock after reading the current template.

Use the same database only with its original adapter, region and account. Restore a backup and rerun local checks if the volume is damaged. Do not delete evidence to unblock publishing.
