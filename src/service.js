import { Problem, applyFields, mappedFields, fingerprint, render, previewDocument } from './editor.js';
import { randomUUID } from 'node:crypto';

export class TemplateService {
  constructor(store, adapter, config) {
    this.store=store; this.adapter=adapter; this.config=config;
    if (!Array.isArray(config.templates) || new Set(config.templates.map(t=>t.name)).size !== config.templates.length) throw new Error('Template names must be unique.');
    for (const t of config.templates) if (!/^[\w-]{1,64}$/.test(t.name) || !Array.isArray(t.fields)) throw new Error('Invalid template configuration.');
  }
  mapping(name) { const m=this.config.templates.find(t=>t.name===name); if (!m) throw new Problem(404,'This template is not configured.'); return m; }
  list() { return this.config.templates.map(({name,label,description,fields})=>({name,label,description,editable:fields.length>0})); }
  async open(name) {
    const mapping=this.mapping(name), current=await this.adapter.get(name), draft=this.store.draft(name);
    const template=draft?.template || current;
    let fields=[], mappingError;
    try { fields=mappedFields(template,mapping); }
    catch (e) { if (!(e instanceof Problem)) throw e; mappingError=e.message; }
    if (draft && draft.mappingHash!==fingerprint(mapping)) mappingError='Field configuration changed. Discard this draft and reopen the current template before editing.';
    const pending=this.store.pending(name).length>0;
    return {name,label:mapping.label,template,fields:fields.map(({ranges,...f})=>({...f,selectors:ranges.filter(r=>r.part==='html').map(r=>r.selector)})),sample:mapping.sample || {},
      version:draft?.version || null,baseHash:draft?.baseHash || fingerprint(current),currentHash:fingerprint(current),
      mappingHash:fingerprint(mapping),hasDraft:!!draft,stale:!!draft && draft.baseHash!==fingerprint(current),mappingError,
      recoveryRequired:pending,editable:fields.length>0 && !mappingError && !pending,
      revisions:this.store.revisions(name).map(({template,...r})=>r)};
  }
  async save(name, body) {
    this.mapping(name);
    return this.store.lock(name,async()=>{
      const mapping=this.mapping(name), current=await this.adapter.get(name), existing=this.store.draft(name);
      if (body.mappingHash!==fingerprint(mapping)) throw new Problem(409,'Field configuration changed. Reopen the template.');
      if (existing && existing.mappingHash!==body.mappingHash) throw new Problem(409,'Field configuration changed. Discard the old draft before editing.');
      if (existing ? body.version!==existing.version : body.version!==null) throw new Problem(409,'This draft changed in another window. Reopen the template.');
      if (body.baseHash!==fingerprint(current) || existing && existing.baseHash!==body.baseHash) throw new Problem(409,'SES changed since you opened this template. Reopen it and review the current version.');
      if (this.store.pending(name).length) throw new Problem(409,'An earlier update needs operator recovery. Publishing is blocked.');
      if (!mapping.fields.length) throw new Problem(422,'This template has no approved content fields.');
      const template=applyFields(existing?.template || current,mapping,body.fields);
      const draft={template,baseHash:body.baseHash,version:randomUUID(),mappingHash:body.mappingHash};
      this.store.saveDraft(name,draft);
      return this.open(name);
    });
  }
  async discard(name, version) {
    this.mapping(name);
    return this.store.lock(name, async()=>{
      if (this.store.draft(name)?.version!==version) throw new Problem(409,'This draft changed. Reopen it before discarding.');
      this.store.deleteDraft(name); return this.open(name);
    });
  }
  async preview(name, body) {
    const mapping=this.mapping(name), current=await this.adapter.get(name), draft=this.store.draft(name);
    if (draft && draft.mappingHash!==fingerprint(mapping)) throw new Problem(409,'Field configuration changed. Discard the old draft before previewing.');
    if (body.version !== (draft?.version || null)) throw new Problem(409,'The draft changed. Reopen it before previewing.');
    const template=applyFields(draft?.template || current,mapping,body.fields);
    const result=render(template,body.sample);
    return {...result,html:previewDocument(result.html)};
  }
  async publish(name, body) {
    this.mapping(name);
    return this.store.lock(name,async()=>{
      const draft=this.store.draft(name);
      if (!draft || body.version!==draft.version) throw new Problem(409,'Save your latest draft before publishing.');
      if (draft.mappingHash!==fingerprint(this.mapping(name))) throw new Problem(409,'Field configuration changed. Reopen and save the draft.');
      if (body.confirmName!==name) throw new Problem(422,'Confirm the template name before publishing.');
      // Validate all parts and sample data before any remote write.
      render(draft.template,body.sample);
      await this.write(name,draft.template,draft.baseHash,'Before publish');
      this.store.deleteDraft(name);
      return this.open(name);
    });
  }
  async restore(name,id,body) {
    this.mapping(name);
    return this.store.lock(name,async()=>{
      if (this.store.draft(name)) throw new Problem(409,'Discard or publish the saved draft before restoring a revision.');
      if (body.confirmName!==name) throw new Problem(422,'Confirm the template name before restoring.');
      const revision=this.store.revision(name,id);
      if (!revision) throw new Problem(404,'Revision not found.');
      // Restore is exact, including historical HTML, text, expressions and attributes.
      await this.write(name,revision.template,body.currentHash,'Before restore');
      return this.open(name);
    });
  }
  async write(name,next,expected,reason) {
    if (this.store.pending(name).length) throw new Problem(409,'An earlier update needs operator recovery. No further writes are allowed.');
    const previous=await this.adapter.get(name);
    if (fingerprint(previous)!==expected) throw new Problem(409,'SES changed since you opened this template. Reopen it before writing.');
    this.store.snapshot(name,previous,reason);
    const operation=this.store.operation(name,{previous,next,created:new Date().toISOString()});
    try {
      await this.adapter.update(next);
      if (fingerprint(await this.adapter.get(name))!==fingerprint(next)) throw new Error('Read-back mismatch');
      this.store.finish(operation);
    } catch {
      throw new Problem(502,'The update could not be confirmed. Your prior revision is safe. Publishing is blocked until an operator checks SES and recovers the pending operation.');
    }
  }
}
