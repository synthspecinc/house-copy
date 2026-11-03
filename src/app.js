import express from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Problem, previewDocument } from './editor.js';

const digest = value => createHash('sha256').update(value).digest();
export function createApp(service,{origin='http://localhost:3210',password,mode='fake'}={}) {
  const app=express();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    if(req.path==='/health') return res.json({status:'ok'});
    if (password) {
      const header=req.get('authorization') || '';
      const credentials=header.startsWith('Basic ') ? Buffer.from(header.slice(6),'base64').toString() : '';
      if (!timingSafeEqual(digest(credentials),digest(`editor:${password}`))) return res.set('WWW-Authenticate','Basic realm="House Copy", charset="UTF-8"').status(401).send('Sign in with your operator-provided editor password.');
    }
    if (!['GET','HEAD'].includes(req.method)) {
      if(req.get('origin')!==origin || req.get('x-house-copy')!=='1' || !req.is('application/json')) return res.status(403).json({error:'This request must come from the House Copy editor.'});
    }
    next();
  });
  app.use(express.json({limit:'200kb',strict:true}));
  app.get('/api/templates',(req,res)=>res.json({mode,templates:service.list()}));
  app.get('/api/templates/:name',async(req,res)=>{
    const result=await service.open(req.params.name);
    res.json({...result,editorHtml:previewDocument(result.template.html)});
  });
  app.put('/api/templates/:name/draft',async(req,res)=>res.json(await service.save(req.params.name,req.body)));
  app.post('/api/templates/:name/discard',async(req,res)=>res.json(await service.discard(req.params.name,req.body.version)));
  app.post('/api/templates/:name/preview',async(req,res)=>res.json(await service.preview(req.params.name,req.body)));
  app.post('/api/templates/:name/publish',async(req,res)=>res.json(await service.publish(req.params.name,req.body)));
  app.post('/api/templates/:name/revisions/:id/restore',async(req,res)=>res.json(await service.restore(req.params.name,req.params.id,req.body)));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)),{etag:false}));
  app.use((req,res)=>res.status(404).json({error:'Not found.'}));
  app.use((error,req,res,next)=>{
    if (res.headersSent) return next(error);
    // Provider errors can contain real template content. Never log them or return them.
    const status=error instanceof Problem ? error.status : error.type==='entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 502;
    res.status(status).json({error:error instanceof Problem ? error.message : status===413 ? 'The request is too large.' : status===400 ? 'The request contains invalid JSON.' : 'The template service is unavailable. Try reopening the template or contact an operator.'});
  });
  return app;
}
