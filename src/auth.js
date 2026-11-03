import { readFileSync } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { Problem } from './editor.js';

const token=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && timingSafeEqual(Buffer.from(hash(a),'hex'),Buffer.from(hash(b),'hex'));
export const SESSION_COOKIE='__Host-house-copy';
const LOGIN_COOKIE='__Host-house-copy-login';
const IDLE=15*60*1000, ABSOLUTE=60*60*1000, LOGIN=5*60*1000;
export const demoActor=Object.freeze({issuer:'house-copy:demo',subject:'synthetic-editor',role:'publisher',label:'Demo editor'});
function cookie(req,name) {
  const values=(req.headers.cookie || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(`${name}=`));
  if(values.length!==1) return undefined;
  const value=values[0].slice(name.length+1);
  return /^[\w-]{43}$/.test(value)?value:undefined;
}
function setCookie(res,name,value,maxAge) { res.cookie(name,value,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge}); }
function clearCookie(res,name) { res.clearCookie(name,{httpOnly:true,secure:true,sameSite:'lax',path:'/'}); }
export function validateAuthPolicy(policy) {
  const validUrl=value=>{try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }};
  if(!policy || !validUrl(policy.issuer) || typeof policy.clientId!=='string' || !policy.clientId || !Array.isArray(policy.users) || !policy.users.length) throw new Error('Configure an HTTPS OIDC issuer, client ID and explicit user allowlist.');
  const subjects=new Set();
  for(const user of policy.users) {
    if(typeof user.subject!=='string' || !user.subject || user.subject.length>255 || subjects.has(user.subject) || !['editor','publisher'].includes(user.role) || user.disabled!==undefined && typeof user.disabled!=='boolean') throw new Error('OIDC subjects must be unique and have an editor or publisher role.');
    subjects.add(user.subject);
  }
  if(policy.mfaAcrValues!==undefined && (!Array.isArray(policy.mfaAcrValues) || policy.mfaAcrValues.some(v=>typeof v!=='string' || !v || v.length>255))) throw new Error('MFA acr values must be an array of nonempty strings.');
  return policy;
}
export function readAuthPolicy(path) { return validateAuthPolicy(JSON.parse(readFileSync(path,'utf8'))); }
export function validateRuntimeSecurity({mode,authMode,origin,policyFile,secretFile}) {
  const u=new URL(origin);
  if(u.origin!==origin || u.username || u.password) throw new Error('HOUSE_COPY_ORIGIN must be an exact origin without a path.');
  if(authMode==='demo') {
    if(mode!=='fake' || !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('Demo authentication requires the fake adapter and a loopback public origin.');
  } else if(authMode==='oidc') {
    if(u.protocol!=='https:' || !policyFile || !secretFile) throw new Error('OIDC requires HTTPS, HOUSE_COPY_AUTH_CONFIG and HOUSE_COPY_OIDC_SECRET_FILE.');
  } else throw new Error('Set HOUSE_COPY_AUTH to oidc or explicitly to demo for synthetic local use.');
}
export class OidcAuth {
  constructor(store,{origin,loadPolicy,clientSecret,now=()=>Date.now(),transport}) {
    this.store=store;this.origin=origin;this.loadPolicy=loadPolicy;this.clientSecret=clientSecret;this.now=now;this.transport=transport;
    this.initial=validateAuthPolicy(loadPolicy());
    if(new URL(origin).protocol!=='https:' || !clientSecret?.trim()) throw new Error('OIDC requires an HTTPS origin and a nonempty client secret file.');
    store.db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (hash TEXT PRIMARY KEY, document TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_logins (hash TEXT PRIMARY KEY, document TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_blocked (issuer TEXT NOT NULL, subject TEXT NOT NULL, PRIMARY KEY(issuer,subject));`);
  }
  policy() {
    const policy=validateAuthPolicy(this.loadPolicy());
    if(policy.issuer!==this.initial.issuer || policy.clientId!==this.initial.clientId) throw new Error('Restart House Copy after changing the issuer or client ID.');
    return policy;
  }
  async initialize() {
    this.config=await oidc.discovery(new URL(this.initial.issuer),this.initial.clientId,{},oidc.ClientSecretBasic(this.clientSecret),{timeout:5,execute:[oidc.enableNonRepudiationChecks],...(this.transport?{[oidc.customFetch]:this.transport}:{})});
    const metadata=this.config.serverMetadata();
    for(const key of ['authorization_endpoint','token_endpoint','jwks_uri']) if(!metadata[key] || new URL(metadata[key]).protocol!=='https:') throw new Error('All OIDC endpoints must use HTTPS.');
    return this;
  }
  audit(action,context={}) { this.store.audit(action,context); }
  prune() {
    const time=this.now();
    this.store.db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(time);
    this.store.db.prepare('DELETE FROM auth_logins WHERE expires<=?').run(time);
  }
  publisherEnabled(actor) {
    const policy=this.policy();
    return actor.issuer===policy.issuer && policy.users.some(u=>u.subject===actor.subject && u.role==='publisher' && !u.disabled) && !this.store.db.prepare('SELECT 1 FROM auth_blocked WHERE issuer=? AND subject=?').get(actor.issuer,actor.subject);
  }
  allowed(subject,evidence={}) {
    const p=this.policy(),user=p.users.find(u=>u.subject===subject);
    const blocked=this.store.db.prepare('SELECT 1 FROM auth_blocked WHERE issuer=? AND subject=?').get(p.issuer,subject);
    if(!user || user.disabled || blocked) throw new Problem(403,'Your account does not have access to House Copy. Contact an operator.');
    const mfa=evidence.amr?.includes('mfa') || (p.mfaAcrValues || []).includes(evidence.acr);
    if(user.role==='publisher' && !mfa) throw new Problem(403,'Publishing access requires a verified MFA sign-in. Contact your identity provider administrator.');
    return {issuer:p.issuer,subject,role:user.role,label:user.label || subject};
  }
  async login(req,res) {
    this.prune(); this.policy();
    const handle=token(),state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier();
    const challenge=await oidc.calculatePKCECodeChallenge(verifier);
    this.store.db.prepare('INSERT INTO auth_logins VALUES (?,?,?)').run(hash(handle),JSON.stringify({state,nonce,verifier,issuer:this.initial.issuer,clientId:this.initial.clientId}),this.now()+LOGIN);
    setCookie(res,LOGIN_COOKIE,handle,LOGIN);
    const url=oidc.buildAuthorizationUrl(this.config,{redirect_uri:`${this.origin}/auth/callback`,scope:'openid profile',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state,nonce,max_age:'0',prompt:'login',...((this.initial.mfaAcrValues || []).length?{acr_values:this.initial.mfaAcrValues.join(' ')}:{})});
    this.audit('auth.login.started',{requestId:req.requestId,outcome:'started'});
    res.redirect(url.href);
  }
  createSession(claims) {
    const evidence={amr:Array.isArray(claims.amr)?claims.amr.filter(v=>typeof v==='string'):[],acr:typeof claims.acr==='string'?claims.acr:undefined};
    const actor=this.allowed(claims.sub,evidence),time=this.now(),expires=Math.min(time+ABSOLUTE,claims.exp*1000);
    if(!Number.isFinite(expires) || expires<=time || claims.iss!==this.initial.issuer || typeof claims.sub!=='string') throw new Problem(401,'The sign-in is not valid. Try signing in again.');
    const sessionToken=token(),session={actor,evidence,clientId:this.initial.clientId,csrf:token(),created:time,lastUsed:time,expires};
    this.store.db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(hash(sessionToken),JSON.stringify(session),expires);
    return {sessionToken,session};
  }
  async callback(req,res) {
    const handle=cookie(req,LOGIN_COOKIE);
    clearCookie(res,LOGIN_COOKIE);
    const row=handle && this.store.db.prepare('DELETE FROM auth_logins WHERE hash=? RETURNING document,expires').get(hash(handle));
    let verifiedActor;
    try {
      if(!row || row.expires<=this.now()) throw new Error('Expired login');
      const flow=JSON.parse(row.document);
      if(flow.issuer!==this.initial.issuer || flow.clientId!==this.initial.clientId) throw new Error('Login configuration changed');
      const responseUrl=new URL(req.originalUrl,this.origin);
      const tokens=await oidc.authorizationCodeGrant(this.config,responseUrl,{pkceCodeVerifier:flow.verifier,expectedState:flow.state,expectedNonce:flow.nonce,maxAge:0,idTokenExpected:true});
      const claims=tokens.claims();
      verifiedActor={issuer:claims.iss,subject:claims.sub,role:'unassigned'};
      const {sessionToken,session}=this.createSession(claims);
      const old=cookie(req,SESSION_COOKIE);
      if(old) this.store.db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(hash(old));
      setCookie(res,SESSION_COOKIE,sessionToken,session.expires-this.now());
      this.audit('auth.login',{actor:session.actor,requestId:req.requestId,outcome:'success'});
      res.redirect('/');
    } catch(error) {
      this.audit('auth.login',{actor:verifiedActor,requestId:req.requestId,outcome:'denied'});
      res.status(error instanceof Problem?error.status:401).type('html').send('<!doctype html><title>Sign-in failed</title><h1>Sign-in could not be completed</h1><p>Contact an operator if your account or MFA is not configured.</p><a href="/auth/login">Try signing in again</a>');
    }
  }
  authenticate(req,res) {
    const value=cookie(req,SESSION_COOKIE);
    if(!value) return undefined;
    const row=this.store.db.prepare('SELECT document FROM auth_sessions WHERE hash=?').get(hash(value));
    if(!row) {clearCookie(res,SESSION_COOKIE);return undefined;}
    const session=JSON.parse(row.document),time=this.now();
    try {
      if(session.actor.issuer!==this.initial.issuer || session.clientId!==this.initial.clientId || time>=session.expires || time-session.lastUsed>=IDLE) throw new Problem(401,'Your session expired. Sign in again to continue.');
      session.actor=this.allowed(session.actor.subject,session.evidence);
      session.lastUsed=time;
      this.store.db.prepare('UPDATE auth_sessions SET document=? WHERE hash=?').run(JSON.stringify(session),hash(value));
      req.sessionHash=hash(value);req.csrf=session.csrf;
      return session.actor;
    } catch(error) {
      this.store.db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(hash(value));
      clearCookie(res,SESSION_COOKIE);
      this.audit('auth.session.ended',{actor:session.actor,requestId:req.requestId,outcome:'revoked_or_expired'});
      if(error instanceof Problem && error.status===401) return undefined;
      throw error instanceof Problem?error:new Problem(503,'Access policy is unavailable. Contact an operator.');
    }
  }
  csrfValid(req) { return equal(req.csrf,req.get('x-csrf-token')); }
  logout(req,res) {
    this.store.db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(req.sessionHash);
    clearCookie(res,SESSION_COOKIE);
    this.audit('auth.logout',{actor:req.actor,requestId:req.requestId,outcome:'success'});
    res.json({loggedOut:true});
  }
}
