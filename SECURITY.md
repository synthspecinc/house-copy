# Security

Keep the fake demo bound to localhost. For AWS, run one instance behind an HTTPS reverse proxy on a private network. AWS mode requires a password file and verifies its expected AWS account at startup. Use the username `editor`. The shared password grants everyone who knows it the same editing authority. For individual identities and access revocation, put an authenticated access proxy in front of House Copy. House Copy does not provide individual accounts or per-person audit logs.

The server allows only configured templates and field mappings. It rejects changed expressions, dynamic URLs, stale drafts and cross-origin writes. Preview runs in a sandbox with scripts, forms, remote images and other network requests blocked. The visual editor shares an origin with its parent to support editing, but the iframe cannot run scripts. House Copy never sends email.

Store the database, mounted mappings and authentication file outside the repository. Restrict volume access and encrypt operator backups. Revisions and pending operations contain complete template content. Sample data stays in browser memory and request processing; House Copy does not persist user-entered sample data or log template bodies, passwords or provider error bodies. Operator-configured defaults reside in the private mapping file.

SES has no conditional update API. House Copy checks the current content before writing and verifies the result afterward. A separate SES writer can still race between those calls. Restrict template writers to this service during editing sessions. SQLite locking coordinates House Copy writes, but the supported deployment is one process and one local database volume.

If a publish outcome is uncertain, House Copy retains the prior revision and a pending operation and blocks further writes. Follow the recovery procedure in docs/operations.md. Do not delete the database to bypass a recovery block.

Report a vulnerability privately to the repository owner's security contact. The owner must establish that contact before public release. Do not open a public issue containing credentials, private template content or exploit details.
