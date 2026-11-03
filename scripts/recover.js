// Run only while the server is stopped. Never print full template content.
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { FakeSes,AwsSes,verifyAccount } from '../src/adapters.js';
import { fingerprint } from '../src/editor.js';
const [name,confirmation]=process.argv.slice(2);
if(!/^[\w-]{1,64}$/.test(name || '') || confirmation!=='--server-stopped') throw new Error('Usage: node scripts/recover.js TEMPLATE_NAME --server-stopped');
const mode=process.env.HOUSE_COPY_ADAPTER || 'fake';
if(!['fake','aws'].includes(mode)) throw new Error('Invalid adapter.');
const store=new Store(process.env.HOUSE_COPY_DB || './data/house-copy.sqlite');
try {
  store.bindScope(mode,process.env.AWS_REGION,process.env.HOUSE_COPY_AWS_ACCOUNT_ID);
  if(mode==='aws') await verifyAccount(process.env.AWS_REGION,process.env.HOUSE_COPY_AWS_ACCOUNT_ID);
  const config=JSON.parse(readFileSync(process.env.HOUSE_COPY_CONFIG || './config/templates.json','utf8'));
  if(!config.templates.some(t=>t.name===name)) throw new Error('Template is not configured.');
  const adapter=mode==='fake'?new FakeSes(store,[]):new AwsSes(process.env.AWS_REGION);
  const current=await adapter.get(name);
  for(const pending of store.pending(name)) {
    const hash=fingerprint(current);
    if(hash!==fingerprint(pending.next) && hash!==fingerprint(pending.previous)) throw new Error('Current template matches neither recorded state. Retain the evidence and reconcile manually before recovery.');
    if(hash===fingerprint(pending.next)) store.deleteDraft(name);
    store.finish(pending.id);
    console.log(hash===fingerprint(pending.next)?'Confirmed the intended update. Prior revision retained.':'Confirmed SES still has the prior version. Saved draft retained.');
  }
  store.db.prepare('DELETE FROM locks WHERE name=?').run(name);
  console.log('Recovery complete for the selected template. No remote writes were made.');
} finally {store.close();}
