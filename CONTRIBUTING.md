# Contributing

Use synthetic templates and example.test URLs in changes and tests. Do not include account IDs, real templates, customer data, credentials or internal deployment names in issues or pull requests.

Use Node.js 24 or 25 and the openssl CLI for the local HTTPS identity fixture. Run `npm ci`, `npx playwright install chromium`, and `npm run check`. Preserve source bytes outside approved fields. Include regression coverage for expressions, dynamic URLs and both content parts when changing the editor.

Run `npm run notices` after changing dependencies. Review dependency licenses and keep the generated license files. Contributions are licensed under Apache-2.0.

Publication, deployments and live SES checks require the repository owner's approval. CI builds and tests without AWS credentials.
