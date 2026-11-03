// Synthetic HTTPS receiver. SQLite commits before acknowledgement and deduplicates stable event IDs.
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { identityProvider } from './identity-provider.js';
export async function auditCollector(t,dir) {
  const provider=await identityProvider(),db=new DatabaseSync(join(dir,'collector.sqlite'));
  db.exec('PRAGMA synchronous=FULL; CREATE TABLE received (event_id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
  const settings={fault:undefined},requests=[];
  const server=https.createServer(provider.tls,async(req,res)=>{
    if(req.headers.authorization!=='Bearer synthetic-collector-token') {res.writeHead(401);return res.end();}
    let payload='';for await(const chunk of req) payload+=chunk;
    const envelope=JSON.parse(payload);requests.push({id:req.headers['idempotency-key'],payload});
    if(settings.fault==='redirect') {res.writeHead(307,{Location:`${provider.issuer}/must-not-follow`});return res.end();}
    if(settings.fault==='status') {res.writeHead(503);return res.end('PRIVATE_RECEIVER_ERROR_MUST_NOT_PERSIST');}
    if(settings.fault==='timeout') return;
    db.prepare('INSERT OR IGNORE INTO received VALUES (?,?)').run(envelope.eventId,payload);
    if(settings.fault==='lost_ack') return req.socket.destroy();
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({accepted:true,eventId:settings.fault==='wrong_ack'?'another-event':envelope.eventId}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();await provider.close();});
  return {url:`https://127.0.0.1:${server.address().port}/events`,token:'synthetic-collector-token',transport:provider.transport,caFile:join(provider.dir,'cert.pem'),settings,requests,db};
}
