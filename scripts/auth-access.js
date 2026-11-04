import { readAuthPolicy } from '../src/auth.js';
import { Store } from '../src/store.js';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function changeAccess(store,issuer,subject,action) {
  if(!['revoke','block','unblock'].includes(action) || !subject || subject.length>255) throw new Error('Use revoke, block or unblock with one exact subject.');
  store.db.exec(`CREATE TABLE IF NOT EXISTS auth_blocked (issuer TEXT NOT NULL,subject TEXT NOT NULL,PRIMARY KEY(issuer,subject));`);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    if(action==='block') store.db.prepare('INSERT OR IGNORE INTO auth_blocked VALUES (?,?)').run(issuer,subject);
    if(action==='unblock') store.db.prepare('DELETE FROM auth_blocked WHERE issuer=? AND subject=?').run(issuer,subject);
    if(action!=='unblock' && store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get()) {
      store.db.prepare("DELETE FROM auth_sessions WHERE json_extract(document,'$.actor.issuer')=? AND json_extract(document,'$.actor.subject')=?").run(issuer,subject);
    }
    store.audit(`operator.${action}`,{actor:{issuer:'house-copy:operator',subject:`uid:${process.getuid?.() ?? 'unknown'}`,role:'operator'},target:{issuer,subject},requestId:randomUUID(),outcome:'success'});
    store.db.exec('COMMIT');
  } catch(error) {store.db.exec('ROLLBACK');throw error;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [action,subject]=process.argv.slice(2);
  const policy=readAuthPolicy(process.env.HOUSE_COPY_AUTH_CONFIG);
  const store=new Store(process.env.HOUSE_COPY_DB || './data/house-copy.sqlite');
  try {changeAccess(store,policy.issuer,subject,action);console.log('Access change recorded. Revoked sessions cannot be reused.');}
  finally {store.close();}
}
