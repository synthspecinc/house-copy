# Public release checks

Publication is an owner action. No repository visibility change, package publication, image publication, push, PR or deployment is part of this local handoff.

Before publication:

- Obtain the missing brief and reconcile its scope and acceptance criteria with docs/verification.md. Resolve gaps before calling the brief complete.
- Complete the Staging checks and the non-developer usability session. Keep private evidence outside the repository. Fix any defects and rerun the affected local checks.
- Review the full Git diff and tracked history for private deployment values, real template content and credentials. Ignored files are not a substitute for a release review. The initial source contains only synthetic fixtures and generic deployment parameters.
- Run `npm ci --ignore-scripts`, `npm run check`, `npm audit --omit=dev`, `npm run notices`, and `bash scripts/verify-clean.sh`. Review changes to notices and dependency licenses. The application image includes runtime dependencies only.
- Set the owner's private security reporting contact in SECURITY.md, repository ownership metadata and support expectations. Review the shared-password authentication model and single-process storage limits.
- Review Apache-2.0 LICENSE, NOTICE and THIRD_PARTY_NOTICES.md. Keep all bundled license texts. There are no bundled proprietary assets, fonts, real email templates or copied product designs.
- Pin the reviewed container base digest and application image digest for deployment. Record the tested source revision and image digest in the release notes. Choose a release tag only after the owner approves publication.

The synthetic fixture is authored for this project. The UI uses system fonts. The app includes no telemetry or external asset requests.
