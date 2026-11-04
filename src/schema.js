export const SCHEMA_VERSION=2;
export function migrate(db) {
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>SCHEMA_VERSION) throw new Error('The database is newer than this application.');
  db.exec(`BEGIN IMMEDIATE;
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
    PRAGMA user_version=2;
    COMMIT;`);
}
