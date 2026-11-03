import { SESv2Client, GetEmailTemplateCommand, UpdateEmailTemplateCommand } from '@aws-sdk/client-sesv2';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { Problem } from './editor.js';
import { randomUUID } from 'node:crypto';

export class FakeSes {
  constructor(store, fixtures) {
    this.store = store;
    const insert = store.db.prepare('INSERT OR IGNORE INTO fake_templates VALUES (?,?)');
    for (const template of fixtures) insert.run(template.name,JSON.stringify(template));
  }
  async get(name) {
    const row = this.store.db.prepare('SELECT document FROM fake_templates WHERE name=?').get(name);
    if (!row) throw new Problem(404,'Template not found.');
    return JSON.parse(row.document);
  }
  async update(template) {
    if (!this.store.db.prepare('UPDATE fake_templates SET document=? WHERE name=?').run(JSON.stringify(template),template.name).changes) throw new Problem(404,'Template not found.');
    return {requestId:`fake-${randomUUID()}`};
  }
}
export class AwsSes {
  constructor(region, client = new SESv2Client({region, maxAttempts:2})) { this.client=client; }
  async get(name) {
    const data = await this.client.send(new GetEmailTemplateCommand({TemplateName:name}));
    const t=data.TemplateContent;
    return {name,subject:t.Subject,...(t.Html === undefined ? {} : {html:t.Html}),...(t.Text === undefined ? {} : {text:t.Text})};
  }
  async update(t) {
    const result=await this.client.send(new UpdateEmailTemplateCommand({TemplateName:t.name,TemplateContent:{Subject:t.subject,...(t.html === undefined ? {} : {Html:t.html}),...(t.text === undefined ? {} : {Text:t.text})}}));
    return {requestId:result.$metadata?.requestId || null};
  }
}
export async function verifyAccount(region, expected, client = new STSClient({region})) {
  if (!region || !/^\d{12}$/.test(expected || '')) throw new Error('AWS_REGION and HOUSE_COPY_AWS_ACCOUNT_ID are required in AWS mode.');
  const identity = await client.send(new GetCallerIdentityCommand({}));
  if (identity.Account !== expected) throw new Error('AWS account does not match HOUSE_COPY_AWS_ACCOUNT_ID. Startup refused.');
}
