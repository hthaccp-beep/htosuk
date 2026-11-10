
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import release from './app-version.json';

let requiredCode: string[] = [];
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {name:'htos-complete-code-cache',generateBundle(_options,bundle){requiredCode=Object.keys(bundle).filter(file=>/\.(js|css)$/.test(file));}},
    {name:'htos-static-version',generateBundle(){
      this.emitFile({type:'asset',fileName:'app-version.json',source:JSON.stringify(release)});
      // Versioned URL binds the answer to this worker's build, not the latest server JSON.
      this.emitFile({type:'asset',fileName:`htos-release-${release.version}.js`,source:`self.addEventListener('message',event=>{if(event.data?.type==='HTOS_RELEASE')event.ports?.[0]?.postMessage({version:${JSON.stringify(release.version)}});});`});
    }},
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'index.html'],
      manifest: {
        name: 'HTOS',
        short_name: 'HTOS',
        description: 'Your operations, in order',
        theme_color: '#243b22',
        background_color: '#243b22',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {src:'pwa-192x192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},
          {src:'pwa-512x512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'},
          {src:'icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        manifestTransforms: [async manifest => {
          const cached = new Set(manifest.map(entry => entry.url));
          const missing = requiredCode.filter(file => !cached.has(file));
          if (missing.length) throw new Error(`Incomplete offline app code: ${missing.join(', ')}`);
          return {manifest,warnings:[]};
        }],
        // Keep the whole code graph: an open tab must still load unused routes
        // after a deployment removes the previous release's hashed files.
        navigateFallback: '/index.html', // CRITICAL for SPA: Serve index.html for all navigation requests
        navigateFallbackDenylist: [/^\/api\//, /^\/assets\//, /^\/app-version\.json$/],
        importScripts: [`/htos-release-${release.version}.js`, '/htos-update-guard.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/cdn\.tailwindcss\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tailwind-cache',
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: true,
  },
  server: {
    port: 3000
  }
});
