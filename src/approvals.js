import { randomUUID } from 'node:crypto';
import { fingerprint,Problem,render,previewDocument } from './editor.js';
import { changeMetadata,comparison } from './publications.js';
export const identityKey=actor=>JSON.stringify([actor?.issuer,actor?.subject]);
export function requirePublisher(actor) {if(actor?.role!=='publisher') throw new Problem(403,'Only a publisher can approve, publish or restore a template.');}
export function effectivePolicy(config,mapping) {
  const result={requireApproval:false,requireTicket:false};
  for(const source of [config.publicationPolicy,mapping.publicationPolicy]) {
    if(source===undefined) continue;
    if(!source || typeof source!=='object' || Array.isArray(source) || Object.keys(source).some(k=>!Object.hasOwn(result,k) || typeof source[k]!=='boolean')) throw new Problem(422,'Publication policy must contain only boolean requireApproval and requireTicket settings.');
    Object.assign(result,source);
  }
  return result;
}
export class Reviews {
  constructor(service) {this.service=service;this.store=service.store;}
  policy(name) {return effectivePolicy(this.service.config,this.service.mapping(name));}
  binding(name,kind,beforeHash,target,{draftVersion=null,restoreRevisionId=null}={}) {
    return {name,kind,beforeHash,afterHash:fingerprint(target),draftVersion,restoreRevisionId,mappingHash:fingerprint(this.service.mapping(name)),policyHash:fingerprint(this.policy(name)),scopeHash:fingerprint(this.service.scope)};
  }
  metadata(name,body) {
    const metadata=changeMetadata(body,this.service.scope);
    if(this.policy(name).requireTicket && !metadata.reference) throw new Problem(422,'This template requires a ticket or change reference.');
    return metadata;
  }
  async request(name,body,context,restoreRevisionId=null) {
    const actor=context.actor;
    if(!actor || !['editor','publisher'].includes(actor.role)) throw new Problem(403,'Sign in to request review.');
    if(restoreRevisionId) requirePublisher(actor);
    return this.store.lock(name,async()=>{
      const mapping=this.service.mapping(name),before=await this.service.adapter.get(name),draft=this.store.draft(name);
      let after,contributors,details;
      if(restoreRevisionId) {
        if(draft) throw new Problem(409,'Discard or publish the draft before requesting a restore.');
        after=this.store.revision(name,restoreRevisionId)?.template;
        if(!after) throw new Problem(404,'Revision not found.');
        if(body.currentHash!==fingerprint(before)) throw new Problem(409,'SES changed. Reopen the template.');
        contributors=[];details={restoreRevisionId};
      } else {
        if(!draft || body.version!==draft.version) throw new Problem(409,'Save and reopen the draft before requesting review.');
        if(draft.baseHash!==fingerprint(before) || draft.mappingHash!==fingerprint(mapping)) throw new Problem(409,'The draft or mapping is stale. Reopen the template.');
        if(!draft.authorshipKnown) throw new Problem(409,'This draft has unknown authorship. Discard it and save a new draft before review.');
        after=draft.template;contributors=draft.contributors;details={draftVersion:draft.version};
      }
      render(after,mapping.sample || {});
      const request={id:randomUUID(),created:new Date().toISOString(),scope:this.service.scope,...this.binding(name,restoreRevisionId?'restore':'publish',fingerprint(before),after,details),before,after,requester:actor,contributors,...this.metadata(name,body)};
      this.store.transaction(()=>{
        this.store.db.prepare('INSERT INTO review_requests VALUES (?,?,?,?)').run(request.id,name,request.created,JSON.stringify(request));
        this.store.audit('review.request',{actor,requestId:context.requestId,template:name,reviewId:request.id,outcome:'success'});
      });
      return this.detail(name,request.id);
    });
  }
  get(name,id) {
    this.service.mapping(name);
    const row=this.store.db.prepare('SELECT document FROM review_requests WHERE name=? AND id=?').get(name,id);
    if(!row) throw new Problem(404,'Review request not found.');
    const decision=this.store.db.prepare('SELECT document FROM review_decisions WHERE review_id=?').get(id);
    const execution=this.store.db.prepare('SELECT publication_id FROM review_executions WHERE review_id=?').get(id);
    return {...JSON.parse(row.document),decision:decision?JSON.parse(decision.document):null,publicationId:execution?.publication_id || null};
  }
  list(name) {return this.store.db.prepare('SELECT id FROM review_requests WHERE name=? ORDER BY created DESC,rowid DESC LIMIT 100').all(name).map(r=>this.summary(this.get(name,r.id)));}
  summary(request) {const {before,after,contributors,...result}=request;return {...result,status:request.publicationId?'executed':request.decision?.decision || 'pending'};}
  detail(name,id) {
    const request=this.get(name,id),sample=this.service.mapping(name).sample || {};
    let previews,previewError;
    try {previews={};for(const which of ['before','after']) {const value=render(request[which],sample);previews[which]={...value,html:previewDocument(value.html)};}}
    catch {previewError='The configured synthetic sample cannot render this comparison. Ask an operator to repair the sample.';}
    return {...request,...this.summary(request),parts:comparison(request.before,request.after),previews,previewError};
  }
  currentBinding(request) {
    const draft=this.store.draft(request.name);
    if(request.kind==='publish') {
      if(!draft) throw new Problem(409,'The reviewed draft no longer exists. Request a new review.');
      return this.binding(request.name,'publish',draft.baseHash,draft.template,{draftVersion:draft.version});
    }
    if(draft) throw new Problem(409,'A draft exists. Discard or publish it before restoring.');
    const target=this.store.revision(request.name,request.restoreRevisionId)?.template;
    if(!target) throw new Problem(409,'The reviewed revision no longer exists.');
    return this.binding(request.name,'restore',request.beforeHash,target,{restoreRevisionId:request.restoreRevisionId});
  }
  assertBinding(request,binding) {
    for(const [key,value] of Object.entries(binding)) if(request[key]!==value) throw new Problem(409,'This review is stale. Request review of the current change.');
  }
  async decide(name,id,body,context) {
    requirePublisher(context.actor);
    if(!['approved','rejected'].includes(body.decision)) throw new Problem(422,'Choose approved or rejected.');
    return this.store.lock(name,async()=>{
      const request=this.get(name,id);
      if(request.decision || request.publicationId) throw new Problem(409,'This review already has a decision or execution.');
      if(identityKey(request.requester)===identityKey(context.actor) || request.contributors.some(a=>identityKey(a)===identityKey(context.actor))) throw new Problem(403,'A requester or contributor cannot approve or reject their own change.');
      this.assertBinding(request,this.currentBinding(request));
      if(fingerprint(await this.service.adapter.get(name))!==request.beforeHash) throw new Problem(409,'SES changed. Request a new review.');
      if(body.decision==='approved') render(request.after,this.service.mapping(name).sample || {});
      if(!this.service.authority.isPublisher(context.actor)) throw new Problem(403,'Your publishing authority changed. Sign in again.');
      const decision={decision:body.decision,actor:context.actor,created:new Date().toISOString(),authorizationPolicyHash:this.service.authority.version()};
      this.store.transaction(()=>{
        this.store.db.prepare('INSERT INTO review_decisions VALUES (?,?)').run(id,JSON.stringify(decision));
        this.store.audit('review.decision',{actor:context.actor,requestId:context.requestId,template:name,reviewId:id,outcome:body.decision});
      });
      return this.detail(name,id);
    });
  }
  check(name,kind,target,expected,body,context,details) {
    requirePublisher(context.actor);
    const metadata=this.metadata(name,body),required=this.policy(name).requireApproval;
    if(!body.reviewId) {if(required) throw new Problem(409,'Independent approval is required before publishing or restoring.');return {...metadata,reviewId:null};}
    const request=this.get(name,body.reviewId);
    this.assertBinding(request,this.binding(name,kind,expected,target,details));
    this.assertBinding(request,this.currentBinding(request));
    if(request.publicationId || request.decision?.decision!=='approved') throw new Problem(409,'This review is not approved or has already been executed.');
    if(request.changeReason!==metadata.changeReason || request.reference!==metadata.reference) throw new Problem(409,'The change reason or reference differs from the approved request.');
    if(request.decision.authorizationPolicyHash!==this.service.authority.version() || !this.service.authority.isPublisher(request.decision.actor)) throw new Problem(409,'The approval authority changed. Request a new review.');
    return {...metadata,reviewId:request.id};
  }
  consume(id,publicationId) {if(id) this.store.db.prepare('INSERT INTO review_executions VALUES (?,?)').run(id,publicationId);}
  async execute(name,id,body,context) {
    requirePublisher(context.actor);const request=this.get(name,id);
    const data={...body,version:request.draftVersion,currentHash:request.beforeHash,reason:request.changeReason,reference:request.reference,reviewId:id};
    return request.kind==='publish'?this.service.publish(name,data,context):this.service.restore(name,request.restoreRevisionId,data,context);
  }
}
