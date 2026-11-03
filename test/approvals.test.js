import test from 'node:test';
import assert from 'node:assert/strict';
import { setup,body,fixtures } from './helpers.js';
const name=fixtures[0].name;
const context=subject=>({actor:{issuer:'https://identity.example.test',subject,role:'publisher'},requestId:`request-${subject}`});
async function proposed(t) {
  const f=setup(t);f.service.config.publicationPolicy={requireApproval:true,requireTicket:true};
  const open=await f.service.open(name),saved=await f.service.save(name,body(open,{headline:'Reviewed content'}),context('author'));
  const metadata={reason:'Improve the welcome',reference:'CHANGE-100'};
  const request=await f.service.reviews.request(name,{version:saved.version,...metadata},context('author'));
  return {...f,open,saved,metadata,request};
}
test('independent approval binds the exact draft and is consumed once with publication intent',async t=>{
  const f=await proposed(t);
  await assert.rejects(()=>f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('author')),/own change/);
  await f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('reviewer'));
  await assert.rejects(()=>f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('another')),/already/);
  const result=await f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('author'));
  assert.equal(result.hasDraft,false);assert.equal(result.publications[0].reviewId,f.request.id);
  assert.equal(f.service.reviews.get(name,f.request.id).publicationId,result.publications[0].id);
  await assert.rejects(()=>f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('author')),/Save your latest draft/);
});
test('required approvals cannot be bypassed; contributors and editors cannot approve',async t=>{
  const f=await proposed(t);
  await assert.rejects(()=>f.service.publish(name,{version:f.saved.version,confirmName:name,sample:f.open.sample,...f.metadata},context('author')),/approval is required/);
  const editor={actor:{issuer:'https://identity.example.test',subject:'editor',role:'editor'}};
  await assert.rejects(()=>f.service.reviews.decide(name,f.request.id,{decision:'approved'},editor),/publisher/);
  await assert.rejects(()=>f.service.reviews.execute(name,f.request.id,{confirmName:name},editor),/publisher/);
  const next=await f.service.save(name,body(f.saved,{intro:'Another contributor'}),context('contributor'));
  const request=await f.service.reviews.request(name,{version:next.version,...f.metadata},context('author'));
  await assert.rejects(()=>f.service.reviews.decide(name,request.id,{decision:'approved'},context('contributor')),/own change/);
});
for(const mutation of ['draft','mapping','policy','scope','authority','external','metadata']) test(`approval fails closed after ${mutation} changes`,async t=>{
  const f=await proposed(t);await f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('reviewer'));
  let updates=0;const original=f.adapter.update.bind(f.adapter);f.adapter.update=async value=>{updates++;return original(value);};
  if(mutation==='draft') await f.service.save(name,body(f.saved,{headline:'Edited after approval'}),context('author'));
  if(mutation==='mapping') f.service.config.templates[0].label='New mapping';
  if(mutation==='policy') f.service.config.publicationPolicy.requireTicket=false;
  if(mutation==='scope') f.service.scope.environment='different';
  if(mutation==='authority') f.service.authority.isPublisher=()=>false;
  if(mutation==='external') await original({...f.open.template,subject:'Changed externally'});
  if(mutation==='metadata') {
    await assert.rejects(()=>f.service.publish(name,{version:f.saved.version,confirmName:name,sample:f.open.sample,reviewId:f.request.id,...f.metadata,reason:'Different reason'},context('author')),/reason or reference/);
  } else await assert.rejects(()=>f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('author')));
  assert.equal(updates,0);
});
test('restore uses the same independent approval policy, and rejection cannot execute',async t=>{
  const f=await proposed(t);await f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('reviewer'));
  const published=await f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('author'));
  const id=published.revisions[0].id;
  await assert.rejects(()=>f.service.restore(name,id,{currentHash:published.currentHash,confirmName:name,...f.metadata},context('author')),/approval is required/);
  const rejected=await f.service.reviews.request(name,{currentHash:published.currentHash,...f.metadata},context('author'),id);
  await f.service.reviews.decide(name,rejected.id,{decision:'rejected'},context('reviewer'));
  await assert.rejects(()=>f.service.reviews.execute(name,rejected.id,{confirmName:name,sample:f.open.sample},context('author')),/not approved/);
  const request=await f.service.reviews.request(name,{currentHash:published.currentHash,...f.metadata},context('author'),id);
  await f.service.reviews.decide(name,request.id,{decision:'approved'},context('reviewer'));
  const restored=await f.service.reviews.execute(name,request.id,{confirmName:name},context('reviewer'));
  assert.deepEqual(restored.template,f.open.template);
});
test('concurrent executors cause at most one remote write',async t=>{
  const f=await proposed(t);await f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('reviewer'));
  let writes=0;const update=f.adapter.update.bind(f.adapter);f.adapter.update=async next=>{writes++;return update(next);};
  const results=await Promise.allSettled([f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('author')),f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('reviewer'))]);
  assert.equal(writes,1);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('editor authorship, legacy drafts and policy overrides remain fail closed',async t=>{
  const f=setup(t);f.service.config.publicationPolicy={requireApproval:true,requireTicket:true};
  const editor={actor:{issuer:'https://identity.example.test',subject:'editor',role:'editor'}};
  const open=await f.service.open(name),saved=await f.service.save(name,body(open,{headline:'Editor draft'}),editor);
  await assert.rejects(()=>f.service.reviews.request(name,{version:saved.version,reason:'Review me'},editor),/reference/);
  const request=await f.service.reviews.request(name,{version:saved.version,reason:'Review me',reference:'CHANGE-1'},editor);
  assert.equal(request.requester.subject,'editor');
  const legacy={...f.store.draft(name)};delete legacy.authorshipKnown;delete legacy.contributors;f.store.saveDraft(name,legacy);
  await assert.rejects(()=>f.service.reviews.request(name,{version:saved.version,reason:'Review me',reference:'CHANGE-1'},editor),/unknown authorship/);
  f.service.config.templates[0].publicationPolicy={requireTicket:false};assert.equal(f.service.reviews.policy(name).requireApproval,true);assert.equal(f.service.reviews.policy(name).requireTicket,false);
  f.service.config.templates[0].publicationPolicy={requireApproval:'false'};assert.throws(()=>f.service.reviews.policy(name),/boolean/);
});
test('uncertain execution retains consumed approval and concurrent decisions accept one reviewer',async t=>{
  const f=await proposed(t);
  const decisions=await Promise.allSettled([f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('reviewer')),f.service.reviews.decide(name,f.request.id,{decision:'approved'},context('other'))]);
  assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);
  f.adapter.update=async()=>{throw new Error('Network outcome unknown');};
  await assert.rejects(()=>f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('author')),/could not be confirmed/);
  assert.ok(f.service.reviews.get(name,f.request.id).publicationId);assert.equal(f.store.pending(name).length,1);
  await assert.rejects(()=>f.service.reviews.execute(name,f.request.id,{confirmName:name,sample:f.open.sample},context('author')),/already been executed/);
});
