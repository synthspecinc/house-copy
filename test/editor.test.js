import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFields, mappedFields, previewDocument, render } from '../src/editor.js';
import { fixtures,config } from './helpers.js';
const base=fixtures[0], mapping=config.templates[0];

test('a no-op is byte-for-byte identical in all parts',()=>assert.deepEqual(applyFields(base,mapping,{}),base));
test('HTML and text change together while expressions, dynamic attributes, layout and whitespace survive',()=>{
  const fields={subject:'Your new home, {{person.firstName}} at {{company.name}}'};
  assert.throws(()=>applyFields(base,mapping,fields),/same order/);
  const result=applyFields(base,mapping,{headline:'Make <great> things & stay curious',greeting:'Hi {{person.firstName}}, settle in.',intro:'Bring your team together.',action:'Get started'});
  assert.equal(result.html,base.html.replace('A good place to start','Make &lt;great&gt; things &amp; stay curious').replace('Hello {{person.firstName}}, welcome home.','Hi {{person.firstName}}, settle in.').replace('Your workspace is ready. Make yourself at home and take a look around.','Bring your team together.').replace('Open your workspace</a>','Get started</a>'));
  assert.equal(result.text,base.text.replace('A good place to start','Make <great> things & stay curious').replace('Hello {{person.firstName}}, welcome home.','Hi {{person.firstName}}, settle in.').replace('Your workspace is ready. Make yourself at home and take a look around.','Bring your team together.').replace('Open your workspace:', 'Get started:'));
  assert.equal(result.subject,base.subject);
  assert.deepEqual(applyFields(result,mapping,{}),result);
});
test('tokens cannot be deleted, reordered, added or changed, including triple braces and control blocks',()=>{
  for(const greeting of ['Hello','Hello {{other}}','{{person.firstName}} {{x}}']) assert.throws(()=>applyFields(base,mapping,{greeting}),/expressions/);
  const t={name:'x',subject:'{{#if user}}{{{user.name}}}{{else}}Friend{{/if}}',text:'Go https://example.test/{{id}}?x=1'};
  const m={fields:[{id:'subject',targets:[{part:'subject'}]},{id:'body',targets:[{part:'text'}]}]};
  assert.throws(()=>applyFields(t,m,{subject:'{{#if user}}{{user.name}}{{else}}Friend{{/if}}'}),/expressions/);
  assert.throws(()=>applyFields(t,m,{body:'Go https://other.test/{{id}}?x=1'}),/Dynamic URLs/);
  assert.equal(applyFields(t,m,{subject:'{{#if user}}{{{user.name}}}{{else}}Hello{{/if}}'}).subject,'{{#if user}}{{{user.name}}}{{else}}Hello{{/if}}');
});
test('unmapped fields, overlapping fields and nested HTML are rejected',()=>{
  assert.throws(()=>applyFields(base,mapping,{html:'<script>x</script>'}),/approved/);
  assert.throws(()=>mappedFields(base,{fields:[mapping.fields[1],{...mapping.fields[1],id:'other'}]}),/overlap/);
  assert.throws(()=>mappedFields({subject:''},{fields:[{id:'first',targets:[{part:'subject'}]},{id:'second',targets:[{part:'subject'}]}]}),/overlap/);
  assert.throws(()=>mappedFields({...base,html:base.html.replace('A good place to start','A <b>good</b> place')},mapping),/Nested markup/);
  assert.throws(()=>mappedFields({...base,html:base.html.replace('id="headline"','id="different"')},mapping),/exactly one/);
  assert.throws(()=>applyFields(base,mapping,{intro:'Hello\n\nAnother paragraph'}),/separators/);
});
test('quotes inside expressions survive escaped content edits, and unchanged entities stay byte-identical',()=>{
  const t={name:'x',subject:'Welcome',html:'<p id="a">Hi &amp; {{#if (lookup user "name")}}friend{{/if}}</p>'};
  const m={fields:[{id:'a',targets:[{part:'html',selector:'#a'}]}]};
  assert.equal(applyFields(t,m,{}).html,t.html);
  assert.equal(applyFields(t,m,{a:'Hello & {{#if (lookup user "name")}}friend{{/if}}'}).html,'<p id="a">Hello &amp; {{#if (lookup user "name")}}friend{{/if}}</p>');
});
test('render resolves nested paths, loops, conditionals, inline partials and plain text',()=>{
  const result=render(base,mapping.sample);
  assert.match(result.subject,/Alex/); assert.match(result.html,/Spring launch/); assert.match(result.text,/token=sample/);
  assert.match(render(fixtures[1],config.templates[1].sample).text,/Notebook: 12.00/);
  assert.equal(render({subject:'{{#*inline "hello"}}Hi {{name}}{{/inline}}{{> hello}}'}, {name:'Alex'}).subject,'Hi Alex');
  assert.throws(()=>render(base,{}),/resolve/);
  assert.throws(()=>render({subject:'{{#if x}}'},{}),/invalid Handlebars/);
});
test('preview isolation removes active navigation elements and puts restrictive CSP first',()=>{
  const result=previewDocument('<meta http-equiv="refresh" content="0;url=https://example.test"><base href="https://example.test"><script>alert(1)</script><iframe src="https://example.test"></iframe><p>Hi</p>');
  assert.match(result,/^<meta http-equiv="Content-Security-Policy"/); assert.match(result,/default-src 'none'/); assert.doesNotMatch(result,/refresh|<base|<script|<iframe/); assert.match(result,/<p>Hi<\/p>/);
});

test('literal text anchors reject ambiguous prefixes and preserve both anchors',()=>{
  const t={name:'a',subject:'Hello',text:'PREFIX Editable SUFFIX'};
  const m={fields:[{id:'copy',targets:[{part:'text',start:'PREFIX ',end:' SUFFIX'}]}]};
  assert.equal(applyFields(t,m,{copy:'New content'}).text,'PREFIX New content SUFFIX');
  assert.throws(()=>mappedFields({...t,text:'PREFIX One PREFIX Two SUFFIX'},m),/exactly one/);
});
