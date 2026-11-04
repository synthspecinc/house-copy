import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setup,fixtures } from './helpers.js';

for(const outcome of ['previous','next','unknown']) test(`offline recovery reconciles ${outcome} state without remote writes`,async t=>{
  const {store,adapter,path}=setup(t);
  store.bindScope('fake');
  const previous=fixtures[0], next={...previous,subject:'Next {{company.name}} {{person.firstName}}'};
  store.snapshot(previous.name,previous,'Before publish');
  store.operation(previous.name,{previous,next});
  store.saveDraft(previous.name,{template:next,version:'test'});
  store.db.prepare('INSERT INTO locks VALUES (?,?)').run(previous.name,'crashed-writer');
  if(outcome==='next') await adapter.update(next);
  if(outcome==='unknown') await adapter.update({...previous,subject:'Unrelated change'});
  const result=spawnSync(process.execPath,['scripts/recover.js',previous.name,'--server-stopped'],{env:{...process.env,HOUSE_COPY_ADAPTER:'fake',HOUSE_COPY_DB:path},encoding:'utf8'});
  assert.equal(result.status,outcome==='unknown'?1:0,result.stderr);
  assert.equal(store.pending(previous.name).length,outcome==='unknown'?1:0);
  assert.equal(store.revisions(previous.name).length,1);
  assert.equal(!!store.draft(previous.name),outcome!=='next');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM locks').get().n,outcome==='unknown'?1:0);
  assert.deepEqual(await adapter.get(previous.name),outcome==='next'?next:outcome==='previous'?previous:{...previous,subject:'Unrelated change'});
});
test('databases cannot be rebound to another account, region or adapter',t=>{
  const {store}=setup(t); store.bindScope('aws','test-region','000000000000');
  store.bindScope('aws','test-region','000000000000');
  for(const args of [['fake'],['aws','other-region','000000000000'],['aws','test-region','111111111111']]) assert.throws(()=>store.bindScope(...args),/different adapter, region or account/);
});
