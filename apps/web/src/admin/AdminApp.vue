<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { AdminApiError, createAdminApi, type AdminMemberRow, type MemberDetail, type MemberStatus } from './api';

const props = defineProps<{ baseUrl?: string }>();
const api = createAdminApi(props.baseUrl ?? (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'https://api-dev-kimgosu.mintech.ai');

// The token stays in component memory only: no Web Storage, cookie or URL.
const tokenInput = ref('');
const connected = ref(false);
const connectError = ref('');
const accessDenied = ref(false);

const rows = ref<AdminMemberRow[]>([]);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const query = ref('');
const statusFilter = ref<MemberStatus | ''>('');
const listLoading = ref(false);
const listLoaded = ref(false);
const listError = ref('');

const selectedId = ref<string | null>(null);
const detail = ref<MemberDetail>();
const detailLoading = ref(false);
const detailError = ref('');
const actionMessage = ref('');

const dialog = ref<HTMLDialogElement>();
const dialogType = ref<'restrict' | 'release'>('restrict');
const form = ref({ reason: '', endsAt: '' });
const submitting = ref(false);
const actionError = ref('');

const hasLiveRestriction = computed(() => detail.value?.restrictions.some(r => r.active) === true);
const title = computed(() => (detail.value ? `회원 상세 · ${detail.value.member.nickname}` : '회원 조회'));

function messageFor(e: unknown): string {
  if (!(e instanceof AdminApiError)) return '처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  switch (e.code) {
    case 'ADMIN_REQUIRED': return '관리자 권한이 없습니다. 서버가 ADMIN 역할 부여를 확인하지 못했습니다.';
    case 'AUTH_REQUIRED':
    case 'SESSION_INVALID': return '세션이 만료됐거나 유효하지 않습니다. 운영자 세션으로 다시 접속해주세요.';
    case 'MEMBER_NOT_FOUND': return '회원을 찾을 수 없습니다.';
    case 'MEMBER_WITHDRAWN': return '탈퇴한 회원은 제재할 수 없습니다.';
    case 'ALREADY_RESTRICTED': return '이미 유효한 이용 제한이 있습니다. 해제 후 다시 제재할 수 있습니다.';
    case 'NOT_RESTRICTED': return '해제할 유효한 이용 제한이 없습니다.';
    case 'INVALID_TOKEN': return '세션 토큰 형식이 올바르지 않습니다.';
    case 'TIMEOUT': return '응답 시간이 초과됐습니다. 처리 결과가 불확실하므로 목록을 다시 조회해 확인해주세요.';
    case 'NETWORK_ERROR': return '서버에 연결하지 못했습니다. 네트워크와 배포 상태를 확인해주세요.';
    default: return '요청을 처리하지 못했습니다. 목록을 다시 조회해 현재 상태를 확인해주세요.';
  }
}

function resetSession() {
  api.clearToken();
  connected.value = false;
  tokenInput.value = '';
  rows.value = []; listLoaded.value = false; detail.value = undefined; selectedId.value = null;
}

async function connect() {
  connectError.value = ''; accessDenied.value = false;
  try { api.setToken(tokenInput.value.trim()); }
  catch (e) { connectError.value = messageFor(e); return; }
  tokenInput.value = '';
  connected.value = true;
  await loadList(1);
}

async function loadList(target = page.value) {
  if (!api.hasToken()) return;
  listLoading.value = true; listError.value = ''; listLoaded.value = false;
  try {
    const result = await api.members({ query: query.value, status: statusFilter.value, page: target, limit: 20 });
    rows.value = result.members;
    page.value = result.page;
    totalPages.value = result.totalPages;
    total.value = result.total;
    listLoaded.value = true;
  } catch (e) {
    listLoaded.value = false; rows.value = [];
    if (e instanceof AdminApiError && e.code === 'ADMIN_REQUIRED') { accessDenied.value = true; resetSession(); return; }
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { resetSession(); }
    listError.value = messageFor(e);
  } finally { listLoading.value = false; }
}

async function search() { await loadList(1); }

async function loadDetail(id: string, keepMessage = false) {
  detailLoading.value = true; detailError.value = ''; detail.value = undefined; selectedId.value = id;
  if (!keepMessage) actionMessage.value = '';
  try {
    detail.value = await api.member(id);
  } catch (e) {
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) resetSession();
    detailError.value = messageFor(e);
  } finally { detailLoading.value = false; }
}

function backToList() { selectedId.value = null; detail.value = undefined; detailError.value = ''; actionMessage.value = ''; }
async function retryDetail() { if (selectedId.value) await loadDetail(selectedId.value); }

async function openDialog(type: 'restrict' | 'release', event: Event) {
  dialogType.value = type;
  form.value = { reason: '', endsAt: '' };
  actionError.value = '';
  void event;
  await nextTick();
  dialog.value?.showModal();
}
function closeDialog() { if (!submitting.value) dialog.value?.close(); }

const canSubmit = computed(() => form.value.reason.trim().length >= 2 && !submitting.value);

async function submitAction() {
  if (!detail.value || !canSubmit.value) return;
  const id = detail.value.member.id;
  submitting.value = true; actionError.value = '';
  try {
    if (dialogType.value === 'restrict') {
      const endsAt = form.value.endsAt ? new Date(form.value.endsAt).toISOString() : undefined;
      await api.restrict(id, { reason: form.value.reason.trim(), ...(endsAt ? { endsAt } : {}) });
      actionMessage.value = '이용 제한을 등록했습니다. 서버에서 이력과 감사 로그를 다시 조회합니다.';
    } else {
      await api.release(id, form.value.reason.trim());
      actionMessage.value = '이용 제한을 해제했습니다. 이력은 삭제되지 않고 남습니다.';
    }
    dialog.value?.close();
    // Re-read from the server: the local view never assumes the write landed.
    // The confirmation message survives this refresh (keepMessage).
    await Promise.all([loadDetail(id, true), loadList(page.value)]);
  } catch (e) {
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { resetSession(); return; }
    actionError.value = messageFor(e);
  } finally { submitting.value = false; }
}

onBeforeUnmount(() => { resetSession(); api.clearToken(); });

const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value)) + ' KST'
  : '—';
const statusLabel = (value: MemberStatus) => value === 'ACTIVE' ? '이용 가능' : value === 'RESTRICTED' ? '이용 제한' : '탈퇴';
</script>

<template>
  <header class="console-header">
    <h1>김고수 운영 콘솔</h1>
    <p class="meta">회원·원장 조회와 이용 제한 — 관리자 전용</p>
    <button v-if="connected" class="text" type="button" @click="resetSession">세션 해제</button>
  </header>

  <main class="console" :aria-busy="listLoading || detailLoading || submitting">
    <section v-if="!connected" class="card" aria-labelledby="connect-title">
      <h2 id="connect-title">운영자 세션 연결</h2>
      <p>서버가 발급한 운영자 세션 토큰을 입력하세요. 토큰은 이 화면 메모리에만 보관하며 브라우저 저장소·URL·로그에 남기지 않습니다. 새로고침하면 다시 입력해야 합니다.</p>
      <p class="notice">관리자 역할은 서버가 <code>role_grants</code>로 판정합니다. 권한이 없으면 모든 조회·제재가 403으로 거부됩니다.</p>
      <form class="stack" @submit.prevent="connect">
        <label for="token">운영자 세션 토큰</label>
        <input id="token" v-model="tokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="Bearer 없이 토큰 값만 입력">
        <p v-if="connectError" role="alert" class="error">{{ connectError }}</p>
        <button class="primary" type="submit" :disabled="tokenInput.trim().length < 32">연결</button>
      </form>
    </section>

    <section v-else-if="accessDenied" class="card" role="alert">
      <h2>관리자 권한이 없습니다</h2>
      <p>이 계정에는 유효한 ADMIN 역할 부여가 없습니다. CS 등 다른 역할로는 이 콘솔을 사용할 수 없습니다. 권한 부여는 별도 승인 절차가 필요합니다.</p>
    </section>

    <template v-else>
      <nav class="toolbar" aria-label="회원 검색">
        <form class="search" @submit.prevent="search">
          <label for="query">검색어</label>
          <input id="query" v-model="query" type="search" maxlength="100" placeholder="이름·닉네임·이메일·고객번호">
          <label for="status">계정 상태</label>
          <select id="status" v-model="statusFilter">
            <option value="">전체</option>
            <option value="ACTIVE">이용 가능</option>
            <option value="RESTRICTED">이용 제한</option>
            <option value="WITHDRAWN">탈퇴</option>
          </select>
          <button class="primary" type="submit" :disabled="listLoading">검색</button>
        </form>
        <p class="meta">총 {{ total }}명 · {{ page }}/{{ totalPages }} 페이지</p>
      </nav>

      <p v-if="listError" class="notice error" role="alert">{{ listError }} <button class="text" type="button" @click="loadList(page)">다시 조회</button></p>
      <p v-else-if="listLoading" class="notice" role="status">회원 목록을 불러오는 중입니다…</p>
      <p v-else-if="listLoaded && rows.length === 0" class="notice">조건에 맞는 회원이 없습니다.</p>

      <table v-if="rows.length" class="members">
        <caption class="sr-only">회원 목록</caption>
        <thead><tr><th scope="col">고객번호</th><th scope="col">이름</th><th scope="col">닉네임</th><th scope="col">이메일</th><th scope="col">상태</th><th scope="col">가입일</th><th scope="col">상세</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" :class="{ selected: row.id === selectedId }">
            <td>{{ row.customerNumber }}</td>
            <td>{{ row.name }}</td>
            <td>{{ row.nickname }}</td>
            <td>{{ row.emailMasked ?? '—' }}</td>
            <td><span class="badge" :class="row.status.toLowerCase()">{{ statusLabel(row.status) }}</span><span v-if="row.expertActive" class="badge expert">고수</span></td>
            <td>{{ date(row.createdAt) }}</td>
            <td><button class="text" type="button" :aria-label="row.nickname + ' 상세 보기'" @click="loadDetail(row.id)">보기</button></td>
          </tr>
        </tbody>
      </table>

      <p class="pagination" v-if="rows.length">
        <button class="secondary" type="button" :disabled="page <= 1 || listLoading" @click="loadList(page - 1)">이전</button>
        <span>{{ page }} / {{ totalPages }}</span>
        <button class="secondary" type="button" :disabled="page >= totalPages || listLoading" @click="loadList(page + 1)">다음</button>
      </p>
      <p class="meta">전화번호는 서버에 원문이 저장되지 않고(해시만 보관) 목록에도 표시하지 않습니다.</p>

      <section v-if="selectedId" class="card detail" aria-labelledby="detail-title">
        <div class="detail-head">
          <div>
            <h2 id="detail-title">{{ title }}</h2>
            <p class="meta">회원 ID {{ selectedId }}</p>
          </div>
          <div class="actions">
            <button class="primary danger" type="button" :disabled="detailLoading || !!detailError || hasLiveRestriction" @click="openDialog('restrict', $event)">이용 제한</button>
            <button class="secondary" type="button" :disabled="detailLoading || !!detailError || !hasLiveRestriction" @click="openDialog('release', $event)">제한 해제</button>
            <button class="text" type="button" @click="backToList">목록으로</button>
          </div>
        </div>

        <p v-if="actionMessage" class="notice success" role="status">{{ actionMessage }}</p>
        <p v-if="detailError" class="notice error" role="alert">{{ detailError }} <button class="text" type="button" @click="retryDetail">다시 조회</button></p>
        <p v-else-if="detailLoading" class="notice" role="status">회원 상세를 불러오는 중입니다…</p>

        <template v-else-if="detail">
          <dl class="facts">
            <div><dt>고객번호</dt><dd>{{ detail.member.customerNumber }}</dd></div>
            <div><dt>닉네임</dt><dd>{{ detail.member.nickname }}</dd></div>
            <div><dt>이름</dt><dd>{{ detail.member.name }}</dd></div>
            <div><dt>이메일</dt><dd>{{ detail.member.email ?? '—' }}</dd></div>
            <div><dt>계정 상태</dt><dd>{{ statusLabel(detail.member.status) }}</dd></div>
            <div><dt>고수 여부</dt><dd>{{ detail.member.expertActive ? '고수' : '일반' }}</dd></div>
            <div><dt>가입일</dt><dd>{{ date(detail.member.createdAt) }}</dd></div>
            <div><dt>탈퇴일</dt><dd>{{ date(detail.member.withdrawnAt) }}</dd></div>
          </dl>

          <h3>동의 이력</h3>
          <p v-if="detail.consents.length === 0" class="meta">기록된 동의 이력이 없습니다.</p>
          <ol v-else class="history">
            <li v-for="c in detail.consents" :key="c.kind + c.recordedAt">
              <strong>{{ c.title }}</strong> · {{ c.version }} · {{ c.status === 'GRANTED' ? '동의' : '철회' }} · {{ date(c.recordedAt) }}
            </li>
          </ol>

          <h3>원장</h3>
          <p v-if="detail.ledgers.length === 0" class="meta">참여 중인 원장이 없습니다.</p>
          <table v-else class="members">
            <caption class="sr-only">회원이 참여한 원장</caption>
            <thead><tr><th scope="col">역할</th><th scope="col">상대</th><th scope="col">최근 갱신</th><th scope="col">합의</th></tr></thead>
            <tbody>
              <tr v-for="l in detail.ledgers" :key="l.id">
                <td>{{ l.role === 'EXPERT' ? '고수' : '고객' }}</td>
                <td>{{ l.counterpartNickname }} <span class="meta">#{{ l.counterpartNumber }}</span></td>
                <td>{{ date(l.updatedAt) }}</td>
                <td>{{ l.completedAgreements }} / {{ l.agreementCount }} 완료</td>
              </tr>
            </tbody>
          </table>

          <h3>제재 이력</h3>
          <p v-if="detail.restrictions.length === 0" class="meta">제재 이력이 없습니다.</p>
          <ol v-else class="history">
            <li v-for="r in detail.restrictions" :key="r.id">
              <span class="badge" :class="r.active ? 'restricted' : 'withdrawn'">{{ r.active ? '유효' : '해제·종료' }}</span>
              {{ r.reason }} · 시작 {{ date(r.startsAt) }} · 종료 {{ r.endsAt ? date(r.endsAt) : '기한 없음' }} · 해제 {{ date(r.revokedAt) }}
              <span v-if="r.releaseReason" class="meta">· 해제 사유: {{ r.releaseReason }}</span>
            </li>
          </ol>
          <p class="meta">해제 사유는 감사 로그(audit_log)에 운영자와 함께 기록됩니다.</p>
        </template>
      </section>
    </template>
  </main>

  <dialog ref="dialog" aria-labelledby="dialog-title" @close="actionError = ''">
    <form method="dialog" class="stack" @submit.prevent="submitAction">
      <h2 id="dialog-title">{{ dialogType === 'restrict' ? '이용 제한 등록' : '이용 제한 해제' }}</h2>
      <p v-if="dialogType === 'restrict'">사유와 기간은 서버에 기록되며 감사 로그에 운영자와 함께 남습니다. 기간을 비우면 무기한입니다.</p>
      <p v-else>해제 후에도 제재 이력은 삭제되지 않고 이력으로 남습니다.</p>
      <label for="reason">사유 <span class="required">필수</span></label>
      <textarea id="reason" v-model="form.reason" rows="3" maxlength="500" required></textarea>
      <p class="meta">{{ [...form.reason].length }}/500</p>
      <template v-if="dialogType === 'restrict'">
        <label for="endsAt">종료 시각 <span class="meta">선택</span></label>
        <input id="endsAt" v-model="form.endsAt" type="datetime-local">
      </template>
      <p v-if="actionError" role="alert" class="error">{{ actionError }}</p>
      <div class="actions">
        <button class="primary" type="submit" :disabled="!canSubmit">{{ submitting ? '처리 중…' : '확인' }}</button>
        <button class="secondary" type="button" :disabled="submitting" @click="closeDialog">취소</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
:global(body) { margin: 0; background: #f4f6f8; color: #172033; font-family: 'Pretendard', system-ui, -apple-system, sans-serif; }
.console-header { display: flex; align-items: baseline; gap: 16px; padding: 20px 32px; background: #101a2b; color: #fff; }
.console-header h1 { font-size: 20px; margin: 0; }
.console-header .meta { color: #9fb0c9; margin: 0; }
.console { max-width: 1120px; margin: 0 auto; padding: 24px 32px 96px; }
.card { background: #fff; border: 1px solid #d8e0e8; border-radius: 14px; padding: 24px; margin-top: 20px; }
.stack { display: grid; gap: 10px; }
label { font-weight: 600; font-size: 14px; }
input, select, textarea { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid #728197; border-radius: 8px; font: inherit; }
button { font: inherit; cursor: pointer; border-radius: 8px; padding: 9px 16px; border: 1px solid transparent; }
button:disabled { opacity: .5; cursor: default; }
.primary { background: #1b53c8; color: #fff; }
.primary.danger { background: #b42318; }
.secondary { background: #fff; border-color: #728197; }
.text { background: none; color: #1b53c8; padding: 4px 6px; text-decoration: underline; }
.console-header .text { color: #cfe0ff; }
.toolbar { margin-top: 16px; }
.search { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.search label { flex-basis: 100%; }
.search input { flex: 1 1 240px; width: auto; }
.search select { width: auto; }
.meta { color: #5b6b80; font-size: 13px; }
.notice { background: #eef4ff; border: 1px solid #c9dafc; border-radius: 10px; padding: 12px 14px; }
.notice.error, .error { background: #fdf1f0; border-color: #f2c6c1; color: #8f1d14; }
.notice.success { background: #eefaf2; border-color: #bfe6cd; color: #17603a; }
.members { width: 100%; border-collapse: collapse; margin-top: 16px; background: #fff; border: 1px solid #d8e0e8; border-radius: 12px; overflow: hidden; }
.members th, .members td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e6ecf2; font-size: 14px; }
.members thead th { background: #f7f9fc; font-size: 13px; color: #44556d; }
.members tr.selected { background: #eef4ff; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #eef2f7; margin-right: 4px; }
.badge.active { background: #e6f6ec; color: #17603a; }
.badge.restricted { background: #fdeceb; color: #8f1d14; }
.badge.withdrawn { background: #eef2f7; color: #5b6b80; }
.badge.expert { background: #eef1ff; color: #2b2f8f; }
.pagination { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.detail-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: start; }
.detail-head h2 { margin: 0 0 4px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }
.facts dt { font-size: 12px; color: #5b6b80; }
.facts dd { margin: 2px 0 0; font-weight: 600; }
.history { padding-left: 18px; line-height: 1.9; }
h3 { margin-top: 28px; font-size: 16px; }
dialog { border: 0; border-radius: 14px; padding: 24px; max-width: 460px; width: 92%; }
dialog::backdrop { background: rgba(16, 26, 43, .45); }
.required { color: #b42318; font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
