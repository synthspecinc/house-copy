# House Copy

House Copy is a self-hosted editor for existing Amazon SES email templates. A content editor changes approved copy in a visual email view, previews a synthetic recipient, saves a draft, publishes under the same SES name, and restores a prior revision.

The local demo uses synthetic templates and a persistent fake SES adapter. It needs no AWS credentials and sends no email.

## Container quickstart

Install Docker with the Compose plugin, then run from this repository:

```sh
docker compose -p house-copy-local up --build -d --wait
```

Open **http://localhost:3210**. Choose **Workspace welcome**. Click a highlighted content area, or edit its matching content field. Keep variables in braces unchanged. Save the draft, choose **Preview with sample**, and inspect **Plain text**. Choose **Publish changes** and confirm the name. Open **Revision history** to restore the previous copy.

The **Order receipt** example is protected until an operator maps its content. Preview does not send a message. The fake adapter persists published content, drafts and revisions in the `house-copy-local_house-copy-data` volume.

If port 3210 is occupied, use an isolated project and another port:

```sh
HOUSE_COPY_PORT=13211 docker compose -p house-copy-demo up --build -d --wait
```

Open http://localhost:13211. Use the same project name and port variable for later commands.

Compose reserves the small subnet `10.203.117.0/28` instead of consuming Docker's automatic address pools. If it overlaps an existing network, set `HOUSE_COPY_SUBNET` to an unused private subnet, for example `10.203.118.0/28`. Concurrent demos need distinct project names, ports and subnets. Do not prune another project's networks.

Stop only your service when finished:

```sh
docker compose -p house-copy-local down
```

This preserves the volume. Do not add `--volumes` unless the data owner approves deletion. The demo binds to localhost and has no password. Do not expose it on a public interface.

## Development and tests

Use Node.js 24 or 25:

```sh
npm ci --ignore-scripts
HOUSE_COPY_AUTH=demo npm start
```

Open http://localhost:3210. Development data lives in `data/`, which Git ignores. For tests:

```sh
npx playwright install chromium
npm test
npm run test:e2e
```

On a fresh Linux host, Playwright may need `npx playwright install --with-deps chromium`. Unit/integration tests use disposable databases. Browser tests start their own fake service on port 13210. They verify visual editing, draft persistence, both previews, same-name publish, variable protection and restoration. No AWS credentials are needed. For an isolated test of the container workflow from clean source:

```sh
bash scripts/verify-clean.sh
```

See [verification evidence and outstanding acceptance checks](docs/verification.md). Automated browser tests do not replace a session with a non-developer.

## Connecting your own SES account

Use the operator-owned mappings described in [field mapping](docs/field-mapping.md). Approved fields can target HTML and text together. House Copy preserves unedited source bytes, Handlebars expressions and dynamic URLs. It supports text content editing, not arbitrary HTML design changes. Missing parts remain missing.

Use the generic [IAM policy](deploy/iam.example.json) with a dedicated role and exact template ARNs. Configure the expected account and region. AWS mode requires individual OIDC sign-in, an HTTPS origin and persistent storage. Editors can draft and preview. Publishers can also publish and restore after a verified MFA sign-in. See [authentication setup and session revocation](docs/authentication.md). See [operations](docs/operations.md), [security](SECURITY.md) and the [Staging deployment proposal](deploy/README.md). Do not copy real content, credentials or private deployment parameters into this repository.

The application uses SES v2 GetEmailTemplate and UpdateEmailTemplate. It does not create, delete or send templates. The library lists configured names and does not require broad listing permissions. Local Handlebars preview needs an authorized SES test-render comparison before claiming provider parity. [AWS's template API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_UpdateEmailTemplate.html) updates the content of an existing named template.

## Security design

[The security design](docs/security-design.md) describes OIDC, per-request user permissions, revocable sessions, CSRF protection and actor-attributed publishing history. The local demo uses a labeled synthetic actor. Real SES connections require individual authentication. House Copy has no local passwords or public registration.

## Project status and release

This implementation follows the requirements in the implementation request. The referenced attached brief did not reach the workspace or thread. Its scope and acceptance tests must still be reconciled when it is supplied. No live Staging checks, live Huskar policy inspection or human usability session have run. No release artifact has been published or deployed by this work.

The stack is Node.js, Express, browser JavaScript, Handlebars, parse5 and SQLite. One process owns one local persistent database. See [contribution instructions](CONTRIBUTING.md) and the [public release checklist](docs/release.md).

House Copy is licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md) for bundled runtime dependencies. Amazon SES is a service of Amazon Web Services. House Copy is an independent project.
