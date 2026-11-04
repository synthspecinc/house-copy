import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import Handlebars from 'handlebars';

export class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new Problem(422, message); };
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expressions = value => value.match(/{{{{[\s\S]*?}}}}|{{{[\s\S]*?}}}|{{[\s\S]*?}}/g) || [];
const dynamicUrls = value => value.match(/https?:\/\/[^\s<>"']*{{[^\n]*?}}[^\s<>"']*/g) || [];
function protectedValues(before, after) {
  if (JSON.stringify(expressions(before)) !== JSON.stringify(expressions(after))) fail('Keep all template variables and expressions unchanged and in the same order.');
  if (JSON.stringify(dynamicUrls(before)) !== JSON.stringify(dynamicUrls(after))) fail('Dynamic URLs are protected. Ask an operator to change their mapping.');
}
const walk = node => [node, ...(node.childNodes || []).flatMap(walk), ...(node.content ? walk(node.content) : [])];
function matches(node, selector) {
  if (/^#[\w-]+$/.test(selector)) return node.attrs?.some(a => a.name === 'id' && a.value === selector.slice(1));
  const attr = /^\[([\w-]+)="([^"<>]+)"\]$/.exec(selector);
  if (attr) return node.attrs?.some(a => a.name === attr[1] && a.value === attr[2]);
  fail('Use an #element-id or [attribute="value"] selector in the field mapping.');
}
function range(template, target) {
  const source = template[target.part];
  if (typeof source !== 'string') fail(`The ${target.part} part is missing. No changes were made.`);
  if (target.part === 'html') {
    const nodes = walk(parse(source, { sourceCodeLocationInfo: true })).filter(n => matches(n, target.selector));
    if (nodes.length !== 1) fail(`The mapping ${target.selector} must match exactly one element.`);
    const node = nodes[0], loc = node.sourceCodeLocation;
    if (!loc?.startTag || !loc.endTag || node.childNodes.some(n => n.nodeName !== '#text')) fail(`The mapping ${target.selector} must contain text only. Nested markup is protected.`);
    if (['script','style','textarea','title','iframe','noscript','xmp','plaintext'].includes(node.tagName)) fail('This HTML element cannot be edited.');
    return { part: target.part, start: loc.startTag.endOffset, end: loc.endTag.startOffset, value: node.childNodes.map(n => n.value).join(''), selector: target.selector };
  }
  if (!['subject', 'text'].includes(target.part)) fail('Unknown template part in mapping.');
  if (target.segment !== undefined) {
    if (!Number.isInteger(target.segment) || target.segment < 0 || !target.separator) fail('Text segment mappings need a separator and a nonnegative segment number.');
    const segments = source.split(target.separator);
    let value = segments[target.segment];
    if (value === undefined) fail('The text segment does not exist.');
    const start = segments.slice(0,target.segment).reduce((n,s)=>n+s.length+target.separator.length,0);
    if (target.suffix) {
      if (!value.endsWith(target.suffix)) fail('The protected text suffix changed.');
      value = value.slice(0,-target.suffix.length);
    }
    return {part:target.part,start,end:start+value.length,value,separator:target.separator};
  }
  if (target.start === undefined && target.end === undefined) return { part: target.part, start: 0, end: source.length, value: source };
  if (typeof target.start !== 'string' || !target.start || typeof target.end !== 'string' || !target.end) fail('Text anchors must be nonempty strings.');
  const found = [];
  let offset = 0;
  while (offset < source.length) {
    const begin = source.indexOf(target.start, offset);
    if (begin < 0) break;
    const start = begin + target.start.length, end = source.indexOf(target.end, start);
    if (end >= 0 && (!target.contains || source.slice(start, end).includes(target.contains))) found.push({part:target.part,start,end,value:source.slice(start,end)});
    offset = start;
  }
  if (found.length !== 1) fail('Text anchors must identify exactly one content region.');
  return found[0];
}
export function mappedFields(template, mapping) {
  const occupied = [];
  const ids = new Set();
  return mapping.fields.map(field => {
    if (!/^[a-z][\w-]*$/.test(field.id) || ids.has(field.id) || !field.targets?.length) fail('Field identifiers must be unique and have targets.');
    ids.add(field.id);
    const ranges = field.targets.map(target => range(template, target));
    if (ranges.some(r => r.value !== ranges[0].value)) fail(`The HTML and plain-text values for ${field.label} differ. Ask an operator to repair the mapping.`);
    for (const r of ranges) {
      if (occupied.some(o => o.part === r.part && ((r.start === o.start && r.end === o.end) || (r.start < o.end && r.end > o.start)))) fail('Editable field mappings overlap.');
      occupied.push(r);
    }
    return { id: field.id, label: field.label, value: ranges[0].value, tokens: expressions(ranges[0].value), ranges };
  });
}
function escapeHtml(value) {
  // Handlebars expressions must remain byte-for-byte intact, including quotes.
  return value.split(/({{{{[\s\S]*?}}}}|{{{[\s\S]*?}}}|{{[\s\S]*?}})/g).map((piece, i) => i % 2 ? piece : piece.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')).join('');
}
export function applyFields(base, mapping, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail('Content fields must be an object.');
  const fields = mappedFields(base, mapping);
  if (Object.keys(values).some(id => !fields.some(f => f.id === id))) fail('Only approved content fields can be changed.');
  const replacements = [];
  for (const field of fields) {
    const value = Object.hasOwn(values, field.id) ? values[field.id] : field.value;
    if (typeof value !== 'string' || value.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('Enter text of at most 20,000 characters.');
    protectedValues(field.value, value);
    if (field.ranges.some(r => r.separator && value.includes(r.separator))) fail('Keep paragraph separators unchanged in this field.');
    if (value !== field.value) for (const r of field.ranges) replacements.push({...r, value: r.part === 'html' ? escapeHtml(value) : value});
  }
  const next = {...base};
  for (const r of replacements.sort((a,b) => b.start - a.start)) next[r.part] = next[r.part].slice(0,r.start) + r.value + next[r.part].slice(r.end);
  for (const part of ['subject','html','text']) {
    if (base[part] !== undefined) protectedValues(base[part], next[part]);
  }
  if (Buffer.byteLength(JSON.stringify(next)) > 500000) fail('The template exceeds the 500 KB safety limit.');
  if (/[\r\n]/.test(next.subject)) fail('The subject must fit on one line.');
  // Re-extracting also checks that edited text did not invalidate an anchor.
  mappedFields(next, mapping);
  validateSyntax(next);
  return next;
}
export function validateSyntax(template) {
  try { for (const part of ['subject','html','text']) if (template[part] !== undefined) Handlebars.parse(template[part]); }
  catch { fail('The template contains invalid Handlebars syntax. Ask an operator to repair it.'); }
}
export function render(template, sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample) || Buffer.byteLength(JSON.stringify(sample)) > 50000) fail('Sample data must be a JSON object smaller than 50 KB.');
  validateSyntax(template);
  try {
    const result = {};
    for (const part of ['subject','html','text']) if (template[part] !== undefined) result[part] = Handlebars.compile(template[part], {strict:true, noEscape:true})(sample, {allowProtoMethodsByDefault:false, allowProtoPropertiesByDefault:false});
    return result;
  } catch { fail('Preview could not resolve a variable or helper. Check the sample data and ask an operator about unsupported expressions.'); }
}
// A sandboxed iframe adds a second boundary. CSP blocks requests, scripts and forms.
export function previewDocument(html = '') {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'";
  // Put the CSP first and remove refresh and base elements, which could navigate.
  const doc = parse(html, {sourceCodeLocationInfo:true});
  const removals = walk(doc).filter(n => ['base','script','iframe','object','embed','form'].includes(n.tagName) || n.tagName === 'meta' && n.attrs?.some(a => a.name === 'http-equiv')).map(n => n.sourceCodeLocation).filter(Boolean);
  let safe = html;
  for (const loc of removals.sort((a,b) => b.startOffset-a.startOffset)) safe = safe.slice(0,loc.startOffset)+safe.slice(loc.endOffset);
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">${safe}`;
}
