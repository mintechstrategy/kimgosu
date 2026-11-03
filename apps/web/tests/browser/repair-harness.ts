// ISOLATED_BROWSER_TEST_ONLY: never imported by main.ts or included in dist.
import { createApp } from 'vue';
import App from '../../src/App.vue';
import '../../src/style.css';
import type { BrowserAuthPort } from '../../src/api';
const auth: BrowserAuthPort = { async start() {
  // Fresh in-memory test secret, never put into URL/storage/log/artifact.
  const ephemeral = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  return { kind: 'session', opaqueToken: ephemeral };
} };
createApp(App, { auth }).mount('#app');
