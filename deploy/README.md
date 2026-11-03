# Staging deployment proposal

Synthspec Staging is the first target. This folder contains a reviewable proposal, not a deployed service. No private account IDs, regions, endpoints, role ARNs, template names or real content are included. The existing Huskar role is a permissions reference only. Its live policy has not been inspected because live account access has not been authorized for this task. Do not attach it, copy its policy, or give House Copy its credentials.

## Runtime role

`iam.example.json` is the generic operator policy. Replace REGION, ACCOUNT_ID and APPROVED_TEMPLATE_NAME with your own reviewed values. Use a separate role with only `ses:GetEmailTemplate` and `ses:UpdateEmailTemplate` on exact template ARNs. The library reads configured names, so it does not need account-wide template listing. Preview runs locally. The runtime does not need sending, create, delete, IAM or test-render permissions. `sts:GetCallerIdentity` checks the account at startup and does not require an allow statement.

The CloudFormation proposal creates a dedicated ECS task runtime role and a separate image/log execution role. The task trust limits the source account and ECS region. The pilot accepts one exact disposable template name. Review that name against the private config. Expand the resource list only for separately approved templates. Keep these roles free of unrelated managed policies. Review effective permissions and any permissions boundary before deployment.

AWS documents these [SES actions and template ARN scopes](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html) and the [ECS task trust conditions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).

## Hosting and persistence

The proposal runs one ECS EC2 task on a dedicated container instance with the attribute `house-copy=true`. Exactly one host must have that attribute. An operator must provision it and its encrypted EBS filesystem first. Pin scheduling to that host. Host replacement requires restoring the database volume before placing the task. SQLite WAL requires a local filesystem. Do not use EFS/NFS or Fargate ephemeral storage for this database.

The service stops the old task before starting its replacement. This causes a brief outage and prevents simultaneous database writers. The service needs a private ALB target group and an authenticated HTTPS endpoint. It does not create public ingress or new network infrastructure. The referenced security group must permit port 3210 only from the approved reverse proxy. Review network egress for SES, STS, ECR and CloudWatch Logs. Container tasks must not reach instance metadata credentials.

On the dedicated host, prepare the DataDirectory with UID/GID 1000 and mode 0700. Mount a separate private ConfigDirectory read-only. It must contain `templates.json` and `editor-password`. Use a randomly generated password of at least 24 characters, readable only by the container UID and host operator. The config must list only approved templates with synthetic sample data. Do not use environment variables for the password or mount personal AWS profiles. ECS supplies temporary runtime credentials through its task-role provider.

Keep image publication and deployment as separate owner actions. Build the image locally, review it, then publish to the operator's repository and pass its digest to Image. Pass deployment parameters from a private file outside this repository. The template has no usable private defaults. This command is an offline syntax/schema check only:

```sh
uvx --from cfn-lint cfn-lint deploy/staging.cfn.json
```

## Required live authorization and checks

Obtain explicit approval for the Staging account, region, exact disposable template names, and allowed permissions before any live call. Permission to deploy a service does not imply permission to send email or modify application templates.

1. Verify the approved account with the approved scoped profile and `aws sts get-caller-identity --profile PROFILE`. Stop on a mismatch. Record the region and account privately.
2. With authorized IAM read access, inspect the existing Huskar role as a reference. Compare only the SES actions required here. Review the new role's effective permissions. Confirm its runtime cannot send, create, delete or update an unrelated template. Do not test denied sends by attempting to send email.
3. Have an authorized operator create a disposable template from the synthetic fixture. Creation and cleanup use a separate operator identity. Grant House Copy only get/update for that name. Map it in a private config.
4. Review and deploy the stack with the owner. Verify the image digest, task role, encrypted volume, password access, private ingress, HTTPS origin and healthy target. Verify that a wrong expected account refuses startup.
5. Open, edit, save, preview, publish and restore through the UI. Read SES back after publish and restore. Compare all three parts, exact name, expressions, dynamic URLs, HTML structure, plain text and untouched bytes against the saved preimage. Record UTC timestamps and hashes privately.
6. If separately authorized for `ses:TestRenderEmailTemplate`, use the operator identity to call `aws sesv2 test-render-email-template --template-name DISPOSABLE_NAME --template-data file://SYNTHETIC_DATA_FILE --region REGION --profile PROFILE`. Compare the rendered subject, HTML and text to the local preview, including loops, conditionals, nested variables and URL values. The runtime does not have this permission. No email is sent by test-render.
7. Verify restart persistence and the uncertain-update recovery procedure on disposable content. Back up and restore the database with the service stopped. Have the operator remove only the authorized disposable templates afterward if cleanup was approved.

No live Staging acceptance check or Huskar role comparison has been performed yet.
