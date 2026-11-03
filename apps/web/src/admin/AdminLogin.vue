<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { AdminApiError, type AdminApi, type AdminSessionInfo } from './api';
import type { AdminLoginClient, DevAccount, LoginProvider } from './login';

const props = defineProps<{ api: AdminApi; login: AdminLoginClient }>();
const emit = defineEmits<{ authenticated: [session: AdminSessionInfo] }>();

const providers = ref<LoginProvider[]>([]);
const accounts = ref<DevAccount[]>([]);
const loading = ref(true);
const loadError = ref('');
const error = ref('');
const selectedSlot = ref<number | null>(null);
const busy = ref(false);

const connected = computed(() => providers.value.filter(p => p.connected));
const providerLabel = (id: string) => id === 'kakao' ? '카카오' : id === 'naver' ? '네이버' : 'Google';
const canSubmit = computed(() => selectedSlot.value !== null && !busy.value);

function messageFor(e: unknown): string {
  if (!(e instanceof AdminApiError)) return '로그인하지 못했습니다. 잠시 후 다시 시도해주세요.';
  switch (e.code) {
    case 'ADMIN_REQUIRED': {
      const left = e.attemptsRemaining;
      return '이 계정에는 유효한 관리자(ADMIN) 역할이 없습니다. 운영 콘솔은 ADMIN만 사용할 수 있습니다.'
        + (typeof left === 'number' && left > 0 ? ` 남은 시도 ${left}회.` : '');
    }
    case 'ADMIN_LOGIN_LOCKED':
      return `로그인 시도가 잠겼습니다. ${e.retryAfterSeconds ?? 300}초 후 다시 시도해주세요.`;
    case 'SESSION_INVALID': return '로그인 세션이 유효하지 않습니다. 다시 로그인해주세요.';
    case 'AUTH_RATE_LIMITED': return '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
    case 'DEV_ACCOUNT_NOT_FOUND': return '선택한 테스트 계정을 사용할 수 없습니다.';
    case 'DEV_ACCOUNTS_UNAVAILABLE': return '테스트 로그인 목록을 불러오지 못했습니다.';
    case 'LOGIN_FAILED': return '로그인하지 못했습니다. 계정 상태를 확인해주세요.';
    case 'TIMEOUT': return '응답 시간이 초과됐습니다. 다시 시도해주세요.';
    case 'NETWORK_ERROR': return '서버에 연결하지 못했습니다. 네트워크와 배포 상태를 확인해주세요.';
    default: return '로그인하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
}

async function load() {
  loading.value = true; loadError.value = '';
  try {
    // Providers and tester accounts are independent reads; one failing must not
    // hide the other, and neither may be invented when it fails.
    const [providerResult, accountResult] = await Promise.allSettled([props.login.providers(), props.login.devAccounts()]);
    if (providerResult.status === 'fulfilled') providers.value = providerResult.value;
    else loadError.value = messageFor(providerResult.reason);
    if (accountResult.status === 'fulfilled') accounts.value = accountResult.value;
    else if (!loadError.value) loadError.value = messageFor(accountResult.reason);
  } finally { loading.value = false; }
}

async function submit() {
  if (!canSubmit.value || selectedSlot.value === null) return;
  busy.value = true; error.value = '';
  try {
    // 1) a real login issues a member session, 2) the server decides whether that
    // member may hold an operator session. A non-admin stops at step 2 with 403.
    const sessionToken = await props.login.devLogin(selectedSlot.value);
    const info = await props.api.login(sessionToken);
    emit('authenticated', info);
  } catch (e) {
    error.value = messageFor(e);
  } finally { busy.value = false; }
}

onMounted(() => { void load(); });
</script>

<template>
  <header class="login-header">
    <h1>운영자 로그인</h1>
    <p class="meta">김고수 운영 콘솔 · 관리자 전용</p>
  </header>

  <main class="login" :aria-busy="loading || busy">
    <section class="card" aria-labelledby="intro-title">
      <h2 id="intro-title">로그인 후 운영자 세션이 발급됩니다</h2>
      <p>로그인 수단으로 본인 확인을 마치면 서버가 <code>role_grants</code>의 ADMIN 부여를 확인해 별도 운영자 세션을 발급합니다. 관리자 권한이 없는 계정은 서버가 거부하며, 콘솔 화면에는 아무 회원 정보도 표시되지 않습니다.</p>
      <p class="meta">서버가 발급한 토큰을 직접 붙여넣는 방식은 제거했습니다. 운영자 세션은 이 탭 메모리에만 보관되고, 새로고침하거나 만료되면 이 로그인 화면으로 돌아옵니다.</p>
    </section>

    <p v-if="loadError" class="notice error" role="alert">{{ loadError }} <button class="text" type="button" @click="load">다시 확인</button></p>
    <p v-else-if="loading" class="notice" role="status">로그인 수단을 확인하는 중입니다…</p>

    <template v-else>
      <section class="card" aria-labelledby="social-title">
        <h2 id="social-title">소셜 로그인</h2>
        <p v-if="connected.length === 0" class="notice" role="status">
          서버에 소셜 로그인 자격증명이 연결되어 있지 않아 지금은 사용할 수 없습니다(카카오·네이버·Google).
        </p>
        <div v-else class="providers">
          <button v-for="p in connected" :key="p.id" class="secondary" type="button" disabled>
            {{ providerLabel(p.id) }} 로그인 · 웹 콜백 인계 준비 중
          </button>
          <p class="meta">소셜 로그인 콜백을 이 콘솔로 되돌리는 웹 인계 경로가 아직 확정되지 않아, 연결된 제공자도 이 화면에서는 완료할 수 없습니다. 서버 응답을 성공으로 꾸미지 않습니다.</p>
        </div>
      </section>

      <section class="card" aria-labelledby="tester-title">
        <h2 id="tester-title">개발용 테스터 로그인</h2>
        <template v-if="accounts.length > 0">
          <p>개발 서버에 준비된 계정으로 실제 로그인합니다. 관리자 권한이 없는 계정을 고르면 서버가 403으로 거부합니다.</p>
          <form class="stack" @submit.prevent="submit">
            <fieldset>
              <legend>계정 선택</legend>
              <label v-for="a in accounts" :key="a.slot" class="account">
                <input type="radio" name="slot" :value="a.slot" :checked="selectedSlot === a.slot" @change="selectedSlot = a.slot">
                <span>{{ a.label }} · {{ a.nickname }}</span>
                <span class="badge">{{ a.role }}</span>
              </label>
            </fieldset>
            <p class="meta">5회 실패하면 이 브라우저의 로그인 시도가 5분간 잠기며, 실패와 잠금은 감사 로그에 기록됩니다.</p>
            <p v-if="error" role="alert" class="notice error">{{ error }}</p>
            <button class="primary" type="submit" :disabled="!canSubmit">{{ busy ? '로그인 중…' : '로그인' }}</button>
          </form>
        </template>
        <p v-else class="notice" role="status">이 서버는 테스터 로그인을 제공하지 않습니다(개발 환경 전용).</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
:global(body) { margin: 0; background: #f4f6f8; color: #172033; font-family: 'Pretendard Variable', Pretendard, system-ui, -apple-system, sans-serif; }
.login-header { display: flex; align-items: baseline; gap: 16px; padding: 20px 32px; background: #101a2b; color: #fff; flex-wrap: wrap; }
.login-header h1 { font-size: 20px; margin: 0; }
.login-header .meta { color: #9fb0c9; margin: 0; }
.login { max-width: 720px; margin: 0 auto; padding: 24px 32px 96px; }
.card { background: #fff; border: 1px solid #d8e0e8; border-radius: 14px; padding: 24px; margin-top: 20px; }
.card h2 { font-size: 17px; margin: 0 0 10px; }
.stack { display: grid; gap: 12px; }
fieldset { border: 1px solid #d8e0e8; border-radius: 10px; padding: 8px 14px 12px; margin: 0; }
legend { font-weight: 600; font-size: 14px; padding: 0 6px; }
.account { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-weight: 500; }
.account input { width: 18px; height: 18px; margin: 0; }
.badge { margin-left: auto; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #eef2f7; color: #44556d; }
.providers { display: grid; gap: 10px; }
button { font: inherit; cursor: pointer; border-radius: 8px; padding: 10px 16px; border: 1px solid transparent; }
button:disabled { opacity: .55; cursor: default; }
.primary { background: #1b53c8; color: #fff; justify-self: start; }
.secondary { background: #fff; border-color: #728197; }
.text { background: none; color: #1b53c8; padding: 4px 6px; text-decoration: underline; }
.meta { color: #5b6b80; font-size: 13px; }
.notice { background: #eef4ff; border: 1px solid #c9dafc; border-radius: 10px; padding: 12px 14px; margin-top: 12px; }
.notice.error, .error { background: #fdf1f0; border-color: #f2c6c1; color: #8f1d14; }
</style>
