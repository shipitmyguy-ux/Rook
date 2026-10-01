import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
for(const folder of ['rook-browser-worker','rook-listings']){
  const dir=path.join('supabase','functions',folder);
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.ts')))stripTypeScriptTypes(fs.readFileSync(path.join(dir,file),'utf8'));
}
console.log('Backend TypeScript parsed');
