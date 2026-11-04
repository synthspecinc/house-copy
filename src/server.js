import { readFileSync } from 'node:fs';
import { Store } from './store.js';
import { FakeSes, AwsSes, verifyAccount } from './adapters.js';
import { TemplateService } from './service.js';
import { createApp } from './app.js';
import { OidcAuth,readAuthPolicy,validateRuntimeSecurity } from './auth.js';

let phase='security configuration',store;
async function start() {
const mode=process.env.HOUSE_COPY_ADAPTER || 'fake';
if(!['fake','aws'].includes(mode)) throw new Error('HOUSE_COPY_ADAPTER must be fake or aws.');
const port=Number(process.env.PORT || 3210),region=process.env.AWS_REGION,account=process.env.HOUSE_COPY_AWS_ACCOUNT_ID;
const origin=process.env.HOUSE_COPY_ORIGIN || `http://localhost:${port}`;
const authMode=process.env.HOUSE_COPY_AUTH,policyFile=process.env.HOUSE_COPY_AUTH_CONFIG,secretFile=process.env.HOUSE_COPY_OIDC_SECRET_FILE;
validateRuntimeSecurity({mode,authMode,origin,policyFile,secretFile});
if(process.env.HOUSE_COPY_PASSWORD_FILE) throw new Error('Shared Basic authentication is no longer supported. Configure OIDC.');
phase='database';
store=new Store(process.env.HOUSE_COPY_DB || './data/house-copy.sqlite');
store.bindScope(mode,region,account);
phase='OIDC discovery';
const auth=authMode==='oidc'?await new OidcAuth(store,{origin,loadPolicy:()=>readAuthPolicy(policyFile),clientSecret:readFileSync(secretFile,'utf8').trim()}).initialize():undefined;
phase='AWS account verification';
if(mode==='aws') await verifyAccount(region,account);
phase='template configuration';
const config=JSON.parse(readFileSync(process.env.HOUSE_COPY_CONFIG || './config/templates.json','utf8'));
const adapter=mode==='fake'?new FakeSes(store,JSON.parse(readFileSync('./fixtures/templates.json','utf8'))):new AwsSes(region);
const service=new TemplateService(store,adapter,config,{environment:process.env.HOUSE_COPY_ENVIRONMENT});
phase='HTTP listener';
const server=createApp(service,{origin,auth,mode}).listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`House Copy is listening on port ${port} in ${mode} mode with ${authMode} authentication.`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
start().catch(()=>{
  store?.close();
  console.error(`House Copy could not start during ${phase}. Check the private operator configuration and service access.`);
  process.exitCode=1;
});
