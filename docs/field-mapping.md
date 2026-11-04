# Mapping editable content

An operator maps fields in a JSON file and mounts it read-only. Set HOUSE_COPY_CONFIG to its path. The default `config/templates.json` and `fixtures/templates.json` are synthetic examples. Opening a template loads its existing content from SES. House Copy never creates a replacement name and never uploads the fixtures in AWS mode.

Each template entry has a `name`, a friendly `label`, a `description`, a synthetic `sample` object and a `fields` array. Names form an allowlist. Unlisted templates cannot be read or written through the API. An empty fields array makes a template read-only. Restart the service to load a changed mapping. Mapping changes invalidate open editors. Discard drafts made under the previous configuration, then reapply edits under the new approved mappings.

A field has an `id`, a `label` and one or more `targets`. Give each field a unique lowercase identifier. Targets support:

| Part | Target | Meaning |
| --- | --- | --- |
| subject | `{"part":"subject"}` | The whole subject, with expressions locked. |
| html | `{"part":"html","selector":"#headline"}` | Text inside the unique element with this ID. |
| html | `{"part":"html","selector":"[data-copy=\"intro\"]"}` | Text inside a unique element matching this attribute. |
| text | `{"part":"text","segment":1,"separator":"\n\n"}` | Zero-based paragraph segment. The separator stays protected. |
| text | `{"part":"text","segment":5,"separator":"\n\n","suffix":": {{actionUrl}}"}` | Text in a segment before a protected suffix, such as a button label before a URL. |
| text | `{"part":"text"}` | The whole text part. Prefer narrower segments when only approved content may change. |
| text | `{"part":"text","start":"FIXED PREFIX","end":"FIXED SUFFIX"}` | A unique anchored region. Both anchors must stay outside editable content. |

HTML selectors deliberately support only `#id` and `[attribute="value"]`. The target must be one explicit element containing text only. Nested markup, attributes, comments, links and surrounding structure are protected. A button label can be editable while its href stays unchanged. Existing IDs or attributes need no source changes. If suitable markers do not exist, an operator must add and verify them outside House Copy before mapping. There is no raw HTML editor or general page builder.

Map paired HTML and text targets to the same field when they share copy. Their decoded values must match exactly. House Copy refuses to edit a broken or ambiguous mapping. A template without HTML or without text retains that absence. It does not generate a missing text part. Unmapped text remains byte-for-byte unchanged. New text is escaped in HTML, but remains literal text in the plain-text part.

Handlebars expressions must remain identical and in order within each field and each part. This includes nested paths, triple braces, block boundaries, inline partials and helpers. Do not split an expression across fields. The editor shows expressions as text and rejects an edit that changes them. Dynamic URLs in HTML attributes are outside editable regions. Expressions and dynamic URL strings in text are protected too. Static URLs in a fully mapped text field can be edited; use segment/suffix mappings to keep all URLs protected where required.

A no-op edit returns the original source exactly. Editing one field replaces only the approved source range. House Copy does not serialize the parsed HTML back to source. It reparses the result to check the mapping, rejects overlapping targets, and never normalizes the surrounding markup or styles.

Preview uses Handlebars in strict mode with synthetic sample data and SES-style unescaped substitutions. Missing variables, invalid syntax and unknown helpers produce an error. Null and absent optional values may need an `if` block or appropriate sample value. A local preview is not proof of SES rendering parity or inbox appearance. Verify complex templates with the authorized SES test-render check before adoption. Scripts, external images, forms and navigation are blocked in previews. Inline email styles remain visible. Browser rendering does not reproduce every email client's layout.
