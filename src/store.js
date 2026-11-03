import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Problem } from './editor.js';

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true, mode:0o700});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS drafts (name TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fake_templates (name TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, document TEXT NOT NULL);`);
  }
  bindScope(mode,region,account) {
    const scope=JSON.stringify({mode,region:mode==='aws'?region:null,account:mode==='aws'?account:null});
    const old=this.db.prepare("SELECT value FROM settings WHERE key='scope'").get();
    if(old && old.value!==scope) throw new Error('This database belongs to a different adapter, region or account. Use a separate volume.');
    this.db.prepare("INSERT OR IGNORE INTO settings VALUES ('scope',?)").run(scope);
  }
  draft(name) { const row = this.db.prepare('SELECT document FROM drafts WHERE name=?').get(name); return row && JSON.parse(row.document); }
  saveDraft(name, document) { this.db.prepare('INSERT INTO drafts VALUES (?,?) ON CONFLICT(name) DO UPDATE SET document=excluded.document').run(name,JSON.stringify(document)); }
  deleteDraft(name) { this.db.prepare('DELETE FROM drafts WHERE name=?').run(name); }
  revisions(name) { return this.db.prepare('SELECT document FROM revisions WHERE name=? ORDER BY created DESC, rowid DESC').all(name).map(r => JSON.parse(r.document)); }
  revision(name,id) { return this.revisions(name).find(r => r.id === id); }
  audit(action,{actor,requestId,template,revision,outcome,target}={}) {
    const event={created:new Date().toISOString(),action,outcome,requestId,template,revision,target,
      ...(actor?{actor:{issuer:actor.issuer,subject:actor.subject,role:actor.role}}:{})};
    this.db.prepare('INSERT INTO audit_events (created,document) VALUES (?,?)').run(event.created,JSON.stringify(event));
  }
  snapshot(name, template, reason,context={}) {
    const revision = {id:randomUUID(),created:new Date().toISOString(),template,reason,actor:context.actor,requestId:context.requestId};
    this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?)').run(revision.id,name,revision.created,JSON.stringify(revision));
    return revision;
  }
  operation(name, doc) { const id = randomUUID(); this.db.prepare('INSERT INTO operations VALUES (?,?,?)').run(id,name,JSON.stringify(doc)); return id; }
  finish(id) { this.db.prepare('DELETE FROM operations WHERE id=?').run(id); }
  pending(name) { return this.db.prepare('SELECT id, document FROM operations WHERE name=?').all(name).map(r=>({id:r.id,...JSON.parse(r.document)})); }
  async lock(name, action) {
    const owner = randomUUID();
    try { this.db.prepare('INSERT INTO locks VALUES (?,?)').run(name,owner); }
    catch { throw new Problem(409,'Another change is running for this template. Try again. If the service restarted during a write, ask an operator to recover it.'); }
    try { return await action(); }
    finally { this.db.prepare('DELETE FROM locks WHERE name=? AND owner=?').run(name,owner); }
  }
  close() { this.db.close(); }
}
