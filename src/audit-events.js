const text=value=>typeof value==='string'?value.slice(0,2048):undefined;
const identity=value=>value && typeof value==='object'?{issuer:text(value.issuer),subject:text(value.subject),role:text(value.role)}:undefined;
export function auditEvent(value) {
  const event={};
  for(const key of ['eventId','created','action','outcome','requestId','template','revision','publicationId','beforeHash','afterHash','providerRequestId','reviewId']) if(typeof value[key]==='string') event[key]=text(value[key]);
  if(value.actor) event.actor=identity(value.actor);
  if(value.target) event.target=identity(value.target);
  if(value.scope) event.scope=Object.fromEntries(['mode','environment','account','region'].map(k=>[k,value.scope[k]===null?null:text(value.scope[k])]));
  return event;
}
