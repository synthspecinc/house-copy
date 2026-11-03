# Independent change approval

Enable review in the private template configuration. The root policy applies to all listed templates; a template can override either boolean through its own publicationPolicy. Defaults remain false for the credential-free demo. Use the following settings for a deployment that requires independent production review:

```json
{
  "publicationPolicy": {
    "requireApproval": true,
    "requireTicket": true
  },
  "templates": []
}
```

Merge this policy into the real private configuration while retaining its actual allowlisted templates and mappings. Empty templates above are only an illustration. A requireTicket policy also applies to direct writes when approval is off. All real SES writes still require a reason. Changing policy invalidates outstanding approvals. Invalid keys or non-boolean settings fail closed.

Save a draft with a signed-in identity, enter a reason/reference, and choose Request independent review. The request freezes the source and destination content, scope, mapping/policy hashes and draft version. Requesting review does not update SES. A draft created before authorship tracking must be discarded and recreated; saving over an unknown-author draft does not manufacture an author history.

A different enabled publisher opens Change reviews and chooses Review this change. The comparison shows source diffs and sandboxed before/after previews using the configured synthetic sample. Approve this change records a decision without publishing. Reject this change records a final rejection. Requesters and any recorded contributor cannot decide their own review. Editors can request review and cannot decide or execute it. Publisher access continues to require the existing MFA-backed sign-in.

A publisher then chooses Publish approved change and confirms the template name. The server rechecks source/destination, version, scope, reason/reference, mapping, effective publication policy and approval authority before writing. A changed draft, external SES edit, revoked approver, changed OIDC access policy or prior execution requires a new review. The approval is consumed atomically with publication intent, so parallel callers or a no-op target cannot reuse it. The app retains the review and decision as append-only evidence.

Restoration follows the same policy. Request restore review creates a frozen restore proposal for the selected prior revision. A different publisher decides it, and a publisher chooses Restore approved revision. There is no emergency bypass in this scope. Use the existing incident process to resolve a blocked or uncertain write. An uncertain execution consumes its approval and requires recovery followed by a fresh review for any new attempt.

The fake demo deliberately uses one synthetic editor and leaves approval off. To exercise two-person review locally, run the secure browser tests. They use two independently authenticated synthetic publishers and real local HTTPS OIDC exchanges; they also publish and restore through the review UI. No production identity or AWS account is contacted.

Schema version 2 adds immutable requests, decisions and execution records. Legacy revisions and drafts remain readable. Unknown authorship is explicitly rejected for independent review. Host administrators can bypass local database protections, so deploy protected independent audit retention as described in the publishing-controls design.
