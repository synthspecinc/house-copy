import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rateLimit } from 'express-rate-limit';
import { Problem, previewDocument } from './editor.js';
import { fingerprint } from './editor.js';
import { demoActor } from './auth.js';

export function createApp(service,{origin='http://localhost:3210',auth,mode='fake',limits={}}={}) {
  if(!auth && mode!=='fake') throw new Error('Real SES requires individual OIDC authentication.');
  const app=express(),store=service.store;
  if(auth) service.authority={version:()=>fingerprint(auth.policy()),isPublisher:actor=>auth.publisherEnabled(actor)};
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    req.requestId=randomUUID();
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','X-Request-ID':req.requestId,
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    if(origin.startsWith('https:')) res.set('Strict-Transport-Security','max-age=31536000');
    if(req.path==='/health') return res.json({status:'ok'});
    next();
  });
  const throttle=(limit,windowMs)=>rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,validate:{xForwardedForHeader:false},handler:(req,res)=>{
    store.audit('request.throttled',{requestId:req.requestId,outcome:'denied'});
    res.status(429).json({error:'Too many requests. Wait before trying again.'});
  }});
  app.use(['/auth/login','/auth/callback'],throttle(limits.auth || 60,10*60*1000));
  app.get('/auth/login',async(req,res)=>{
    if(!auth) return res.redirect('/');
    if(req.get('sec-fetch-site')==='cross-site') throw new Problem(403,'Start sign-in from House Copy.');
    await auth.login(req,res);
  });
  app.get('/auth/callback',async(req,res)=>{
    if(!auth) throw new Problem(404,'Not found.');
    await auth.callback(req,res);
  });
  app.use(['/api','/auth/session','/auth/logout'],throttle(limits.api || 600,60*1000),(req,res,next)=>{
    req.actor=auth?auth.authenticate(req,res):demoActor;
    if(!req.actor) {
      store.audit('access.denied',{requestId:req.requestId,outcome:'unauthenticated'});
      return res.status(401).json({error:'Sign in to continue. Your unsaved content stays in this window.',loginUrl:'/auth/login'});
    }
    next();
  });
  app.use((req,res,next)=>{
    if(!['GET','HEAD'].includes(req.method)) {
      if(req.get('origin')!==origin || req.get('x-house-copy')!=='1' || !req.is('application/json') || auth && !auth.csrfValid(req)) {
        store.audit('access.denied',{actor:req.actor,requestId:req.requestId,outcome:'request_boundary'});
        throw new Problem(403,'This request must come from your signed-in House Copy editor.');
      }
    }
    next();
  });
  app.use(express.json({limit:'200kb',strict:true}));
  app.get('/auth/session',(req,res)=>res.json({mode:auth?'oidc':'demo',user:req.actor,csrfToken:req.csrf || null}));
  app.post('/auth/logout',(req,res)=>auth?auth.logout(req,res):res.json({loggedOut:false}));
  const permit=role=>(req,res,next)=>{
    if(role==='publisher' && req.actor.role!=='publisher') {
      store.audit('access.denied',{actor:req.actor,requestId:req.requestId,outcome:'insufficient_role'});
      throw new Problem(403,'Only a publisher can publish or restore a template. Your draft is safe.');
    }
    next();
  };
  const change=(action,handler)=>async(req,res)=>{
    const context={actor:req.actor,requestId:req.requestId};
    try {
      const data=await handler(req,context);
      if(!['template.publish','template.restore','review.request','review.decision'].includes(action)) store.audit(action,{...context,template:req.params.name,outcome:'success'});
      res.json(data);
    } catch(error) {
      store.audit(action,{...context,template:service.config.templates.some(t=>t.name===req.params.name)?req.params.name:undefined,outcome:error.status===502?'unconfirmed':'rejected'});
      throw error;
    }
  };
  app.get('/api/templates',(req,res)=>res.json({mode,templates:service.list()}));
  app.get('/api/templates/:name',async(req,res)=>{
    const result=await service.open(req.params.name);
    res.json({...result,editorHtml:previewDocument(result.template.html)});
  });
  app.post('/api/templates/:name/reviews',change('review.request',(req,context)=>service.reviews.request(req.params.name,req.body,context)));
  app.post('/api/templates/:name/revisions/:id/reviews',permit('publisher'),change('review.request',(req,context)=>service.reviews.request(req.params.name,req.body,context,req.params.id)));
  app.get('/api/templates/:name/reviews/:id',(req,res)=>res.json(service.reviews.detail(req.params.name,req.params.id)));
  app.post('/api/templates/:name/reviews/:id/decision',permit('publisher'),change('review.decision',(req,context)=>service.reviews.decide(req.params.name,req.params.id,req.body,context)));
  app.post('/api/templates/:name/reviews/:id/execute',permit('publisher'),change('review.execute',(req,context)=>service.reviews.execute(req.params.name,req.params.id,req.body,context)));
  app.get('/api/templates/:name/review',async(req,res)=>res.json(await service.reviewDraft(req.params.name)));
  app.get('/api/templates/:name/publications/:id',(req,res)=>res.json(service.publication(req.params.name,req.params.id)));
  app.put('/api/templates/:name/draft',permit('editor'),change('draft.save',(req,context)=>service.save(req.params.name,req.body,context)));
  app.post('/api/templates/:name/discard',permit('editor'),change('draft.discard',(req)=>service.discard(req.params.name,req.body.version)));
  app.post('/api/templates/:name/preview',permit('editor'),async(req,res)=>res.json(await service.preview(req.params.name,req.body)));
  app.post('/api/templates/:name/publish',permit('publisher'),change('template.publish',(req,context)=>service.publish(req.params.name,req.body,context)));
  app.post('/api/templates/:name/revisions/:id/restore',permit('publisher'),change('template.restore',(req,context)=>service.restore(req.params.name,req.params.id,req.body,context)));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)),{etag:false}));
  app.use((req,res)=>res.status(404).json({error:'Not found.'}));
  app.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    // Provider errors can contain real template content. Never log or return them.
    const status=error instanceof Problem?error.status:error.type==='entity.too.large'?413:error instanceof SyntaxError?400:502;
    res.status(status).json({error:error instanceof Problem?error.message:status===413?'The request is too large.':status===400?'The request contains invalid JSON.':'The service is unavailable. Reopen the template or contact an operator.'});
  });
  return app;
}
