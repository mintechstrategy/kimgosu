// TEST-ONLY constructor/controlled-provider boundary. Never imported by main.ts.
// Only genuine backend-issued tickets/sessions reach App. No window injector,
// localStorage credential, private-route bypass, hardcoded session or READY flag.
import { createApp } from 'vue';
import App from '../../src/App.vue';
import '../../src/style.css';
import { createApiClient, type BrowserAuthPort } from '../../src/api';
const base = import.meta.env.VITE_API_BASE_URL;
if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(base)) throw Error('LOCAL_TEST_ORIGIN_REQUIRED');
const api = createApiClient(base);
const encode = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const auth:BrowserAuthPort = {async start(provider) {
  const codeVerifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(codeVerifier))));
  const started = await api.socialStart(provider,codeChallenge);
  // Controlled local provider authorize() returns a private test code instead
  // of authenticating a person. This is not a shipped OAuth redirect handler.
  const url = new URL(started.authorizationUrl);
  if (url.origin !== base || url.pathname !== '/controlled-provider' || url.searchParams.get('state') !== started.state || !url.searchParams.get('code')) throw Error('LOCAL_PROVIDER_BOUNDARY');
  return api.socialComplete({provider,state:started.state,code:url.searchParams.get('code')!,codeVerifier});
}};
createApp(App,{api,auth}).mount('#app');
