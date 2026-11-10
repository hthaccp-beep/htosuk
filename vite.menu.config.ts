import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

// Independent browser app and build; the existing Operations entry is unchanged.
export default defineConfig({
  root:resolve('apps/standard-menu'),publicDir:resolve('public'),envDir:resolve('.'),plugins:[react()],
  css:{postcss:{plugins:[]}},
  build:{outDir:resolve('dist-menu'),emptyOutDir:true,sourcemap:false},
  server:{host:'127.0.0.1',port:3011,proxy:{'/api':'http://127.0.0.1:3005'}}
});
