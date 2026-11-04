import assert from 'node:assert/strict';
const origin=process.env.HOUSE_COPY_TEST_URL;
if(!origin || !/^http:\/\/localhost:\d+$/.test(origin)) throw new Error('Use only the local disposable container URL.');
const name='house-copy-welcome';
const call=async(path,method='GET',body)=>{
  const response=await fetch(`${origin}/api/templates/${name}${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json','X-House-Copy':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(response.ok,true,await response.clone().text()); return response.json();
};
const open=await call('');
if(process.argv[2]==='before') {
  const saved=await call('/draft','PUT',{version:open.version,baseHash:open.baseHash,mappingHash:open.mappingHash,fields:{headline:'Container persistence verified'}});
  await call('/publish','POST',{version:saved.version,confirmName:name,sample:open.sample});
} else {
  assert.equal(open.template.html.includes('Container persistence verified'),true);
  assert.equal(open.hasDraft,false);
  assert.equal(open.revisions.length>=3,true);
  assert.equal(open.fields.find(f=>f.id==='headline').value,'Container persistence verified');
}
console.log(`Persistence ${process.argv[2]} check passed.`);
