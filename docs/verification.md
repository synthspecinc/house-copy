# Verification and acceptance

The implementation request is the available scope source. Its referenced attached brief was not present in the thread or checkout. Checks against that brief remain UNVERIFIED until the owner supplies it. This document reports current local evidence, not a verdict on unseen acceptance criteria.

## Verified local checks

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

The final clean run passed **20 unit/integration tests and 3 Chromium browser tests** with zero failures. `npm audit --omit=dev` reported zero known vulnerabilities. `npm run notices`, `git diff --check` and the offline CloudFormation schema/lint check passed. Vulnerability and schema checks are point-in-time results, not guarantees about future releases.

## Retained local evidence

The handoff retains a clean source copy at `/tmp/house-copy-clean-Y19HvI`, the transcript at `/tmp/house-copy-clean-verification-final.log`, and the synthetic database volume `house-copy-verify-20261103102837-1982751_house-copy-data`. The tested image ID is `sha256:d0a4e817e3279dda1509991a7322f42c12224a36a469a5d299d6949eba17580b`. The verification script stopped only its own service and network. It retained its volume. No other service was restarted and no network or volume was pruned.

The host's automatic Docker subnet pools were exhausted on the first attempt. Compose now reserves an explicit /28 subnet with an operator override. The successful run used that dedicated network. A preview test initially counted CSP-blocked request events as outgoing traffic. The Chromium trace confirmed the request failed with CSP and had no response. The corrected test asserts both facts.

## Checks still required

| Gate | Status | Owner and next action |
| --- | --- | --- |
| Missing brief | UNVERIFIED | Owner supplies the attachment. Reconcile every scope item and acceptance criterion, implement any gaps, then rerun affected tests. |
| Staging account/region/template/permission authorization | NOT PROVIDED | Owner explicitly authorizes the exact account, region, disposable names and permitted actions. No live calls until then. |
| Huskar permissions reference | UNVERIFIED | Authorized operator reads its live policy and compares only relevant SES permissions. Do not reuse the role. |
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
6. Attempt to remove the greeting variable. Explain the error and recover without publishing broken content. Open the protected receipt and identify why it cannot be edited.

Record completion, confusion, accidental actions, copy misunderstandings and help required for each task. Pass only if the editor completes the main edit/preview/publish/restore workflow without facilitator coaching, understands that preview sends no email, and understands the publish/restore confirmation. Retain notes privately. Fix observed blockers and repeat the affected tasks. Automated Chromium results are not human usability evidence.
