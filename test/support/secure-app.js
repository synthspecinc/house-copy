import https from 'node:https';
import { OidcAuth,SESSION_COOKIE } from '../../src/auth.js';
import { createApp } from '../../src/app.js';
import { identityProvider } from './identity-provider.js';
export async function secureApp({service,store,limits,delivery,appPort=0,idpPort=0}) {
  const provider=await identityProvider({port:idpPort});
  let app;
  const server=https.createServer(provider.tls,(req,res)=>app(req,res));
  await new Promise(resolve=>server.listen(appPort,'127.0.0.1',resolve));
  const origin=`https://127.0.0.1:${server.address().port}`;
  const policy={issuer:provider.issuer,clientId:provider.clientId,users:[{subject:'editor',label:'Alex editor',role:'editor'},{subject:'publisher',label:'Jordan publisher',role:'publisher'}]};
  let clock=Date.now();
  let auth;
  try {auth=await new OidcAuth(store,{origin,clientSecret:provider.secret,loadPolicy:()=>policy,now:()=>clock,transport:provider.transport}).initialize();}
  catch(error) {await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await provider.close();throw error;}
  app=createApp(service,{origin,auth,limits,delivery});
  const request=(path,options={})=>provider.transport(path.startsWith('https:')?path:`${origin}${path}`,{redirect:'manual',...options});
  const flow=async()=>{
    const start=await request('/auth/login');
    const loginCookie=start.headers.getSetCookie().find(v=>v.startsWith('__Host-house-copy-login=')).split(';')[0];
    const authorize=await request(start.headers.get('location'));
    return {loginCookie,callback:authorize.headers.get('location'),authorizeUrl:start.headers.get('location')};
  };
  const finish=({loginCookie,callback})=>request(callback,{headers:{Cookie:loginCookie}});
  const login=async(subject='publisher',amr=['pwd','mfa'])=>{
    provider.settings.subject=subject;provider.settings.amr=amr;provider.settings.fault=undefined;
    const response=await finish(await flow());
    const cookie=response.headers.getSetCookie().find(v=>v.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0];
    const session=cookie?await (await request('/auth/session',{headers:{Cookie:cookie}})).json():undefined;
    return {response,cookie,session};
  };
  const write=(path,login,body={},extra={})=>request(path,{method:'POST',headers:{Cookie:login.cookie,Origin:origin,'Content-Type':'application/json','X-House-Copy':'1','X-CSRF-Token':login.session.csrfToken,...extra},body:JSON.stringify(body)});
  return {provider,policy,auth,origin,request,flow,finish,login,write,advance:ms=>clock+=ms,
    close:async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await provider.close();}};
}
