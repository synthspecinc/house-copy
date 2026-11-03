// Test-only identity provider. Binds to loopback, generates ephemeral keys and never uses real accounts.
import https from 'node:https';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes,createHash } from 'node:crypto';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { Agent } from 'undici';
export async function identityProvider({port=0}={}) {
  const dir=mkdtempSync(join(tmpdir(),'house-copy-idp-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','2','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  const tls={key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))};
  const keys=await generateKeyPair('RS256',{extractable:true}),otherKeys=await generateKeyPair('RS256');
  const jwk={...await exportJWK(keys.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  const codes=new Map(),settings={subject:'publisher',amr:['pwd','mfa'],fault:undefined};
  const secret=randomBytes(32).toString('base64url'),clientId='house-copy-test';
  let issuer;
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const server=https.createServer(tls,async(req,res)=>{
    try {
      const url=new URL(req.url,issuer);
      if(url.pathname==='/.well-known/openid-configuration') return json(res,200,{issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,jwks_uri:`${issuer}/jwks`,response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],code_challenge_methods_supported:['S256']});
      if(url.pathname==='/jwks') return json(res,200,{keys:[jwk]});
      if(url.pathname==='/authorize') {
        if(url.searchParams.get('client_id')!==clientId || url.searchParams.get('code_challenge_method')!=='S256') return json(res,400,{error:'invalid_request'});
        const redirect=new URL(url.searchParams.get('redirect_uri'));
        if(redirect.protocol!=='https:' || !['localhost','127.0.0.1'].includes(redirect.hostname) || redirect.pathname!=='/auth/callback') return json(res,400,{error:'invalid_redirect_uri'});
        const code=randomBytes(24).toString('base64url');
        codes.set(code,{challenge:url.searchParams.get('code_challenge'),nonce:url.searchParams.get('nonce'),redirect:redirect.href,...structuredClone(settings)});
        redirect.searchParams.set('code',code);redirect.searchParams.set('state',url.searchParams.get('state'));redirect.searchParams.set('iss',issuer);
        res.writeHead(302,{Location:redirect.href});return res.end();
      }
      if(url.pathname==='/token' && req.method==='POST') {
        const credentials=/^basic /i.test(req.headers.authorization || '')?Buffer.from(req.headers.authorization.slice(6),'base64').toString().split(':').map(v=>decodeURIComponent(v.replaceAll('+',' '))):[];
        if(credentials[0]!==clientId || credentials[1]!==secret) return json(res,401,{error:'invalid_client'});
        let body='';for await(const chunk of req) {body+=chunk;if(body.length>10000) throw new Error('Request too large');}
        const p=new URLSearchParams(body),code=p.get('code'),flow=codes.get(code);codes.delete(code);
        if(!flow || flow.redirect!==p.get('redirect_uri') || flow.challenge!==createHash('sha256').update(p.get('code_verifier') || '').digest('base64url')) return json(res,400,{error:'invalid_grant'});
        const now=Math.floor(Date.now()/1000),fault=flow.fault;
        const claims={iss:fault==='issuer'?'https://wrong.example.test':issuer,sub:flow.subject,aud:fault==='audience'?'another-client':clientId,iat:now,exp:fault==='expired'?now-3600:now+3600,nonce:fault==='nonce'?'wrong-nonce':flow.nonce,auth_time:fault==='auth_time'?now-3600:now,amr:flow.amr,...(flow.acr?{acr:flow.acr}:{})};
        const idToken=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test-key'}).sign(fault==='signature'?otherKeys.privateKey:keys.privateKey);
        return json(res,200,{access_token:'synthetic-access-token',token_type:'Bearer',expires_in:3600,id_token:idToken});
      }
      json(res,404,{error:'not_found'});
    } catch {json(res,500,{error:'test_provider_error'});}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  issuer=`https://127.0.0.1:${server.address().port}`;
  const agent=new Agent({connect:{ca:tls.cert}});
  const transport=(url,options)=>fetch(url,{...options,dispatcher:agent});
  return {issuer,tls,transport,clientId,secret,settings,dir,close:async()=>{await agent.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}};
}
