# Verification and acceptance

The implementation request is the available scope source. Its referenced attached brief was not present in the thread or checkout. Checks against that brief remain UNVERIFIED until the owner supplies it. This document reports current local evidence, not a verdict on unseen acceptance criteria.

## Baseline local checks

On 2026-11-03 UTC, `bash scripts/verify-clean.sh` exited 0 after copying Git-visible source to a new directory with no node_modules, database, environment file or AWS credentials. It installed from package-lock.json, built the pinned-base container, created a new Compose project and volume, exercised the browser workflow against the container, and restarted it to verify persistence. BuildKit reused unchanged dependency layers; this was a clean source and application state check, not a no-cache build.

| Requirement from the implementation request | Result | Evidence |
| --- | --- | --- |
| Open an existing template | PASS locally | Service and browser tests read a pre-existing fake template. |
| Edit approved content visually | PASS automated | Chromium edits the highlighted headline in the iframe and the button's labeled content field. |
| Map fields through configuration | PASS locally | Subject, unique HTML elements, text segments/suffixes and literal anchor tests. Unmapped templates are read-only. |
| Preserve surrounding HTML and source | PASS locally | Complete-string expected-output comparison. No-op returns identical source in every part. Nested markup and overlapping/ambiguous mappings are rejected. |
| Preserve Handlebars and dynamic URLs | PASS locally | Tests reject expression removal, additions, reorderings, triple-brace changes and dynamic URL edits. Read-back retains the dynamic href. |
| Preserve HTML and plain text | PASS locally | Paired field tests and browser previews confirm both parts change together. Subject-only tests confirm absent parts stay absent. |
| Preview with sample data | PASS locally | Nested values, conditionals, loops, inline partials, subject and plain text render. Missing variables fail. This does not establish SES parity. |
| Publish under the same name | PASS locally | Fake store retains the same name and template count. AWS command test verifies UpdateEmailTemplate with the exact input name. No create/delete/send command is used. |
| Restore the prior revision | PASS locally | Complete-template deep equality against the original preimage, plus browser restoration. Restore saves the displaced version too. |
| Persist drafts and history | PASS locally | Reopening a second SQLite connection preserves drafts. Container restart preserves published content and revisions. |
| Reject stale or concurrent changes | PASS locally | Draft versions, config hashes, SES content fingerprints and database locks reject stale writers. A changed field approval blocks old drafts until they are discarded. SES still has an external-writer race described in SECURITY.md. |
| Recover an uncertain update | PASS locally | Simulated timeout after successful write retains evidence and blocks retries. Offline recovery verifies previous, intended and unknown remote states. Unknown state remains blocked. |
| Run without AWS credentials | PASS container | Compose forces fake mode, mounts no credential files, confirms AWS key variables are absent, and completes the workflow. |
| Authentication and write boundary | PASS locally | HTTP checks cover Basic authentication, cross-origin rejection, JSON parsing and redacted provider errors. |
| Isolate email previews | PASS Chromium | Injected sample HTML cannot execute script or navigate. An attempted tracking image fails with CSP and receives no response. Inline email styles remain visible. |
| Container runs without root | PASS container | Runtime UID is 1000, with read-only root filesystem and a writable dedicated volume. |
| Apache license and third-party notices | PRESENT and checked | Standard LICENSE, NOTICE, and generated license/notice texts for 98 runtime packages. Generation fails on a missing unreviewed license. |
| Staging runtime role and deployment config | PREPARED, offline validation PASS | `cfn-lint deploy/staging.cfn.json` exits 0. Runtime policy permits only get/update for one exact approved template ARN. No deployment or IAM simulation has run. |

The baseline clean run at f2b7515271e756be43b1ec46db9d4165e3c1a933 passed **20 unit/integration tests and 3 Chromium browser tests** with zero failures. `npm audit --omit=dev` reported zero known vulnerabilities. `npm run notices`, `git diff --check` and the offline CloudFormation schema/lint check passed. Vulnerability and schema checks are point-in-time results, not guarantees about future releases.

## Retained local evidence

The baseline handoff retains a clean source copy at `/tmp/house-copy-clean-Y19HvI`, the transcript at `/tmp/house-copy-clean-verification-final.log`, and the synthetic database volume `house-copy-verify-20261103102837-1982751_house-copy-data`. The tested image ID is `sha256:d0a4e817e3279dda1509991a7322f42c12224a36a469a5d299d6949eba17580b`. The verification script stopped only its own service and network. It retained its volume. No other service was restarted and no network or volume was pruned.

The host's automatic Docker subnet pools were exhausted on the first attempt. Compose now reserves an explicit /28 subnet with an operator override. The successful run used that dedicated network. A preview test initially counted CSP-blocked request events as outgoing traffic. The Chromium trace confirmed the request failed with CSP and had no response. The corrected test asserts both facts.

## Security follow-up

The design in security-design.md adds individual OIDC sign-in, editor/publisher roles, publisher MFA, revocable sessions, logout, session CSRF tokens and actor-attributed auditing. Shared Basic authentication is removed. See authentication.md for deployment, revocation and audit-export commands. The original Basic-auth row above describes the baseline only.

Current verification commands are `npm run check`, `docker build --target verification -t house-copy:security-tests .`, `docker run --rm --network none house-copy:security-tests`, and `bash scripts/verify-clean.sh`. The local HTTPS identity provider generates signing keys and certificates for each fixture. It makes no calls to real identities or AWS. Real provider/MFA configuration remains unverified until an authorized operator checks it.

### Security acceptance evidence

The final local security verification on 2026-11-03 UTC passed **33 unit/integration tests and 6 Chromium browser tests**, with zero failures. The same 33 unit/integration tests also passed inside the pinned Node 24 verification image with `--network none`. The development host used Node 25. Three browser tests exercise real local HTTPS OIDC exchanges against the Express app in the test worker. The other three exercise the Compose runtime container during the clean-source run. This is not evidence from a deployed identity provider or Staging account.

| Security acceptance criterion | Result | Direct evidence |
| --- | --- | --- |
| Individual sign-in with signed tokens, PKCE, state and nonce | PASS local HTTPS | Valid flow succeeds. Wrong signature, issuer, audience, nonce, expired token, stale authentication, state, verifier, missing cookie, expired transaction and callback replay fail. |
| Explicit users, MFA and publisher permissions | PASS API and browser | Unknown/disabled users fail. Editor can save/preview and cannot publish/restore, even with forged headers. Signed MFA or configured acr is required for publishers. |
| Cookie/session lifecycle | PASS locally | Secure/HttpOnly/host-only/SameSite cookie checks, hash-only session persistence, idle and absolute expiry, logout, local block through the actual operator CLI, revoke, unblock and policy changes. Old sessions cannot cross issuer/client changes. |
| Request and abuse boundary | PASS locally | Session CSRF, exact origin, JSON/body limits, auth/API throttles, and ignored forwarded identity/role/address headers. |
| Attribution and interrupted writes | PASS locally | Publish/restore intent and outcomes match actor, request and preimage revision. Simulated uncertain update preserves identity in pending evidence. Failed durable audit intent prevents an SES update. Audit-export command returns redacted records. |
| Human-facing sign-in flow | PASS automated | Publisher workflow, editor publishing explanation, sign-out with no page errors, and reauthentication in a new tab without losing unsaved copy. Human usability remains unverified. |
| Safe startup | PASS subprocess | Real SES rejects demo authentication before any AWS call. Malformed private OIDC configuration fails without logging the supplied private marker. No fallback to demo occurs. |
| Deployment/release files | PASS offline | OIDC Compose override and Staging CloudFormation lint pass. Runtime licenses/notices regenerated for 103 packages. Runtime dependency audit reports zero known vulnerabilities. Private GitHub vulnerability reporting verified enabled. |

The clean-source run retained `/tmp/house-copy-clean-iA9YSb`, log `/tmp/house-copy-security-clean-final2.log`, synthetic volume `house-copy-verify-20261103111101-2377253_house-copy-data`, and runtime image `sha256:30a185b871c52daf07864653b56b6fe60f45307ebce96bc47e17593c4b804503`. The Node 24 test log is `/tmp/house-copy-security-node24-final2.log`; its verification image is `sha256:070b3ae8c3572391f4a3c0f930a415c785ed25bd6c265020df835727d9a9d22f`. No image was published. Verification stopped only its own service and retained its volume.

A browser fixture initially waited on a keep-alive connection during teardown. Its cleanup now closes only that fixture's own sockets. Final browser and clean-source runs passed after that fix. Dependency/schema results describe the tested versions and date only.

## Publishing controls acceptance evidence

The publishing-controls follow-up on 2026-11-03 UTC passed **65 unit/integration tests and 7 Chromium browser tests**, with zero failures. The pinned Node 24 verification image passed the same 65 unit/integration tests with external networking disabled. The clean-source Compose run installed dependencies from the lockfile, ran all 65 tests, built the runtime image, ran all seven browser tests, checked persistence across restart, and verified UID 1000 with no AWS key variables. Four browser tests run their own local HTTPS app/identity-provider fixtures; three run against the Compose runtime. The HTTPS collector tests use a separate durable synthetic receiver and never contact a real collector.

| Publishing control | Result | Direct evidence |
| --- | --- | --- |
| Complete publication history | PASS locally | Exact before/after parts and absent values, hashes, actor, scope, reason/reference and fake provider request ID survive later edits and reopening the database. Protected history rejects SQL update/delete. |
| Uncertain-write evidence | PASS locally | Pre-write persistence failure makes no SES call. Timeout after fake acceptance retains intended content and actor. Offline reconciliation appends a result to the same publication. |
| Independent approval | PASS API and Chromium | Two signed-in MFA-backed synthetic publishers review, approve, publish and restore. Editors can request review but cannot decide or execute. Requesters and contributors cannot approve. |
| Approval binding and concurrency | PASS locally | Draft, mapping, policy, scope, source, metadata and authority changes fail before an update. Wrong/missing/consumed decisions, rejected reviews, legacy unknown authorship and concurrent execution are covered. |
| Durable audit outbox | PASS locally | Event/envelope transaction rollback, legacy backfill, deterministic legacy IDs, stable replay IDs, immutable payloads/receipts and redaction. |
| HTTPS delivery and recovery | PASS local HTTPS | Durable receiver acknowledgement, wrong/empty/oversized acknowledgements, HTTP error, timeout, redirect refusal, acknowledgement loss, restart replay and deduplication. SQLite lease excludes competing workers and expired acknowledgement. One-shot CLI exit codes and TLS are exercised. |
| Fail-closed control boundaries | PASS locally | Required backlog count/age pauses publish and restore before a fake SES update and clears after acknowledgement. Login cannot issue a session without its audit envelope. Logout/revoke/block still remove access during audit failure; unblock remains blocked. |
| Health and deployment configuration | PASS locally/offline | Publisher-only health excludes endpoint/credential/content. Unsafe startup/destination changes fail. CloudFormation lint and OIDC/audit Compose rendering pass with synthetic parameters. Dedicated SES IAM scope remains unchanged. |
| Dependencies and public source | PASS local checks | Runtime dependency audit reports zero known vulnerabilities. Notices for 103 runtime packages reproduce without changes. First-party whitespace and relative documentation links pass. |

The full check log is `/tmp/house-copy-controls-check.log`. Clean-source evidence is retained at `/tmp/house-copy-clean-xgjKjZ`, with log `/tmp/house-copy-controls-clean.log` and synthetic volume `house-copy-verify-20261103121705-3217353_house-copy-data`. The runtime image is `sha256:a3a5cca1548e857ade91d46af8385f570a13785fc2006af776e90e7b8daa4d97`. The Node 24 log is `/tmp/house-copy-controls-node24.log`; its image is `sha256:3a081679120500363599f20fbd9db32ccef0197794a1286389c7a15384d9594a`. Verification stopped only its own Compose project and retained the volume. BuildKit reused dependency layers. Later edits only document these results and operator procedures.

An age-threshold test initially advanced a synthetic clock from a value captured before publication. It now advances from the actual event creation period. Final targeted, full-suite, Node 24 and clean-source runs all pass. These tests enable application controls; they are not SOC 2 certification or proof of operator control operation.

## Checks still required

| Gate | Status | Owner and next action |
| --- | --- | --- |
| Missing brief | UNVERIFIED | Owner supplies the attachment. Reconcile every scope item and acceptance criterion, implement any gaps, then rerun affected tests. |
| Staging account/region/template/permission authorization | NOT PROVIDED | Owner explicitly authorizes the exact account, region, disposable names and permitted actions. No live calls until then. |
| Huskar permissions reference | UNVERIFIED | Authorized operator reads its live policy and compares only relevant SES permissions. Do not reuse the role. |
| Real OIDC provider, MFA claims, account disable and revocation | UNVERIFIED | Operator configures a confidential client and verifies claims and access behavior with the chosen provider. Local protocol tests use synthetic identities. |
| External audit receiver and retention | UNVERIFIED | Operator verifies durable acknowledgement, stable-ID deduplication, restricted independent retention, credential rotation, disk/backlog alerts and outage recovery with the real collector. |
| Internal approval policy | UNVERIFIED | Operator enables requireApproval/requireTicket in private config and verifies two-person publish/restore and approver revocation with real workforce identities. |
| Deployed account, role, networking, authentication and storage | UNVERIFIED | Operator reviews and deploys the proposed configuration after authorization. Follow deploy/README.md. |
| Live SES publish and exact restore | UNVERIFIED | Use disposable synthetic content. Compare all three parts and hashes with SES read-back. |
| SES render parity and actual email-client appearance | UNVERIFIED | An authorized operator runs SES test-render. Inbox/client checks require separate sending authority if needed. |
| Non-developer usability | UNVERIFIED | Run the session below with a representative editor and record observed results. |
| Public publication | OWNER ACTION | Review docs/release.md, establish a private security contact, approve publication separately. |

## Non-developer usability session

Use the credential-free demo with synthetic data. The facilitator opens the library and gives the editor these tasks without explaining the controls:

1. Find Workspace welcome and change its headline and button label while retaining the greeting variable.
2. Save the draft, close/reopen the template, and confirm the edits remain.
3. Preview Alex's email. Change the sample first name to Jordan and confirm it appears in the greeting and subject. Check the button URL value and plain-text version.
4. Publish and identify which SES name changed. Explain when recipients will see the new copy and where the prior version is stored.
5. Restore the prior revision and verify both the headline and button label return.
6. In the controlled OIDC setup, request review with a reason/reference. Have a different publisher inspect source and rendered comparisons, approve, and execute. Repeat for restore. Confirm an edited draft requires a fresh review and the environment label is understood.
7. Attempt to remove the greeting variable. Explain the error and recover without publishing broken content. Open the protected receipt and identify why it cannot be edited.

Record completion, confusion, accidental actions, copy misunderstandings and help required for each task. Pass only if the editor completes the main edit/preview/publish/restore workflow without facilitator coaching, understands that preview sends no email, and understands the publish/restore confirmation. Retain notes privately. Fix observed blockers and repeat the affected tasks. Automated Chromium results are not human usability evidence.
