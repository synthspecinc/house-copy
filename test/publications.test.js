import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setup,body,fixtures } from './helpers.js';
import { Store } from '../src/store.js';
import { fingerprint } from '../src/editor.js';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

test('publication history retains exact before/after, scope, metadata and results across edits and restart',async t=>{
  const {service,store,adapter,path}=setup(t),open=await service.open(fixtures[0].name);
  const context={actor:{issuer:'https://identity.example.test',subject:'publisher',role:'publisher'},requestId:'request-1'};
  const saved=await service.save(open.name,body(open,{headline:'Persistent destination'}));
  await service.publish(open.name,{version:saved.version,confirmName:open.name,sample:open.sample,reason:'Improve welcome copy',reference:'CHANGE-42'},context);
  const [first]=store.publications(open.name);
  assert.deepEqual(first.before,open.template);assert.deepEqual(first.after,saved.template);
  assert.equal(first.beforeHash,fingerprint(open.template));assert.equal(first.afterHash,fingerprint(saved.template));
  assert.equal(first.actor.subject,'publisher');assert.equal(first.scope.environment,'demo');assert.equal(first.changeReason,'Improve welcome copy');assert.equal(first.reference,'CHANGE-42');
  assert.equal(first.results[0].outcome,'success');assert.match(first.results[0].providerRequestId,/^fake-/);
  const current=await service.open(open.name),second=await service.save(open.name,body(current,{headline:'Subsequent edit'}));
  await service.publish(open.name,{version:second.version,confirmName:open.name,sample:open.sample},context);
  const reopened=new Store(path);t.after(()=>reopened.close());
  assert.deepEqual(reopened.publication(open.name,first.id).after,saved.template);
  assert.equal(service.publication(open.name,first.id).parts.find(p=>p.part==='html').changed,true);
  assert.notEqual((await adapter.get(open.name)).html,first.after.html);
  assert.throws(()=>store.db.prepare('DELETE FROM publications WHERE id=?').run(first.id),/append-only/);
  assert.throws(()=>store.db.prepare("UPDATE publication_results SET document='{}'").run(),/append-only/);
});
test('uncertain publication records intended content and recovery appends a result to the same operation',async t=>{
  const {service,store,adapter,path}=setup(t),open=await service.open(fixtures[0].name);
  const saved=await service.save(open.name,body(open,{headline:'Intended destination'}));
  const update=adapter.update.bind(adapter);adapter.update=async next=>{await update(next);throw new Error('Lost response');};
  await assert.rejects(()=>service.publish(open.name,{version:saved.version,confirmName:open.name,sample:open.sample}),/could not be confirmed/);
  const [publication]=store.publications(open.name);assert.equal(publication.results[0].outcome,'uncertain');
  const result=spawnSync(process.execPath,['scripts/recover.js',open.name,'--server-stopped'],{env:{...process.env,HOUSE_COPY_ADAPTER:'fake',HOUSE_COPY_DB:path},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(store.publication(open.name,publication.id).results.map(r=>r.outcome),['uncertain','recovered_success']);
  assert.deepEqual(store.publication(open.name,publication.id).after,saved.template);
});
test('absent parts stay absent and real SES requires a change reason',async t=>{
  const {service,adapter}=setup(t);const name=fixtures[0].name;
  await adapter.update({name,subject:'Hello {{name}}'});service.config.templates[0].fields=[{id:'subject',targets:[{part:'subject'}]}];
  let open=await service.open(name);const saved=await service.save(name,body(open,{subject:'Welcome {{name}}'}));
  service.scope={mode:'aws',region:'example-region',account:'000000000000',environment:'staging'};
  await assert.rejects(()=>service.publish(name,{version:saved.version,confirmName:name,sample:{name:'Alex'}}),/change reason/);
  open=await service.publish(name,{version:saved.version,confirmName:name,sample:{name:'Alex'},reason:'Clarify subject'});
  assert.deepEqual(service.publication(name,open.publications[0].id).after,{name,subject:'Welcome {{name}}'});
  assert.equal(service.publication(name,open.publications[0].id).parts.find(p=>p.part==='html').after,null);
});


test('additive migration preserves legacy revisions and refuses a future database version',t=>{
  const {dir}=setup(t),path=join(dir,'legacy.sqlite'),legacy=new DatabaseSync(path);
  legacy.exec('CREATE TABLE revisions (id TEXT PRIMARY KEY,name TEXT NOT NULL,created TEXT NOT NULL,document TEXT NOT NULL)');
  const record={id:'legacy-id',created:'2026-01-01T00:00:00.000Z',template:fixtures[0],reason:'Before publish'};
  legacy.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(record.id,fixtures[0].name,record.created,JSON.stringify(record));legacy.close();
  const migrated=new Store(path);
  assert.deepEqual(migrated.revision(fixtures[0].name,'legacy-id'),record);assert.equal(migrated.publications(fixtures[0].name).length,0);
  assert.throws(()=>migrated.db.prepare("UPDATE revisions SET document='{}'").run(),/append-only/);
  migrated.db.exec('PRAGMA user_version=99');migrated.close();
  assert.throws(()=>new Store(path),/newer than/);
});
