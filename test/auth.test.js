import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup,fixtures,body } from './helpers.js';
import { secureApp } from './support/secure-app.js';
import { changeAccess } from '../scripts/auth-access.js';
import { OidcAuth,validateAuthPolicy,validateRuntimeSecurity } from '../src/auth.js';
async function fixture(t,options={}) {
  const base=setup(t),secure=await secureApp({...base,...options});
  t.after(()=>secure.close());
  return {...base,...secure};
}
const template=fixtures[0].name;

test('signed OIDC flow binds state, nonce and PKCE; returns a secure opaque session and individual identity',async t=>{
  const f=await fixture(t),login=await f.login();
  assert.equal(login.response.status,302,await login.response.text());
  assert.equal(login.session.user.subject,'publisher');assert.equal(login.session.user.role,'publisher');
  const header=login.response.headers.getSetCookie().find(v=>v.startsWith('__Host-house-copy='));
  for(const attribute of ['HttpOnly','Secure','SameSite=Lax','Path=/']) assert.ok(header.includes(attribute));
  assert.ok(!header.includes('Domain='));
  const persisted=JSON.stringify(f.store.db.prepare('SELECT * FROM auth_sessions').all());
  assert.ok(!persisted.includes(login.cookie.split('=')[1]));
  assert.ok(!persisted.includes('synthetic-access-token'));
  assert.equal((await f.request('/api/templates')).status,401);
  assert.equal((await f.request('/api/templates',{headers:{'X-Auth-Request-User':'publisher','X-Forwarded-User':'publisher',Authorization:'Basic ZWRpdG9yOnBhc3M='}})).status,401);
});

test('OIDC rejects wrong signature, issuer, audience, nonce, expired tokens and stale authentication',async t=>{
  const f=await fixture(t);
  for(const fault of ['signature','issuer','audience','nonce','expired','auth_time']) {
    f.provider.settings.fault=fault;
    const response=await f.finish(await f.flow());
    assert.equal(response.status,401,fault);
    assert.ok(!response.headers.getSetCookie().some(v=>/^__Host-house-copy=[^;]/.test(v)));
  }
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n,0);
});

test('callback replay, missing browser transaction, wrong state and invalid PKCE never create a session',async t=>{
  const f=await fixture(t);
  const first=await f.flow();
  assert.equal((await f.finish(first)).status,302);
  assert.equal((await f.finish(first)).status,401);
  const missing=await f.flow();assert.equal((await f.request(missing.callback)).status,401);
  const wrongState=await f.flow();const url=new URL(wrongState.callback);url.searchParams.set('state','attacker-state');
  assert.equal((await f.finish({...wrongState,callback:url.href})).status,401);
  const wrongPkce=await f.flow();
  f.store.db.exec("UPDATE auth_logins SET document=json_set(document,'$.verifier','invalid-verifier')");
  assert.equal((await f.finish(wrongPkce)).status,401);
  const expired=await f.flow();f.advance(5*60*1000);
  assert.equal((await f.finish(expired)).status,401);
});

test('unknown and disabled users and publishers without signed MFA are denied; configured acr is supported',async t=>{
  const f=await fixture(t);
  assert.equal((await f.login('unlisted')).response.status,403);
  f.policy.users[0].disabled=true;
  assert.equal((await f.login('editor',[])).response.status,403);
  assert.equal((await f.login('publisher',['pwd'])).response.status,403);
  f.policy.mfaAcrValues=['urn:example:verified-mfa'];f.provider.settings.acr='urn:example:verified-mfa';
  assert.equal((await f.login('publisher',['pwd'])).response.status,302);
});

test('editors can draft and preview, while only a publisher can publish and restore with actor audit evidence',async t=>{
  const f=await fixture(t),editor=await f.login('editor',[]);
  const open=await (await f.request(`/api/templates/${template}`,{headers:{Cookie:editor.cookie}})).json();
  const saved=await (await f.request(`/api/templates/${template}/draft`,{method:'PUT',headers:{Cookie:editor.cookie,Origin:f.origin,'Content-Type':'application/json','X-House-Copy':'1','X-CSRF-Token':editor.session.csrfToken},body:JSON.stringify(body(open,{headline:'Audited new headline'}))})).json();
  assert.ok(saved.version);
  assert.equal((await f.write(`/api/templates/${template}/preview`,editor,{version:saved.version,fields:{},sample:open.sample})).status,200);
  const publishBody={version:saved.version,confirmName:template,sample:open.sample};
  assert.equal((await f.write(`/api/templates/${template}/publish`,editor,publishBody,{'X-Role':'publisher'})).status,403);
  assert.equal((await f.write(`/api/templates/${template}/revisions/unknown/restore`,editor,{})).status,403);
  const publisher=await f.login();
  const response=await f.write(`/api/templates/${template}/publish`,publisher,publishBody);
  assert.equal(response.status,200,await response.clone().text());
  const published=await response.json(),revision=published.revisions[0];
  assert.equal(revision.actor.subject,'publisher');assert.equal(revision.actor.issuer,f.provider.issuer);assert.ok(revision.requestId);
  assert.equal((await f.write(`/api/templates/${template}/revisions/${revision.id}/restore`,publisher,{confirmName:template,currentHash:published.currentHash})).status,200);
  assert.deepEqual(await f.adapter.get(template),open.template);
  const events=f.store.db.prepare('SELECT document FROM audit_events').all().map(r=>JSON.parse(r.document));
  assert.ok(events.some(e=>e.action==='draft.save' && e.actor.subject==='editor'));
  assert.ok(events.some(e=>e.action==='template.publish' && e.outcome==='started' && e.revision===revision.id));
  assert.ok(events.some(e=>e.action==='template.restore' && e.outcome==='success' && e.actor.subject==='publisher'));
  const logs=JSON.stringify(events);
  const exported=spawnSync(process.execPath,['scripts/audit-export.js'],{env:{...process.env,HOUSE_COPY_DB:f.path},encoding:'utf8'});
  assert.equal(exported.status,0,exported.stderr);
  assert.ok(exported.stdout.split('\n').filter(Boolean).every(line=>JSON.parse(line).id));
  for(const secret of ['Audited new headline','synthetic-access-token',publisher.session.csrfToken,publisher.cookie.split('=')[1],f.provider.secret,'Alex','Spring launch']) assert.ok(!logs.includes(secret),`Unexpected sensitive value in audit: ${secret.slice(0,8)}`);
  assert.ok(!exported.stdout.includes(publisher.session.csrfToken));assert.ok(!exported.stdout.includes('Audited new headline'));
});

test('session CSRF tokens and exact origin are required for writes and logout',async t=>{
  const f=await fixture(t),login=await f.login();
  for(const extra of [{'X-CSRF-Token':''},{'X-CSRF-Token':'wrong-token'},{Origin:'https://evil.example.test'}]) assert.equal((await f.write('/auth/logout',login,{},extra)).status,403);
  assert.equal((await f.write('/auth/logout',login)).status,200);
  assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,401);
});

test('idle and absolute expiry invalidate sessions and cookie replay fails',async t=>{
  const f=await fixture(t);
  let login=await f.login();f.advance(15*60*1000);
  assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,401);
  login=await f.login();
  for(let i=0;i<3;i++) {f.advance(14*60*1000);assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,200);}
  f.advance(4*60*1000);
  assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,401);
});

test('allowlist changes, local blocking and revocation apply to existing sessions and pending logins',async t=>{
  const f=await fixture(t);let login=await f.login();
  const editor=await f.login('editor',[]);f.policy.users[0].role='publisher';
  assert.equal((await f.request('/auth/session',{headers:{Cookie:editor.cookie}})).status,403);
  f.policy.users[0].role='editor';
  f.policy.users[1].role='editor';
  const changed=await (await f.request('/auth/session',{headers:{Cookie:login.cookie}})).json();assert.equal(changed.user.role,'editor');
  f.policy.users[1].disabled=true;
  assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,403);
  f.policy.users[1].disabled=false;f.policy.users[1].role='publisher';
  login=await f.login();changeAccess(f.store,f.provider.issuer,'publisher','revoke');
  assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,401);
  const flow=await f.flow();changeAccess(f.store,f.provider.issuer,'publisher','block');
  assert.equal((await f.finish(flow)).status,403);
  changeAccess(f.store,f.provider.issuer,'publisher','unblock');
  assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,401);
  const active=await f.login();assert.equal(active.response.status,302);
  f.policy.users=[];
  assert.equal((await f.request('/auth/session',{headers:{Cookie:active.cookie}})).status,503);
});

test('authentication and API throttling returns 429 without trusting forwarded headers',async t=>{
  const f=await fixture(t,{limits:{auth:2,api:2}});
  assert.equal((await f.request('/api/templates')).status,401);
  assert.equal((await f.request('/api/templates')).status,401);
  assert.equal((await f.request('/api/templates',{headers:{'X-Forwarded-For':'203.0.113.1'}})).status,429);
  assert.equal((await f.request('/auth/login')).status,302);
  assert.equal((await f.request('/auth/login')).status,302);
  assert.equal((await f.request('/auth/login')).status,429);
});

test('real SES refuses missing auth, demo, non-HTTPS and malformed policies before any AWS calls',()=>{
  for(const settings of [{mode:'aws',authMode:'demo',origin:'http://localhost:3210'},{mode:'aws',origin:'https://example.test'},{mode:'aws',authMode:'oidc',origin:'http://example.test',policyFile:'x',secretFile:'x'}]) assert.throws(()=>validateRuntimeSecurity(settings));
  assert.throws(()=>validateAuthPolicy({issuer:'http://idp.example.test',clientId:'x',users:[]}));
  validateRuntimeSecurity({mode:'fake',authMode:'demo',origin:'http://localhost:3210'});
});


test('sessions cannot cross an issuer or client registration change',async t=>{
  const f=await fixture(t),login=await f.login();
  const changed=new OidcAuth(f.store,{origin:f.origin,clientSecret:'synthetic-other-secret',loadPolicy:()=>({...f.policy,issuer:'https://different.example.test',clientId:'different-client'})});
  const actor=changed.authenticate({headers:{cookie:login.cookie}},{clearCookie(){}});
  assert.equal(actor,undefined);
  assert.equal((await f.request('/auth/session',{headers:{Cookie:login.cookie}})).status,401);
});


test('startup rejects unsafe auth before AWS access and redacts malformed private configuration',t=>{
  const {dir,path}=setup(t);
  const policyPath=join(dir,'private-auth.json'),secretPath=join(dir,'private-secret');
  const marker='SYNTHETIC_PRIVATE_VALUE_MUST_NOT_APPEAR';
  writeFileSync(policyPath,marker);writeFileSync(secretPath,marker);
  const cases=[
    {HOUSE_COPY_ADAPTER:'aws',HOUSE_COPY_AUTH:'demo',HOUSE_COPY_ORIGIN:'http://localhost:3210'},
    {HOUSE_COPY_ADAPTER:'fake',HOUSE_COPY_AUTH:'oidc',HOUSE_COPY_ORIGIN:'https://copy.example.test',HOUSE_COPY_AUTH_CONFIG:policyPath,HOUSE_COPY_OIDC_SECRET_FILE:secretPath}
  ];
  for(const variables of cases) {
    const result=spawnSync(process.execPath,['src/server.js'],{env:{...process.env,HOUSE_COPY_DB:path,...variables},encoding:'utf8',timeout:5000});
    assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/House Copy could not start during/);
    assert.ok(!result.stderr.includes(marker));assert.ok(!result.stderr.includes('SyntaxError'));
  }
});
