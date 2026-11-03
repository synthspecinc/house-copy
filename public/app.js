'use strict';
const $=id=>document.getElementById(id);
let state, fields={}, sample={}, dirty=false, previewed=false, view='edit', busy=false, identity,csrfToken;
async function api(path,method='GET',body) {
  const response=await fetch(`/api/templates${path}`,{method,headers:{'Content-Type':'application/json','X-House-Copy':'1',...(csrfToken?{'X-CSRF-Token':csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  if(response.status===401) sessionEnded();
  if(!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}
function status(message,error=false) { $('status').textContent=message; $('status').classList.toggle('error',error); }
function sessionEnded() {
  identity=undefined;csrfToken=undefined;
  $('account-name').textContent='';$('environment').textContent='Sign-in required';
  $('session-message').textContent=state?'Your session ended. Your unsaved content stays here. Sign in in a new tab, then return and choose Resume after sign-in.':'Sign in with your organization account to open House Copy.';
  $('session-notice').hidden=false;$('logout').hidden=true;syncButtons();
}
async function refreshSession() {
  const response=await fetch('/auth/session');
  if(!response.ok) {sessionEnded();return false;}
  const data=await response.json();identity=data.user;csrfToken=data.csrfToken;
  $('environment').textContent=data.mode==='demo'?'Local demo · Fake SES':'Signed in';
  $('account-name').textContent=`${identity.label} · ${identity.role}`;
  $('logout').hidden=data.mode==='demo';$('session-notice').hidden=true;syncButtons();return true;
}
function changes() { dirty=true; previewed=false; $('draft-state').textContent='Unsaved changes'; syncButtons(); }
function syncButtons() {
  const blocked=busy || !identity || !state?.editable || state.stale;
  $('save').disabled=blocked || !dirty;
  $('publish').disabled=blocked || identity?.role!=='publisher' || dirty || !state?.hasDraft || !previewed;
  $('discard').disabled=busy || !state?.hasDraft;
  for(const button of $('revisions').querySelectorAll('button')) button.disabled=busy || !identity || identity.role!=='publisher' || state?.recoveryRequired;
  for(const input of $('fields').querySelectorAll('input,textarea')) input.disabled=!!blocked;
  if(view==='edit') for(const field of state?.fields || []) for(const selector of field.selectors) {
    const node=$('email').contentDocument?.querySelector(selector); if(node) node.contentEditable=String(!blocked);
  }
  $('publish-help').textContent=identity?.role==='editor'?'You can edit and save drafts. A publisher must publish or restore them.':dirty?'Save your draft, then review a sample preview.':previewed?'Your sample preview is ready. Publishing updates the existing SES template.':'Review a sample preview before publishing.';
}
async function work(action) {
  if(busy) return;
  busy=true; syncButtons();
  try { await action(); } catch(e) { status(e.message,true); }
  finally { busy=false; syncButtons(); }
}
async function load(name) {
  const data=await api(`/${encodeURIComponent(name)}`);
  state=data; dirty=false; previewed=false; sample=structuredClone(data.sample); fields=Object.fromEntries(data.fields.map(f=>[f.id,f.value]));
  $('library').hidden=true; $('editor').hidden=false;
  $('template-name').textContent=data.name; $('template-label').textContent=data.label;
  $('draft-state').textContent=data.hasDraft?'Saved draft':'Published';
  const message=data.recoveryRequired?'A previous publish needs an operator check. Further writes are blocked.':data.mappingError || (data.stale?'SES has a newer version. Discard this draft to load it.':!data.editable?'This template is protected. Ask an operator to map its editable content.':'');
  $('notice').textContent=message; $('notice').hidden=!message;
  $('fields').replaceChildren();
  for(const field of data.fields) {
    const label=document.createElement('label'); label.textContent=field.label;
    const input=document.createElement(field.id==='subject'?'input':'textarea'); input.value=field.value; input.id=`field-${field.id}`; input.setAttribute('aria-label',field.label); input.disabled=!data.editable || data.stale;
    input.addEventListener('input',()=>{fields[field.id]=input.value; changes(); if(view==='edit') updateFrameField(field,input.value);});
    label.append(input);
    if(field.tokens.length) { const note=document.createElement('small'); note.textContent=`Protected variables: ${field.tokens.join(' ')}`; label.append(note); }
    $('fields').append(label);
  }
  $('sample').replaceChildren();
  function sampleInputs(value,path=[]) {
    for(const [key,v] of Object.entries(value)) {
      const p=[...path,key];
      if(v!==null && typeof v==='object') { sampleInputs(v,p); continue; }
      const label=document.createElement('label'); label.textContent=p.join(' › ');
      const input=document.createElement('input'); input.value=String(v ?? '');
      input.type=typeof v==='boolean'?'checkbox':typeof v==='number'?'number':'text'; if(input.type==='checkbox') input.checked=v;
      input.addEventListener('input',()=>{let obj=sample; for(const k of p.slice(0,-1)) obj=obj[k]; obj[p.at(-1)]=typeof v==='boolean'?input.checked:typeof v==='number'?Number(input.value):input.value; previewed=false; syncButtons();});
      label.append(input); $('sample').append(label);
    }
  }
  sampleInputs(sample);
  $('revisions').replaceChildren();
  if(!data.revisions.length) { const p=document.createElement('p'); p.className='quiet'; p.textContent='A prior revision appears here after your first publish.'; $('revisions').append(p); }
  for(const revision of data.revisions) {
    const item=document.createElement('div'); item.className='revision';
    const text=document.createElement('p'); text.textContent=`${revision.reason} · ${new Date(revision.created).toLocaleString()} · ${revision.actor?.subject || 'Unknown actor'}`;
    const button=document.createElement('button'); button.textContent='Restore this revision'; button.className='text-button'; button.disabled=data.recoveryRequired || identity?.role!=='publisher';
    button.onclick=()=>work(async()=>{
      if(dirty || state.hasDraft) throw new Error('Discard or publish the current draft before restoring a revision.');
      if(await confirmAction('Restore this revision?','This replaces the current SES template with the saved HTML, plain text and subject. House Copy saves the current version first.','Restore revision')) {
        await api(`/${state.name}/revisions/${revision.id}/restore`,'POST',{currentHash:state.currentHash,confirmName:state.name}); await load(state.name); status('Prior revision restored.');
      }
    });
    item.append(text,button); $('revisions').append(item);
  }
  showEdit(); syncButtons();
}
function updateFrameField(field,value) {
  for(const selector of field.selectors) {
    const node=$('email').contentDocument?.querySelector(selector);
    if(node) node.textContent=value;
  }
  $('subject-preview').textContent=fields.subject ?? state.template.subject;
}
function switchView(next) {
  view=next; $('email').hidden=next==='text'; $('plain').hidden=next!=='text';
  for(const [id,value] of [['edit-view','edit'],['preview','preview'],['text-view','text']]) $(id).setAttribute('aria-pressed',String(next===value));
}
function showEdit() {
  switchView('edit'); $('subject-preview').textContent=fields.subject ?? state.template.subject;
  $('email').title='Email visual editor';
  $('email').onload=()=>{
    if(view!=='edit' || !state) return;
    const doc=$('email').contentDocument;
    doc.addEventListener('click',event=>{ if(event.target.closest('a')) event.preventDefault(); });
    doc.addEventListener('submit',event=>event.preventDefault());
    for(const field of state.fields) for(const selector of field.selectors) {
      const node=doc.querySelector(selector); if(!node) continue;
      node.textContent=fields[field.id];
      node.style.outline='1px dashed #7b9d8a'; node.style.outlineOffset='5px';
      node.contentEditable=String(state.editable && !state.stale);
      node.setAttribute('aria-label',field.label); node.setAttribute('role','textbox');
      node.addEventListener('input',()=>{fields[field.id]=node.textContent; $(`field-${field.id}`).value=node.textContent; changes();});
      node.addEventListener('paste',event=>{
        event.preventDefault(); const text=event.clipboardData.getData('text/plain');
        const selection=doc.getSelection(); if(!selection.rangeCount) return;
        const range=selection.getRangeAt(0); range.deleteContents(); const inserted=doc.createTextNode(text); range.insertNode(inserted); range.setStartAfter(inserted); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); node.dispatchEvent(new Event('input'));
      });
      node.addEventListener('keydown',event=>{if(event.key==='Enter') event.preventDefault();});
      node.addEventListener('drop',event=>event.preventDefault());
    }
  };
  $('email').srcdoc=state.editorHtml;
  $('view-help').textContent='Click a highlighted area to edit. Layout and links stay protected.';
}
async function makePreview(next) {
  const result=await api(`/${state.name}/preview`,'POST',{fields,sample,version:state.version});
  previewed=true; switchView(next); $('subject-preview').textContent=result.subject;
  $('email').onload=null; $('email').title='Email sample preview'; $('email').srcdoc=result.html;
  // The parent cancels link navigation in the sandboxed rendered preview too.
  $('email').onload=()=> $('email').contentDocument?.addEventListener('click',event=>event.preventDefault());
  $('plain').textContent=result.text ?? 'This template has no plain-text part.';
  $('view-help').textContent='Sample preview. External images, scripts, forms and links are blocked. No email is sent.';
  syncButtons();
}
function confirmAction(title,copy,button) {
  $('confirm-title').textContent=title; $('confirm-copy').textContent=copy; $('confirm-name').textContent=state.name; $('confirm-action').textContent=button;
  $('confirmation').showModal();
  return new Promise(resolve=> $('confirmation').addEventListener('close',()=>resolve($('confirmation').returnValue==='confirm'),{once:true}));
}
$('fields').onsubmit=event=>event.preventDefault();
$('save').onclick=()=>work(async()=>{
  const name=state.name;
  await api(`/${name}/draft`,'PUT',{fields,version:state.version,baseHash:state.baseHash,mappingHash:state.mappingHash}); await load(name); status('Draft saved. SES has not changed.');
});
$('discard').onclick=()=>work(async()=>{
  if(await confirmAction('Discard this draft?','This removes saved and unsaved edits and reloads the current SES template.','Discard draft')) { await api(`/${state.name}/discard`,'POST',{version:state.version}); await load(state.name); status('Draft discarded.'); }
});
$('edit-view').onclick=showEdit;
$('preview').onclick=()=>work(()=>makePreview('preview'));
$('text-view').onclick=()=>work(()=>makePreview('text'));
$('publish').onclick=()=>work(async()=>{
  if(await confirmAction('Publish these changes?','Your application will use this copy the next time it sends this template. You can restore the prior revision from history.','Publish changes')) { await api(`/${state.name}/publish`,'POST',{version:state.version,confirmName:state.name,sample}); await load(state.name); status('Changes published. The prior revision is in history.'); }
});
$('back').onclick=()=>work(async()=>{
  if(dirty && !await confirmAction('Leave unsaved changes?','Your saved draft will remain. Unsaved edits will be lost.','Leave editor')) return;
  state=null; dirty=false; $('editor').hidden=true; $('library').hidden=false; status('');
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function loadLibrary() {
  $('templates').replaceChildren();
  const data=await api(''); $('library').hidden=false; $('environment').textContent=data.mode==='fake'?(csrfToken?'Fake SES · Signed in':'Local demo · Fake SES'):'Connected to Amazon SES';
  for(const t of data.templates) {
    const button=document.createElement('button'); button.className='template-card';
    const icon=document.createElement('span'); icon.className='card-icon'; icon.textContent=t.editable?'✉':'▤';
    const title=document.createElement('h2'); title.textContent=t.label;
    const description=document.createElement('p'); description.textContent=t.description;
    const name=document.createElement('small'); name.className='mono'; name.textContent=t.name;
    const action=document.createElement('span'); action.className='card-action'; action.textContent=t.editable?'Open template →':'View protected template →';
    button.append(icon,title,description,name,action); button.onclick=()=>work(()=>load(t.name)); $('templates').append(button);
  }
}
$('resume').onclick=()=>work(async()=>{if(await refreshSession()){if(!state) await loadLibrary();status('Signed in. You can continue with the content in this window.');}});
$('logout').onclick=()=>work(async()=>{
  if(dirty && !await confirmAction('Sign out with unsaved changes?','Unsaved edits in this window will be lost. Saved drafts remain available to your team.','Sign out')) return;
  const response=await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-House-Copy':'1','X-CSRF-Token':csrfToken},body:'{}'});
  if(!response.ok) throw new Error('Sign-out could not be confirmed. Try again.');
  dirty=false;state=undefined;fields={};sample={};$('editor').hidden=true;$('library').hidden=true;$('templates').replaceChildren();$('email').onload=null;$('email').srcdoc='';$('fields').replaceChildren();$('sample').replaceChildren();$('revisions').replaceChildren();$('plain').textContent='';$('subject-preview').textContent='';$('account-name').textContent='';sessionEnded();status('Signed out of House Copy.');
});
work(async()=>{if(await refreshSession()) await loadLibrary();});
