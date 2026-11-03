import test from 'node:test';
import assert from 'node:assert/strict';
import { setup,fixtures } from './helpers.js';
import { createApp } from '../src/app.js';

test('demo HTTP boundary requires same-origin JSON writes and hides provider content',async t=>{
  const {service,adapter}=setup(t);
  const server=createApp(service,{origin:'http://localhost:3210'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status,200);
  assert.equal((await fetch(`${base}/api/templates`)).status,200);
  const url=`${base}/api/templates/${fixtures[0].name}/draft`;
  for(const headers of [{'Content-Type':'application/json'},{Origin:'https://evil.example','Content-Type':'application/json','X-House-Copy':'1'}]) assert.equal((await fetch(url,{method:'PUT',headers,body:'{}'})).status,403);
  const headers={Origin:'http://localhost:3210','Content-Type':'application/json','X-House-Copy':'1'};
  assert.equal((await fetch(url,{method:'PUT',headers,body:'invalid'})).status,400);
  assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify({text:'x'.repeat(210000)})})).status,413);
  adapter.get=async()=>{throw new Error('PRIVATE TEMPLATE CONTENT');};
  const result=await fetch(`${base}/api/templates/${fixtures[0].name}`);
  assert.equal(result.status,502); assert.doesNotMatch(await result.text(),/PRIVATE/);
});
