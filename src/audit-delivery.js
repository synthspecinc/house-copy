import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fingerprint,Problem } from './editor.js';

function flag(value,fallback) {if(value===undefined) return fallback;if(!['true','false'].includes(value)) throw new Error('Audit delivery flags must be true or false.');return value==='true';}
function positive(value,fallback) {const n=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(n) || n<1 || n>1000000) throw new Error('Audit limits must be positive integers below 1000001.');return n;}
function collectorUrl(url) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.username || parsed.password || url.includes('?') || url.includes('#') || url.trim()!==url) throw new Error('Use an HTTPS audit collector without URL credentials or query parameters.');
  return parsed.href;
}
export function auditConfiguration(env,mode) {
  const required=flag(env.HOUSE_COPY_AUDIT_REQUIRED,mode==='aws'),url=env.HOUSE_COPY_AUDIT_URL;
  if(required && !url) throw new Error('Required audit delivery needs an HTTPS collector.');
  let normalized,token;
  if(url) {
    normalized=collectorUrl(url);
    if(!env.HOUSE_COPY_AUDIT_TOKEN_FILE) throw new Error('Mount an audit collector credential file.');
    token=readFileSync(env.HOUSE_COPY_AUDIT_TOKEN_FILE,'utf8').trim();
    if(!/^[\x21-\x7E]{1,4096}$/.test(token)) throw new Error('Invalid audit collector credential.');
  }
  return {required,url:normalized,token,maxPending:positive(env.HOUSE_COPY_AUDIT_MAX_PENDING,1000),maxAgeMs:positive(env.HOUSE_COPY_AUDIT_MAX_AGE_SECONDS,300)*1000};
}
async function acknowledgement(response,eventId) {
  if(!response.ok) {await response.body?.cancel();throw new Error('http_error');}
  const reader=response.body?.getReader();
  if(!reader) throw new Error('ack_error');
  let size=0;const chunks=[];
  try {
    while(true) {const {done,value}=await reader.read();if(done) break;size+=value.byteLength;if(size>16384) {await reader.cancel();throw new Error('ack_error');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(body.eventId!==eventId || body.accepted!==true) throw new Error('ack_error');
  } catch(error) {if(error.message==='ack_error') throw error;throw new Error('ack_error');}
}
export class AuditDelivery {
  constructor(store,{required=false,url,token,maxPending=1000,maxAgeMs=300000,transport=fetch,now=()=>Date.now(),timeoutMs=5000}={}) {
    if(required && !url) throw new Error('Required audit delivery needs a collector.');
    if(url) {url=collectorUrl(url);if(!/^[\x21-\x7E]{1,4096}$/.test(token || '')) throw new Error('Audit delivery requires a credential.');}
    this.store=store;this.required=required;this.url=url;this.token=token;this.maxPending=maxPending;this.maxAgeMs=maxAgeMs;this.transport=transport;this.now=now;this.timeoutMs=timeoutMs;this.running=false;
    if(url) store.transaction(()=>{
      const hash=fingerprint(new URL(url).href),old=store.db.prepare("SELECT value FROM settings WHERE key='audit_destination'").get();
      if(old && old.value!==hash) throw new Error('The audit collector destination changed. Review migration before reusing this database.');
      store.db.prepare("INSERT OR IGNORE INTO settings VALUES ('audit_destination',?)").run(hash);
    });
  }
  health() {
    const db=this.store.db,row=db.prepare('SELECT COUNT(*) AS count,MIN(created) AS oldest FROM audit_outbox WHERE delivered_at IS NULL').get();
    const head=db.prepare('SELECT attempts,next_attempt,last_error FROM audit_outbox WHERE delivered_at IS NULL ORDER BY seq LIMIT 1').get();
    const last=db.prepare('SELECT MAX(acknowledged) AS last FROM audit_receipts').get().last;
    const oldestPendingSeconds=row.oldest?Math.max(0,(this.now()-Date.parse(row.oldest))/1000):0;
    return {configured:!!this.url,required:this.required,pendingCount:row.count,oldestPendingSeconds,lastDeliveryAt:last || null,attempts:head?.attempts || 0,nextAttemptAt:head?.next_attempt?new Date(head.next_attempt).toISOString():null,lastError:head?.last_error || null,
      publishingPaused:this.required && (!this.url || row.count>=this.maxPending || oldestPendingSeconds*1000>this.maxAgeMs)};
  }
  assertCanPublish() {if(this.health().publishingPaused) throw new Problem(503,'Audit delivery needs operator attention. Publishing and restoration are paused.');}
  takeLease(owner) {
    return this.store.transaction(()=>{
      this.store.db.prepare('DELETE FROM audit_delivery_lock WHERE expires<=?').run(this.now());
      return this.store.db.prepare('INSERT OR IGNORE INTO audit_delivery_lock VALUES (1,?,?)').run(owner,this.now()+30000).changes===1;
    });
  }
  owns(owner) {return !!this.store.db.prepare('SELECT 1 FROM audit_delivery_lock WHERE id=1 AND owner=? AND expires>?').get(owner,this.now());}
  async runOnce(maxEvents=50) {
    if(!this.url || this.running) return {delivered:0,...this.health()};
    const owner=randomUUID();if(!this.takeLease(owner)) return {delivered:0,busy:true,...this.health()};
    this.running=true;let delivered=0;
    try {
      for(let i=0;i<maxEvents;i++) {
        if(!this.owns(owner)) break;
        this.store.db.prepare('UPDATE audit_delivery_lock SET expires=? WHERE owner=?').run(this.now()+30000,owner);
        const row=this.store.db.prepare('SELECT * FROM audit_outbox WHERE delivered_at IS NULL ORDER BY seq LIMIT 1').get();
        if(!row || row.next_attempt>this.now()) break;
        try {
          const response=await this.transport(this.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json','Idempotency-Key':row.event_id},body:row.payload});
          await acknowledgement(response,row.event_id);
          if(!this.owns(owner)) break;
          const recorded=this.store.transaction(()=>{
            if(!this.owns(owner)) return false;
            const acknowledged=new Date(this.now()).toISOString();
            this.store.db.prepare('INSERT INTO audit_receipts VALUES (?,?)').run(row.event_id,acknowledged);
            this.store.db.prepare('UPDATE audit_outbox SET delivered_at=?,last_error=NULL WHERE event_id=?').run(acknowledged,row.event_id);
            return true;
          });
          if(!recorded) break;
          delivered++;
        } catch(error) {
          if(!this.owns(owner)) break;
          const category=['http_error','ack_error'].includes(error.message)?error.message:['TimeoutError','AbortError'].includes(error.name)?'timeout':'transport_error';
          const attempts=row.attempts+1,next=this.now()+Math.min(60000,1000*2**Math.min(attempts-1,6));
          this.store.db.prepare('UPDATE audit_outbox SET attempts=?,next_attempt=?,last_error=? WHERE event_id=?').run(attempts,next,category,row.event_id);
          break;
        }
      }
      return {delivered,...this.health()};
    } finally {this.running=false;this.store.db.prepare('DELETE FROM audit_delivery_lock WHERE owner=?').run(owner);}
  }
  start() {
    const tick=()=>this.runOnce().catch(()=>{ /* Database failures leave evidence queued. Readiness reports the backlog. */ });
    void tick();this.timer=setInterval(tick,1000);this.timer.unref();
  }
  async stop() {clearInterval(this.timer);while(this.running) await new Promise(resolve=>setTimeout(resolve,10));}
}
