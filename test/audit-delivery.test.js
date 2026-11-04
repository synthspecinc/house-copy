import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setup,body,fixtures } from './helpers.js';
import { auditCollector } from './support/audit-collector.js';
import { secureApp } from './support/secure-app.js';
import { AuditDelivery,auditConfiguration } from '../src/audit-delivery.js';
import { Store } from '../src/store.js';
import { changeAccess } from '../scripts/auth-access.js';
const destination={url:'https://collector.example.test/events',token:'synthetic-collector-token'};
const acknowledge=async(url,options)=>new Response(JSON.stringify({accepted:true,eventId:JSON.parse(options.body).eventId}));
const envelopes=store=>store.db.prepare('SELECT * FROM audit_outbox ORDER BY seq').all();

test('event and envelope commit together, redact unapproved fields and resist modification',t=>{
  const {store}=setup(t),id=store.audit('test.event',{actor:{issuer:'https://id.example.test',subject:'alex',role:'publisher',token:'PRIVATE'},scope:{environment:'test',mode:'fake'},requestId:'request-1',template:'allowed-template',sample:{secret:'PRIVATE'},html:'PRIVATE',reason:'PRIVATE',error:'PRIVATE'});
  const [row]=envelopes(store),envelope=JSON.parse(row.payload);
  assert.equal(row.event_id,id);assert.equal(envelope.schemaVersion,1);assert.equal(envelope.eventId,id);assert.equal(envelope.event.actor.subject,'alex');assert.equal(envelope.event.scope.environment,'test');
  assert.ok(!row.payload.includes('PRIVATE'));assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,1);
  for(const sql of ['DELETE FROM audit_events',"UPDATE audit_events SET document='{}'",'DELETE FROM audit_outbox',"UPDATE audit_outbox SET payload='{}'"]) assert.throws(()=>store.db.exec(sql));
  store.db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON audit_outbox BEGIN SELECT RAISE(ABORT,'simulated outbox failure'); END");
  assert.throws(()=>store.audit('must.rollback'),/simulated/);
  assert.equal(envelopes(store).length,1);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,1);
  assert.throws(()=>store.transaction(()=>{store.audit('outer.rollback');throw new Error('rollback');}));assert.equal(envelopes(store).length,1);
});

test('legacy backfill is transactional, redacted and deterministic across backup replay',t=>{
  const {dir}=setup(t),ids=[];
  for(const suffix of ['first','restored']) {
    const path=join(dir,`${suffix}.sqlite`),db=new DatabaseSync(path);
    db.exec('CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,document TEXT NOT NULL)');
    db.prepare('INSERT INTO audit_events (created,document) VALUES (?,?)').run('2026-01-01T00:00:00.000Z',JSON.stringify({created:'2026-01-01T00:00:00.000Z',action:'legacy',outcome:'success',html:'PRIVATE',token:'PRIVATE'}));db.close();
    const migrated=new Store(path),[row]=envelopes(migrated);ids.push(row.event_id);
    assert.match(row.event_id,/^legacy-[a-f0-9]{64}$/);assert.ok(!row.payload.includes('PRIVATE'));migrated.close();
    const reopened=new Store(path);assert.equal(envelopes(reopened).length,1);assert.equal(envelopes(reopened)[0].event_id,row.event_id);reopened.close();
  }
  assert.equal(ids[0],ids[1]);
});

test('local HTTPS collector durably stores envelopes and delivery appends immutable receipts',async t=>{
  const {store,dir}=setup(t),collector=await auditCollector(t,dir),delivery=new AuditDelivery(store,collector);
  const ids=[store.audit('one'),store.audit('two')],result=await delivery.runOnce();
  assert.equal(result.delivered,2);assert.equal(result.pendingCount,0);assert.ok(result.lastDeliveryAt);
  assert.deepEqual(collector.requests.map(r=>r.id),ids);assert.equal(collector.db.prepare('SELECT COUNT(*) AS n FROM received').get().n,2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM audit_receipts').get().n,2);
  for(const sql of ['DELETE FROM audit_receipts',"UPDATE audit_receipts SET acknowledged='changed'"]) assert.throws(()=>store.db.exec(sql));
  assert.equal(envelopes(store).length,2);assert.ok(!JSON.stringify(delivery.health()).includes(collector.token));
});

for(const [fault,category] of [['wrong_ack','ack_error'],['status','http_error'],['timeout','timeout'],['lost_ack','transport_error'],['redirect','transport_error']]) {
  test(`${fault} retains evidence and retry state, then retries in order after restart`,async t=>{
    const {store,path,dir}=setup(t),collector=await auditCollector(t,dir);let clock=Date.now();
    const options={...collector,now:()=>clock,timeoutMs:50},delivery=new AuditDelivery(store,options),ids=[store.audit('first'),store.audit('second')];
    collector.settings.fault=fault;
    const failed=await delivery.runOnce();assert.equal(failed.delivered,0);assert.equal(failed.pendingCount,2);assert.equal(failed.attempts,1);assert.equal(failed.lastError,category);
    assert.equal((await delivery.runOnce()).delivered,0);assert.equal(collector.requests.length,1);
    assert.ok(!JSON.stringify(envelopes(store)).includes('PRIVATE_RECEIVER_ERROR'));
    const restartedStore=new Store(path);t.after(()=>restartedStore.close());
    const restarted=new AuditDelivery(restartedStore,options);collector.settings.fault=undefined;clock+=1001;
    assert.equal((await restarted.runOnce()).pendingCount,0);assert.deepEqual(collector.requests.map(r=>r.id),[ids[0],...ids]);
    assert.equal(collector.db.prepare('SELECT COUNT(*) AS n FROM received').get().n,2);
  });
}

test('empty, oversized and mismatched acknowledgement bodies cannot mark delivery complete',async t=>{
  const {store}=setup(t);store.audit('pending');let clock=Date.now();
  for(const body of ['',JSON.stringify({accepted:true,eventId:'wrong'}),'x'.repeat(16385)]) {
    const delivery=new AuditDelivery(store,{...destination,now:()=>clock,transport:async()=>new Response(body)});
    const result=await delivery.runOnce();assert.equal(result.pendingCount,1);assert.equal(result.lastError,'ack_error');clock+=60001;
  }
});

test('one SQLite lease excludes competing workers and an expired worker cannot acknowledge',async t=>{
  const {store,path}=setup(t);const otherStore=new Store(path);t.after(()=>otherStore.close());let clock=Date.now(),release,entered;
  const ready=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve),requests=[];
  const transport=async(url,options)=>{requests.push(JSON.parse(options.body).eventId);entered();await waiting;return acknowledge(url,options);};
  const first=new AuditDelivery(store,{...destination,now:()=>clock,transport}),second=new AuditDelivery(otherStore,{...destination,now:()=>clock,transport:acknowledge});
  const id=store.audit('one'),running=first.runOnce();await ready;
  assert.equal((await second.runOnce()).busy,true);clock+=30001;release();assert.equal((await running).delivered,0);assert.equal(first.health().pendingCount,1);
  assert.equal((await second.runOnce()).delivered,1);assert.deepEqual(requests,[id]);assert.equal(first.health().pendingCount,0);
});

test('required backlog count and age pause both publish and restore before SES, then clear on acknowledgement',async t=>{
  const {store,service,adapter}=setup(t),name=fixtures[0].name;let clock=Date.now();
  const delivery=new AuditDelivery(store,{...destination,required:true,maxPending:1,maxAgeMs:100,now:()=>clock,transport:acknowledge});service.publicationGate=()=>delivery.assertCanPublish();
  const open=await service.open(name),saved=await service.save(name,body(open,{headline:'Audit-gated publication'}));
  const originalUpdate=adapter.update.bind(adapter);let updates=0;adapter.update=async value=>{updates++;return originalUpdate(value);};
  store.audit('pending');assert.equal(delivery.health().publishingPaused,true);
  await assert.rejects(()=>service.publish(name,{version:saved.version,confirmName:name,sample:open.sample}),/paused/);assert.equal(updates,0);
  await delivery.runOnce();await service.publish(name,{version:saved.version,confirmName:name,sample:open.sample});assert.equal(updates,1);
  const revision=store.revisions(name)[0];
  const current=await service.open(name);
  await assert.rejects(()=>service.restore(name,revision.id,{confirmName:name,currentHash:current.currentHash,sample:open.sample}),/paused/);assert.equal(updates,1);
  await delivery.runOnce();delivery.maxPending=100;store.audit('age-test');clock=Date.now()+1000;assert.equal(delivery.health().publishingPaused,true);
  await delivery.runOnce();assert.equal(delivery.health().publishingPaused,false);
  await service.restore(name,revision.id,{confirmName:name,currentHash:current.currentHash,sample:open.sample});assert.equal(updates,2);
});

test('one-shot delivery CLI sends over verified TLS, preserves failures and reports exit codes without credentials',async t=>{
  const {store,path,dir}=setup(t),collector=await auditCollector(t,dir),run=promisify(execFile);
  const env={...process.env,HOUSE_COPY_DB:path,HOUSE_COPY_ADAPTER:'fake',HOUSE_COPY_AUDIT_URL:collector.url,HOUSE_COPY_AUDIT_TOKEN_FILE:join(dir,'collector-token'),NODE_EXTRA_CA_CERTS:collector.caFile};
  writeFileSync(env.HOUSE_COPY_AUDIT_TOKEN_FILE,collector.token);
  store.audit('cli.success');const success=await run(process.execPath,['scripts/audit-deliver.js','--once'],{env});assert.equal(JSON.parse(success.stdout).pendingCount,0);
  store.audit('cli.retry');collector.settings.fault='status';
  await assert.rejects(()=>run(process.execPath,['scripts/audit-deliver.js','--once'],{env}),error=>error.code===2 && JSON.parse(error.stdout).pendingCount===1 && !error.stdout.includes(collector.token));
  collector.settings.fault=undefined;store.db.exec('UPDATE audit_outbox SET next_attempt=0 WHERE delivered_at IS NULL');
  assert.equal(JSON.parse((await run(process.execPath,['scripts/audit-deliver.js','--once'],{env})).stdout).pendingCount,0);
  await assert.rejects(()=>run(process.execPath,['scripts/audit-deliver.js','--once'],{env:{...env,HOUSE_COPY_AUDIT_URL:'http://PRIVATE_MARKER.example.test'}}),error=>error.code===1 && !error.stderr.includes('PRIVATE_MARKER'));
});

test('unsafe configuration, destination changes and required missing configuration refuse startup without secrets',t=>{
  const {store,dir,path}=setup(t),tokenFile=join(dir,'token');writeFileSync(tokenFile,destination.token);
  const env={HOUSE_COPY_AUDIT_URL:destination.url,HOUSE_COPY_AUDIT_TOKEN_FILE:tokenFile};
  assert.equal(auditConfiguration(env,'aws').required,true);assert.equal(auditConfiguration({},'fake').required,false);
  assert.throws(()=>auditConfiguration({},'aws'));
  for(const url of ['http://collector.example.test','https://user:password@collector.example.test','https://collector.example.test/?secret=x','https://collector.example.test/#secret',' https://collector.example.test']) {
    assert.throws(()=>auditConfiguration({...env,HOUSE_COPY_AUDIT_URL:url},'aws'));
    assert.throws(()=>new AuditDelivery(store,{...destination,url}));
  }
  for(const setting of [{HOUSE_COPY_AUDIT_REQUIRED:'yes'},{HOUSE_COPY_AUDIT_MAX_PENDING:'0'},{HOUSE_COPY_AUDIT_MAX_AGE_SECONDS:'NaN'}]) assert.throws(()=>auditConfiguration({...env,...setting},'fake'));
  new AuditDelivery(store,destination);assert.throws(()=>new AuditDelivery(store,{...destination,url:'https://different.example.test/events'}),/destination changed/);
  new AuditDelivery(store,{...destination,token:'rotated-synthetic-token'});
  const result=spawnSync(process.execPath,['src/server.js'],{env:{...process.env,HOUSE_COPY_ADAPTER:'fake',HOUSE_COPY_AUTH:'demo',HOUSE_COPY_DB:path,HOUSE_COPY_AUDIT_REQUIRED:'true',HOUSE_COPY_AUDIT_URL:'https://PRIVATE_MARKER@collector.example.test'},encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.ok(!result.stderr.includes('PRIVATE_MARKER'));assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM settings').all()).includes(destination.token));
});

test('publisher-only delivery health excludes endpoint, credentials and audit contents',async t=>{
  const base=setup(t),delivery=new AuditDelivery(base.store,{...destination,required:true,maxPending:1,transport:acknowledge}),f=await secureApp({...base,delivery});t.after(()=>f.close());
  assert.equal((await f.request('/api/audit-delivery')).status,401);
  const editor=await f.login('editor',[]);assert.equal((await f.request('/api/audit-delivery',{headers:{Cookie:editor.cookie}})).status,403);
  const publisher=await f.login(),response=await f.request('/api/audit-delivery',{headers:{Cookie:publisher.cookie}}),health=await response.json();
  assert.equal(response.status,200);assert.equal(health.publishingPaused,true);assert.ok(health.pendingCount>0);
  const json=JSON.stringify(health);for(const value of [destination.url,destination.token,'publisher','actor','payload']) assert.ok(!json.includes(value));
  assert.deepEqual(await (await f.request('/health')).json(),{status:'ok'});
});

test('login cannot issue a session without audit intent; logout, block and revoke deny access if audit recording fails',async t=>{
  const base=setup(t),f=await secureApp(base);t.after(()=>f.close());
  const existing=await f.login(),flow=await f.flow();
  base.store.db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON audit_outbox BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END");
  const failed=await f.finish(flow);assert.equal(failed.status,502);assert.ok(!failed.headers.getSetCookie().some(v=>v.startsWith('__Host-house-copy=')));
  assert.equal(base.store.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
  assert.equal((await f.write('/auth/logout',existing)).status,502);assert.equal(base.store.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
  assert.throws(()=>changeAccess(base.store,f.provider.issuer,'publisher','block'),/simulated/);
  assert.equal(base.store.db.prepare('SELECT COUNT(*) AS n FROM auth_blocked').get().n,1);
  assert.throws(()=>changeAccess(base.store,f.provider.issuer,'publisher','unblock'),/simulated/);assert.equal(base.store.db.prepare('SELECT COUNT(*) AS n FROM auth_blocked').get().n,1);
  base.store.db.exec('DROP TRIGGER fail_outbox');changeAccess(base.store,f.provider.issuer,'publisher','unblock');const login=await f.login();
  base.store.db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON audit_outbox BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END");
  assert.throws(()=>changeAccess(base.store,f.provider.issuer,'publisher','revoke'),/simulated/);assert.equal(base.store.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
  base.store.db.exec('DROP TRIGGER fail_outbox');assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,401);
});
