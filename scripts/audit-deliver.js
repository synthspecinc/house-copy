import { Store } from '../src/store.js';
import { AuditDelivery,auditConfiguration } from '../src/audit-delivery.js';
async function main() {
  if(process.argv[2]!=='--once') throw new Error('Use --once.');
  const options=auditConfiguration(process.env,process.env.HOUSE_COPY_ADAPTER || 'fake');
  if(!options.url) throw new Error('Configure a collector.');
  const store=new Store(process.env.HOUSE_COPY_DB || './data/house-copy.sqlite');
  try {
    const delivery=new AuditDelivery(store,options),result=await delivery.runOnce();
    console.log(JSON.stringify(result));if(result.pendingCount) process.exitCode=2;
  } finally {store.close();}
}
main().catch(()=>{console.error('Audit delivery failed. Check the private collector configuration and database.');process.exitCode=1;});
