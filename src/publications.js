import { fingerprint,Problem } from './editor.js';
export function changeMetadata(body,scope) {
  const reason=body.reason===undefined || body.reason===''?(scope.mode==='fake'?'Synthetic demo change':undefined):body.reason;
  if(typeof reason!=='string' || !reason.trim() || reason.length>1000) throw new Problem(422,'Enter a change reason of at most 1,000 characters.');
  const reference=body.reference || null;
  if(reference!==null && (typeof reference!=='string' || reference.length>500 || /[\r\n\u0000]/.test(reference))) throw new Problem(422,'Enter a single-line change reference of at most 500 characters.');
  return {changeReason:reason.trim(),reference};
}
export function comparison(before,after) {
  return ['subject','html','text'].map(part=>({part,before:before[part]??null,after:after[part]??null,changed:before[part]!==after[part]}));
}
export function publicationSummary(record) {
  const {before,after,results,...summary}=record;
  return {...summary,status:results.at(-1)?.outcome || 'pending',result:results.at(-1) || null};
}
export function publicationRecord(name,before,after,reason,context,scope,revisionId) {
  return {name,before,after,beforeHash:fingerprint(before),afterHash:fingerprint(after),action:reason==='Before publish'?'publish':'restore',
    actor:context.actor || null,requestId:context.requestId || null,scope,revisionId,changeReason:context.changeReason,
    reference:context.reference || null,mappingHash:context.mappingHash || null,reviewId:context.reviewId || null};
}
