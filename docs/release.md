# Public release checks

Release publication is an owner action. Development commits and pull requests are authorized separately. Repository visibility changes, package/image publication and deployments require their own owner approval.

Before publication:

- Obtain the missing brief and reconcile its scope and acceptance criteria with docs/verification.md. Resolve gaps before calling the brief complete.
- Complete the Staging checks and the non-developer usability session. Keep private evidence outside the repository. Fix any defects and rerun the affected local checks.
- Review the full Git diff and tracked history for private deployment values, real template content and credentials. Ignored files are not a substitute for a release review. The initial source contains only synthetic fixtures and generic deployment parameters.
- Run `npm ci --ignore-scripts`, `npm run check`, `npm audit --omit=dev`, `npm run notices`, and `bash scripts/verify-clean.sh`. Review changes to notices and dependency licenses. The application image includes runtime dependencies only.
- Verify GitHub private vulnerability reporting remains enabled and the maintainers receive reports. Set repository ownership metadata and support expectations. Review OIDC/MFA policy, session revocation, the one-hour provider-disable bound and single-process storage limits.
- Review Apache-2.0 LICENSE, NOTICE and THIRD_PARTY_NOTICES.md. Keep all bundled license texts. There are no bundled proprietary assets, fonts, real email templates or copied product designs.
- Pin the reviewed container base digest and application image digest for deployment. Record the tested source revision and image digest in the release notes. Choose a release tag only after the owner approves publication.

The synthetic fixture is authored for this project. The UI uses system fonts. The app includes no telemetry or external asset requests.
