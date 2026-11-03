import { Store } from '../src/store.js';
const store=new Store(process.env.HOUSE_COPY_DB || './data/house-copy.sqlite');
try {for(const row of store.db.prepare('SELECT a.id,a.document,o.event_id FROM audit_events a JOIN audit_outbox o ON o.seq=a.id ORDER BY a.id').iterate()) process.stdout.write(JSON.stringify({id:row.id,...JSON.parse(row.document),eventId:row.event_id})+'\n');}
finally {store.close();}
