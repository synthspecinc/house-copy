import test from 'node:test';
import assert from 'node:assert/strict';
import { setup,fixtures } from './helpers.js';
import { createApp } from '../src/app.js';

test('HTTP boundary requires authentication, same-origin JSON writes and hides provider content',async t=>{
  const {service,adapter}=setup(t);
  const server=createApp(service,{password:'a-test-password',origin:'http://localhost:3210'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`; const auth={Authorization:`Basic ${Buffer.from('editor:a-test-password').toString('base64')}`};
  assert.equal((await fetch(`${base}/health`)).status,200);
  assert.equal((await fetch(`${base}/api/templates`)).status,401);
  assert.equal((await fetch(`${base}/api/templates`,{headers:auth})).status,200);
  const url=`${base}/api/templates/${fixtures[0].name}/draft`;
  for(const headers of [{...auth,'Content-Type':'application/json'}, {...auth,Origin:'https://evil.example','Content-Type':'application/json','X-House-Copy':'1'}]) assert.equal((await fetch(url,{method:'PUT',headers,body:'{}'})).status,403);
  const headers={...auth,Origin:'http://localhost:3210','Content-Type':'application/json','X-House-Copy':'1'};
  assert.equal((await fetch(url,{method:'PUT',headers,body:'invalid'})).status,400);
  adapter.get=async()=>{throw new Error('PRIVATE TEMPLATE CONTENT');};
  const result=await fetch(`${base}/api/templates/${fixtures[0].name}`,{headers:auth});
  assert.equal(result.status,502); assert.doesNotMatch(await result.text(),/PRIVATE/);
});
