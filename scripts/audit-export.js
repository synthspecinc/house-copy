import { Store } from '../src/store.js';
const store=new Store(process.env.HOUSE_COPY_DB || './data/house-copy.sqlite');
try {for(const row of store.db.prepare('SELECT id,document FROM audit_events ORDER BY id').iterate()) process.stdout.write(JSON.stringify({id:row.id,...JSON.parse(row.document)})+'\n');}
finally {store.close();}
