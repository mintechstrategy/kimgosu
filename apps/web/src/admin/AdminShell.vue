<script setup lang="ts">
/**
 * Console shell: owns the operator session and the two screens.
 *
 * `/admin/login` is the only entry point. A successful login moves to `/admin/`
 * in the same document (history.replaceState) — the operator token never touches
 * the URL, storage or a reload. Reloading `/admin/`, logging out, an expired or
 * revoked session, or the server answering 401/403 all return here.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createAdminApi, type AdminOperator, type AdminSessionInfo } from './api';
import { createAdminLoginClient } from './login';
import AdminApp from './AdminApp.vue';
import AdminLogin from './AdminLogin.vue';

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'https://api-dev-kimgosu.mintech.ai';
const api = createAdminApi(baseUrl);
const login = createAdminLoginClient(baseUrl);

const LOGIN_PATH = '/admin/login';
const CONSOLE_PATH = '/admin/';

const isLoginPath = () => window.location.pathname.replace(/\/+$/, '') === LOGIN_PATH;
const view = ref<'login' | 'console'>(isLoginPath() ? 'login' : 'console');
const operator = ref<AdminOperator>();
const notice = ref('');
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function clearExpiry() { if (expiryTimer !== undefined) { clearTimeout(expiryTimer); expiryTimer = undefined; } }
function go(path: string) {
  if (window.location.pathname !== path) window.history.replaceState(null, '', path);
}

function toLogin(message = '') {
  clearExpiry();
  api.clearSession();
  operator.value = undefined;
  notice.value = message;
  view.value = 'login';
  go(LOGIN_PATH);
}

function toConsole(session: AdminSessionInfo) {
  operator.value = session.operator;
  notice.value = '';
  view.value = 'console';
  go(CONSOLE_PATH);
  // Client-side guard only; the server enforces the same expiry on every request.
  clearExpiry();
  const ms = Date.parse(session.expiresAt) - Date.now();
  if (Number.isFinite(ms) && ms > 0) expiryTimer = setTimeout(() => toLogin('운영자 세션이 만료됐습니다. 다시 로그인해주세요.'), ms);
}

onMounted(() => {
  if (view.value === 'console' && !api.hasSession()) toLogin('운영자 세션이 없습니다. 로그인해주세요.');
  window.addEventListener('popstate', onPopState);
});
function onPopState() { if (isLoginPath() && view.value === 'console') toLogin(); }
onBeforeUnmount(() => { clearExpiry(); api.clearSession(); window.removeEventListener('popstate', onPopState); });
</script>

<template>
  <p v-if="view === 'login' && notice" class="notice error" role="alert">{{ notice }}</p>
  <AdminLogin v-if="view === 'login'" :api="api" :login="login" @authenticated="toConsole" />
  <AdminApp
    v-else
    :api="api"
    :operator="operator"
    @logged-out="toLogin('로그아웃했습니다. 다시 이용하려면 로그인해주세요.')"
    @session-expired="toLogin($event)"
  />
</template>

<style scoped>
.notice { max-width: 720px; margin: 16px auto 0; padding: 12px 14px; border-radius: 10px; font-family: 'Pretendard', system-ui, -apple-system, sans-serif; }
.notice.error { background: #fdf1f0; border: 1px solid #f2c6c1; color: #8f1d14; }
</style>
