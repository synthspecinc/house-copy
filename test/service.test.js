import test from 'node:test';
import assert from 'node:assert/strict';
import { setup,body,fixtures } from './helpers.js';
import { Store } from '../src/store.js';
import { TemplateService } from '../src/service.js';
import { FakeSes, AwsSes, verifyAccount } from '../src/adapters.js';

test('full workflow persists drafts, publishes under the same name, and restores exact prior bytes',async t=>{
  const {service,adapter,store,path}=setup(t);
  const original=await service.open(fixtures[0].name);
  assert.equal(original.fields.length,5);
  const saved=await service.save(original.name,body(original,{headline:'A new beginning',action:'Come on in'}));
  assert.equal((await adapter.get(original.name)).html,original.template.html);
  const reopenedStore=new Store(path); t.after(()=>reopenedStore.close());
  const other=new TemplateService(reopenedStore,new FakeSes(reopenedStore,[]),service.config);
  assert.equal((await other.open(original.name)).template.html,saved.template.html);
  const preview=await service.preview(original.name,{fields:{},version:saved.version,sample:original.sample});
  assert.match(preview.html,/A new beginning/); assert.match(preview.text,/Come on in: https/);
  const published=await service.publish(original.name,{version:saved.version,confirmName:original.name,sample:original.sample});
  assert.equal(published.hasDraft,false); assert.equal(published.revisions.length,1);
  assert.equal((await adapter.get(original.name)).name,original.name);
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM fake_templates').get().count,2);
  const restored=await service.restore(original.name,published.revisions[0].id,{currentHash:published.currentHash,confirmName:original.name});
  assert.deepEqual(restored.template,original.template); assert.equal(restored.revisions.length,2);
});
test('stale drafts, concurrent editors, config changes and unknown names fail closed',async t=>{
  const {service,adapter}=setup(t); const open=await service.open(fixtures[0].name);
  const saved=await service.save(open.name,body(open,{intro:'Your team belongs here.'}));
  await assert.rejects(()=>service.save(open.name,body(open,{intro:'Other window'})),/another window/);
  await adapter.update({...await adapter.get(open.name),subject:'External {{company.name}} {{person.firstName}}'});
  await assert.rejects(()=>service.publish(open.name,{version:saved.version,confirmName:open.name,sample:open.sample}),/SES changed/);
  await assert.rejects(()=>service.save(open.name,body(saved,{})),/SES changed/);
  await service.discard(open.name,saved.version);
  const latest=await service.open(open.name);
  service.config.templates[0].label='Changed configuration';
  await assert.rejects(()=>service.save(open.name,body(latest,{})),/configuration changed/);
  await assert.rejects(()=>service.open('not-allowed'),/not configured/);
});
test('ambiguous remote failure preserves preimage and blocks retries, including after restart',async t=>{
  const {service,adapter,store,path}=setup(t); const open=await service.open(fixtures[0].name);
  const saved=await service.save(open.name,body(open,{headline:'New headline'}));
  const update=adapter.update.bind(adapter);
  adapter.update=async next=>{await update(next); throw new Error('Network lost after SES accepted update');};
  await assert.rejects(()=>service.publish(open.name,{version:saved.version,confirmName:open.name,sample:open.sample}),/could not be confirmed/);
  assert.deepEqual(store.revisions(open.name)[0].template,open.template);
  assert.equal(store.pending(open.name).length,1); assert.equal((await service.open(open.name)).recoveryRequired,true);
  const restarted=new Store(path); t.after(()=>restarted.close()); assert.equal(restarted.pending(open.name).length,1);
  await assert.rejects(()=>service.publish(open.name,{version:saved.version,confirmName:open.name,sample:open.sample}),/operator recovery/);
});
test('template locks prevent concurrent writes across service instances',async t=>{
  const {service,store}=setup(t);
  await store.lock(fixtures[0].name,()=>assert.rejects(()=>service.save(fixtures[0].name,{}),/Another change/));
});
test('subject-only templates preserve absent HTML and text; unmapped templates cannot be saved',async t=>{
  const {service,adapter}=setup(t);
  const name=fixtures[0].name; await adapter.update({name,subject:'Hello {{name}}'});
  service.config.templates[0].fields=[{id:'subject',targets:[{part:'subject'}]}];
  const open=await service.open(name); const saved=await service.save(name,body(open,{subject:'Welcome {{name}}'}));
  assert.deepEqual(saved.template,{name,subject:'Welcome {{name}}'});
  const protectedTemplate=await service.open(fixtures[1].name);
  await assert.rejects(()=>service.save(protectedTemplate.name,body(protectedTemplate,{})),/no approved/);
});
test('AWS adapter uses exact Get/Update commands with no create, delete, send or missing-part coercion',async()=>{
  const calls=[]; const client={send:async command=>{calls.push(command);return {TemplateContent:{Subject:'Hi',Html:'<p>{{x}}</p>'}};}};
  const adapter=new AwsSes('example-region',client); const original=await adapter.get('existing'); await adapter.update(original);
  assert.equal(calls[0].constructor.name,'GetEmailTemplateCommand'); assert.deepEqual(calls[0].input,{TemplateName:'existing'});
  assert.equal(calls[1].constructor.name,'UpdateEmailTemplateCommand'); assert.deepEqual(calls[1].input,{TemplateName:'existing',TemplateContent:{Subject:'Hi',Html:'<p>{{x}}</p>'}});
  await assert.rejects(()=>verifyAccount('region','000000000000',{send:async()=>({Account:'111111111111'})}),/does not match/);
});

test('removed field approvals cannot be republished through an older saved draft',async t=>{
  const {service,adapter}=setup(t); const original=await service.open(fixtures[0].name);
  const saved=await service.save(original.name,body(original,{headline:'Previously approved edit'}));
  service.config.templates[0].fields=service.config.templates[0].fields.filter(f=>f.id!=='headline');
  const changed=await service.open(original.name);
  assert.equal(changed.editable,false); assert.match(changed.mappingError,/configuration changed/);
  await assert.rejects(()=>service.save(original.name,body(changed,{intro:'Another edit'})),/Discard the old draft/);
  await assert.rejects(()=>service.preview(original.name,{version:saved.version,fields:{},sample:original.sample}),/Discard the old draft/);
  await assert.rejects(()=>service.publish(original.name,{version:saved.version,confirmName:original.name,sample:original.sample}),/configuration changed/);
  assert.deepEqual(await adapter.get(original.name),original.template);
  const fresh=await service.discard(original.name,saved.version); assert.equal(fresh.editable,true);
});
