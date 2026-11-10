import { build } from 'vite';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const folder=resolve('../../work/ui-preview-deployment');
// No env files or Firebase credentials are loaded into the synthetic preview.
await build({mode:'ui-preview',envDir:resolve('../../work/ui-preview-empty-env'),build:{outDir:folder+'/.vercel/output/static',emptyOutDir:true,rollupOptions:{input:resolve('tests/ui-preview.html')}}});
await mkdir(folder+'/.vercel',{recursive:true});
await copyFile('.vercel/project.json',folder+'/.vercel/project.json');
await writeFile(folder+'/.vercel/output/config.json',JSON.stringify({version:3,routes:[{src:'^/$',dest:'/tests/ui-preview.html'},{handle:'filesystem'}]}));

await copyFile('tests/responsive-preview.html',folder+'/.vercel/output/static/tests/responsive-preview.html');
