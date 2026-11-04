import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { FakeSes } from '../src/adapters.js';
import { TemplateService } from '../src/service.js';
export const config=JSON.parse(readFileSync(new URL('../config/templates.json',import.meta.url)));
export const fixtures=JSON.parse(readFileSync(new URL('../fixtures/templates.json',import.meta.url)));
export function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'house-copy-test-')), path=join(dir,'test.sqlite');
  const store=new Store(path), adapter=new FakeSes(store,fixtures), service=new TemplateService(store,adapter,structuredClone(config));
  t.after(()=>{store.close(); rmSync(dir,{recursive:true,force:true});});
  return {dir,path,store,adapter,service};
}
export function body(open,fields={}) { return {version:open.version,baseHash:open.baseHash,mappingHash:open.mappingHash,fields}; }
