import { defineConfig } from 'cf/config';
export default defineConfig({
  worker: {
    name: 'kimgosu-dev-console',
    compatibilityDate: '2026-10-30',
    assets: { notFoundHandling: 'single-page-application' },
    domains: [{ hostname: 'dev-kimgosu.mintech.ai', production: true, previews: false }],
  },
});
