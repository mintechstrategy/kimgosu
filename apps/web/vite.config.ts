import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';

/**
 * The operator console is a second document (`admin.html`) served under the
 * `/admin/…` paths so the login screen has its own URL (`/admin/login`).
 * The static host maps those paths with `public/_redirects`; the dev server and
 * preview need the same mapping, otherwise `/admin/login` falls back to the
 * member app (`index.html`).
 */
function adminPaths(): Plugin {
  const rewrite = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const [path, query] = url.split('?');
    if (path === '/admin' || path.startsWith('/admin/')) return '/admin.html' + (query ? '?' + query : '');
    return url;
  };
  return {
    name: 'kimgosu-admin-paths',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => { req.url = rewrite(req.url); next(); });
    },
    configurePreviewServer(server) {
      // Registered before the built-in static/SPA handlers so the console wins
      // over the member app fallback.
      server.middlewares.use((req, _res, next) => { req.url = rewrite(req.url); next(); });
    },
  };
}

export default defineConfig({
  plugins: [vue(), adminPaths()],
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        // Member-facing app and the operator console are separate documents.
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
});
