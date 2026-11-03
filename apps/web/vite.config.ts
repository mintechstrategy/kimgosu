import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], build: { sourcemap: false }, server: { host: '127.0.0.1', port: 4178, strictPort: true } });
