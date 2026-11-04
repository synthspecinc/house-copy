import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const rows=[];
for(const [path,entry] of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b))) {
  if(!path || entry.dev) continue;
  const pkg=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));
  const name=pkg.name;
  const dir=join('third_party/licenses',name.replaceAll('/','__'),entry.version);
  let source=path;
  let files=readdirSync(path).filter(f=>/^(license|licence|notice|copying)(\.|$|-)/i.test(f));
  // These upstream package distributions omit the repository's Apache license.
  const upstreamPackages=['@aws-sdk/credential-provider-http','@aws-sdk/credential-provider-login','@aws-sdk/nested-clients'];
  if(!files.length && upstreamPackages.includes(name) && pkg.license==='Apache-2.0') {
    source='third_party/upstream/aws-sdk-js-v3';
    files=['LICENSE'];
  }
  if(!files.length) throw new Error(`Missing license file for ${name}. Review the upstream distribution.`);
  mkdirSync(dir,{recursive:true});
  for(const file of files) writeFileSync(join(dir,basename(file)),readFileSync(join(source,file)));
  rows.push(`| ${name} | ${entry.version} | ${pkg.license || entry.license || 'See license'} | ${files.map(f=>`[${f}](${dir}/${f})`).join(', ')} |`);
}
writeFileSync('THIRD_PARTY_NOTICES.md',`# Third-party notices\n\nHouse Copy bundles the following runtime packages. Their licenses and notices are reproduced without modification in the linked files. Run \`npm ci\` and \`npm run notices\` after dependency changes. Node.js and operating system notices remain in their container distribution. Playwright is a development-only test tool and is not in the application image.\n\n| Package | Version | License | Text |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`);
console.log(`Recorded licenses and notices for ${rows.length} runtime packages.`);
