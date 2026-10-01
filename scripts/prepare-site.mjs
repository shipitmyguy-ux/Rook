import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
const build = process.argv[2];
if (!build || !/^[a-zA-Z0-9-]+$/.test(build)) throw new Error('A build ID is required');
await rm('_site', {recursive:true,force:true});
await mkdir('_site');
for (const file of ['index.html','src','assets','config']) await cp(file,path.join('_site',file),{recursive:true});
async function versionModules(dir) {
  for (const file of await readdir(dir,{withFileTypes:true})) {
    const target=path.join(dir,file.name);
    if (file.isDirectory()) await versionModules(target);
    else if (file.name.endsWith('.js')) {
      const code=await readFile(target,'utf8');
      await writeFile(target,code.replace(/((?:\bfrom\s*|\bimport\s*)["'])(\.{1,2}\/[^"']+\.js)(?:\?[^"']*)?(["'])/g,`$1$2?v=${build}$3`));
    } else if (file.name.endsWith('.css')) {
      const css=await readFile(target,'utf8');
      await writeFile(target,css.replace(/(\.\.\/assets\/[^)'"?]+)(?:\?v=[^)'"]+)?/g,`$1?v=${build}`));
    }
  }
}
await versionModules('_site/src');
const html=await readFile('_site/index.html','utf8');
await writeFile('_site/index.html',html.replace(/(app\.js|rook-ui-v3\.css)(?:\?v=[^"']+)?/g,`$1?v=${build}`));
await writeFile('_site/build.txt',build+'\n');
