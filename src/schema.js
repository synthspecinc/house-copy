import { createHash } from 'node:crypto';
import { auditEvent } from './audit-events.js';
export const SCHEMA_VERSION=3;
export function migrate(db) {
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>SCHEMA_VERSION) throw new Error('The database is newer than this application.');
  try {db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY,name TEXT NOT NULL,created TEXT NOT NULL,document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS publications_name ON publications(name,created);
    CREATE TABLE IF NOT EXISTS publication_results (id TEXT PRIMARY KEY,publication_id TEXT NOT NULL,created TEXT NOT NULL,document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS publication_results_parent ON publication_results(publication_id,created);
    CREATE TRIGGER IF NOT EXISTS publications_no_update BEFORE UPDATE ON publications BEGIN SELECT RAISE(ABORT,'Publication history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS publications_no_delete BEFORE DELETE ON publications BEGIN SELECT RAISE(ABORT,'Publication history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS publication_results_no_update BEFORE UPDATE ON publication_results BEGIN SELECT RAISE(ABORT,'Publication results are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS publication_results_no_delete BEFORE DELETE ON publication_results BEGIN SELECT RAISE(ABORT,'Publication results are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS revisions_no_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'Revision history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS revisions_no_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'Revision history is append-only'); END;
    CREATE TABLE IF NOT EXISTS review_requests (id TEXT PRIMARY KEY,name TEXT NOT NULL,created TEXT NOT NULL,document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review_decisions (review_id TEXT PRIMARY KEY,document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review_executions (review_id TEXT PRIMARY KEY,publication_id TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS review_requests_no_update BEFORE UPDATE ON review_requests BEGIN SELECT RAISE(ABORT,'Review requests are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS review_requests_no_delete BEFORE DELETE ON review_requests BEGIN SELECT RAISE(ABORT,'Review requests are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS review_decisions_no_update BEFORE UPDATE ON review_decisions BEGIN SELECT RAISE(ABORT,'Review decisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS review_decisions_no_delete BEFORE DELETE ON review_decisions BEGIN SELECT RAISE(ABORT,'Review decisions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS review_executions_no_update BEFORE UPDATE ON review_executions BEGIN SELECT RAISE(ABORT,'Review executions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS review_executions_no_delete BEFORE DELETE ON review_executions BEGIN SELECT RAISE(ABORT,'Review executions are append-only'); END;
    CREATE TABLE IF NOT EXISTS audit_outbox (event_id TEXT PRIMARY KEY,seq INTEGER NOT NULL UNIQUE,created TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,delivered_at TEXT,last_error TEXT);
    CREATE TABLE IF NOT EXISTS audit_receipts (event_id TEXT PRIMARY KEY,acknowledged TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_delivery_lock (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_outbox_payload_no_update BEFORE UPDATE OF event_id,seq,created,payload ON audit_outbox BEGIN SELECT RAISE(ABORT,'Audit envelopes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_outbox_no_delete BEFORE DELETE ON audit_outbox BEGIN SELECT RAISE(ABORT,'Audit envelopes are retained'); END;
    CREATE TRIGGER IF NOT EXISTS audit_receipts_no_update BEFORE UPDATE ON audit_receipts BEGIN SELECT RAISE(ABORT,'Audit receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_receipts_no_delete BEFORE DELETE ON audit_receipts BEGIN SELECT RAISE(ABORT,'Audit receipts are append-only'); END;
    PRAGMA user_version=3;`);
    const scope=db.prepare("SELECT value FROM settings WHERE key='scope'").get()?.value || 'unbound';
    for(const row of db.prepare('SELECT a.* FROM audit_events a LEFT JOIN audit_outbox o ON o.seq=a.id WHERE o.seq IS NULL ORDER BY a.id').all()) {
      const eventId=`legacy-${createHash('sha256').update(JSON.stringify([scope,row.id,row.document])).digest('hex')}`;
      const event=auditEvent(JSON.parse(row.document));event.eventId=eventId;
      db.prepare('INSERT INTO audit_outbox (event_id,seq,created,payload) VALUES (?,?,?,?)').run(eventId,row.id,row.created,JSON.stringify({schemaVersion:1,eventId,event}));
    }
    db.exec('COMMIT');
  } catch(error) {if(db.isTransaction) db.exec('ROLLBACK');throw error;}
}
