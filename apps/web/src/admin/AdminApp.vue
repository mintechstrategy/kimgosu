<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { AdminApiError, type AdminApi, type AdminMemberRow, type AdminOperator, type MemberDetail, type MemberStatus, type ReviewRow, type Stats } from './api';

const props = defineProps<{ api: AdminApi; operator?: AdminOperator }>();
const emit = defineEmits<{ 'logged-out': []; 'session-expired': [message: string] }>();

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
const signingOut = ref(false);
/** 403 on any operator route: the session is valid but carries no ADMIN grant. */
const forbidden = ref(false);

const dialog = ref<HTMLDialogElement>();
const dialogType = ref<'restrict' | 'release'>('restrict');
const form = ref({ reason: '', endsAt: '' });
const submitting = ref(false);
const actionError = ref('');

/** 두 화면: 회원 관리, 리뷰 관리. 화면 상태는 각자 유지한다. */
const tab = ref<'dashboard' | 'members' | 'reviews'>('members');

/**
 * 대시보드(WS-72). 숫자는 전부 서버 집계값이고, 화면은 막대 길이만 그린다.
 * 기간을 비우면 서버 기본값(최근 7일)을 쓰고, 응답의 from/to를 입력칸에 되돌려 표시한다.
 */
const stats = ref<Stats>();
const statsFrom = ref('');
const statsTo = ref('');
const statsLoading = ref(false);
const statsError = ref('');

const statsEmpty = computed(() => {
  const totals = stats.value?.totals;
  return totals !== undefined && totals.trades === 0 && totals.reports === 0 && totals.newMembers === 0;
});
// 막대 길이를 정하기 위한 표시용 비율. 집계값 자체는 서버 값을 그대로 쓴다.
const trendPeak = computed(() => Math.max(1, ...(stats.value?.daily.map(day => day.trades) ?? [])));
const barWidth = (value: number) => `${Math.round((value / trendPeak.value) * 100)}%`;

async function loadStats() {
  if (!api.hasSession()) { emit('session-expired', '세션이 없습니다. 다시 로그인해주세요.'); return; }
  statsLoading.value = true; statsError.value = '';
  try {
    const result = await api.stats({ from: statsFrom.value || undefined, to: statsTo.value || undefined });
    stats.value = result;
    statsFrom.value = result.from;
    statsTo.value = result.to;
    forbidden.value = false;
  } catch (e) {
    stats.value = undefined;
    if (isForbidden(e)) { denyAccess(); return; }
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { endSession(e); return; }
    statsError.value = messageFor(e);
  } finally { statsLoading.value = false; }
}

function showDashboard() {
  tab.value = 'dashboard';
  if (!stats.value) void loadStats();
}

const REVIEW_PAGE_SIZE = 50;
const reviews = ref<ReviewRow[]>([]);
const reviewPage = ref(1);
const reviewTotal = ref(0);
const reviewLoading = ref(false);
const reviewLoaded = ref(false);
const reviewError = ref('');
const reviewMessage = ref('');
const reviewDialog = ref<HTMLDialogElement>();
const reviewTarget = ref<ReviewRow>();
const reviewAction = ref<'hide' | 'unhide'>('hide');
const reviewReason = ref('');
const reviewSubmitting = ref(false);
const reviewActionError = ref('');

const api = props.api;
const hasLiveRestriction = computed(() => detail.value?.restrictions.some(r => r.active) === true);
const title = computed(() => (detail.value ? `회원 상세 · ${detail.value.member.nickname}` : '회원 조회'));

function messageFor(e: unknown): string {
  if (!(e instanceof AdminApiError)) return '처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  switch (e.code) {
    case 'ADMIN_REQUIRED': return '관리자 권한이 없습니다. 서버가 ADMIN 역할 부여를 확인하지 못했습니다.';
    case 'ADMIN_SESSION_REQUIRED': return '운영자 세션이 아닙니다. 로그인 화면에서 다시 로그인해주세요.';
    case 'AUTH_REQUIRED':
    case 'SESSION_INVALID': return '세션이 만료됐거나 유효하지 않습니다. 다시 로그인해주세요.';
    case 'MEMBER_NOT_FOUND': return '회원을 찾을 수 없습니다.';
    case 'MEMBER_WITHDRAWN': return '탈퇴한 회원은 제재할 수 없습니다.';
    case 'ALREADY_RESTRICTED': return '이미 유효한 이용 제한이 있습니다. 해제 후 다시 제재할 수 있습니다.';
    case 'NOT_RESTRICTED': return '해제할 유효한 이용 제한이 없습니다.';
    case 'TIMEOUT': return '응답 시간이 초과됐습니다. 처리 결과가 불확실하므로 목록을 다시 조회해 확인해주세요.';
    case 'NETWORK_ERROR': return '서버에 연결하지 못했습니다. 네트워크와 배포 상태를 확인해주세요.';
    default: return '요청을 처리하지 못했습니다. 목록을 다시 조회해 현재 상태를 확인해주세요.';
  }
}

/** 403 from an operator route: keep the session, show the no-permission panel. */
function isForbidden(e: unknown) {
  return e instanceof AdminApiError && (e.code === 'ADMIN_REQUIRED' || e.code === 'ADMIN_SESSION_REQUIRED');
}

function denyAccess() {
  forbidden.value = true;
  dialog.value?.close();
  reviewDialog.value?.close();
  actionError.value = '';
  reviewActionError.value = '';
}

/** Session gone (expired or revoked): back to login. A 403 never gets here. */
function endSession(e: unknown) {
  api.clearSession();
  rows.value = []; listLoaded.value = false; detail.value = undefined; selectedId.value = null;
  emit('session-expired', messageFor(e));
}

async function loadList(target = page.value) {
  if (!api.hasSession()) { emit('session-expired', '세션이 없습니다. 다시 로그인해주세요.'); return; }
  listLoading.value = true; listError.value = ''; listLoaded.value = false;
  try {
    const result = await api.members({ query: query.value, status: statusFilter.value, page: target, limit: 20 });
    rows.value = result.members;
    page.value = result.page;
    totalPages.value = result.totalPages;
    total.value = result.total;
    listLoaded.value = true;
    forbidden.value = false;
  } catch (e) {
    listLoaded.value = false; rows.value = [];
    if (isForbidden(e)) { denyAccess(); return; }
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { endSession(e); return; }
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
    if (isForbidden(e)) { denyAccess(); return; }
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { endSession(e); return; }
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
    if (isForbidden(e)) { denyAccess(); return; }
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { endSession(e); return; }
    actionError.value = messageFor(e);
  } finally { submitting.value = false; }
}

async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  try { await api.logout(); } finally {
    signingOut.value = false;
    rows.value = []; detail.value = undefined; selectedId.value = null;
    emit('logged-out');
  }
}

function reviewMessageFor(e: unknown): string {
  if (!(e instanceof AdminApiError)) return '처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  switch (e.code) {
    case 'ADMIN_REQUIRED':
    case 'ADMIN_SESSION_REQUIRED': return '권한이 없습니다. 이 화면은 ADMIN 역할이 부여된 운영자 세션에서만 사용할 수 있습니다.';
    case 'AUTH_REQUIRED':
    case 'SESSION_INVALID': return '세션이 만료됐거나 유효하지 않습니다. 다시 로그인해주세요.';
    // 숨김·해제 사유는 필수다. 비우면 클라이언트가 채우지 않고 서버 400을 그대로 보여준다.
    case 'INVALID_REQUEST': return '서버가 400 INVALID_REQUEST로 거부했습니다. 사유는 2자 이상 입력해야 합니다.';
    case 'REVIEW_NOT_FOUND': return '리뷰를 찾을 수 없습니다. 목록을 다시 조회해주세요.';
    case 'REVIEW_ALREADY_HIDDEN': return '이미 숨김 처리된 리뷰입니다. 목록을 다시 조회해주세요.';
    case 'REVIEW_NOT_HIDDEN': return '숨김 상태가 아닙니다. 목록을 다시 조회해주세요.';
    case 'TIMEOUT': return '응답 시간이 초과됐습니다. 처리 결과가 불확실하므로 목록을 다시 조회해 확인해주세요.';
    case 'NETWORK_ERROR': return '서버에 연결하지 못했습니다. 네트워크와 배포 상태를 확인해주세요.';
    default: return `요청을 처리하지 못했습니다(HTTP ${e.status}). 목록을 다시 조회해 현재 상태를 확인해주세요.`;
  }
}

async function loadReviews(target = reviewPage.value) {
  if (!api.hasSession()) { emit('session-expired', '세션이 없습니다. 다시 로그인해주세요.'); return; }
  reviewLoading.value = true; reviewError.value = ''; reviewLoaded.value = false;
  try {
    const result = await api.reviews({ limit: REVIEW_PAGE_SIZE, offset: (target - 1) * REVIEW_PAGE_SIZE });
    reviews.value = result.reviews;
    reviewTotal.value = result.total;
    reviewPage.value = target;
    reviewLoaded.value = true;
    forbidden.value = false;
  } catch (e) {
    reviewLoaded.value = false; reviews.value = [];
    if (isForbidden(e)) { denyAccess(); return; }
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { endSession(e); return; }
    reviewError.value = reviewMessageFor(e);
  } finally { reviewLoading.value = false; }
}

const reviewPages = computed(() => Math.max(1, Math.ceil(reviewTotal.value / REVIEW_PAGE_SIZE)));

function showReviews() {
  tab.value = 'reviews';
  if (!reviewLoaded.value) void loadReviews(1);
}

async function openReviewDialog(row: ReviewRow, action: 'hide' | 'unhide', event: Event) {
  reviewTarget.value = row;
  reviewAction.value = action;
  reviewReason.value = '';
  reviewActionError.value = '';
  void event;
  await nextTick();
  reviewDialog.value?.showModal();
}
function closeReviewDialog() { if (!reviewSubmitting.value) reviewDialog.value?.close(); }

async function submitReviewAction() {
  if (!reviewTarget.value || reviewSubmitting.value) return;
  const id = reviewTarget.value.id;
  const reason = reviewReason.value.trim();
  reviewSubmitting.value = true; reviewActionError.value = '';
  try {
    if (reviewAction.value === 'hide') await api.hideReview(id, reason);
    else await api.unhideReview(id, reason);
    reviewDialog.value?.close();
    reviewMessage.value = reviewAction.value === 'hide'
      ? '리뷰를 숨겼습니다. 공개 목록에서 빠지는지 서버 목록을 다시 조회합니다.'
      : '숨김을 해제했습니다. 공개 목록에 다시 노출됩니다.';
    await loadReviews(reviewPage.value);
  } catch (e) {
    if (isForbidden(e)) { denyAccess(); return; }
    if (e instanceof AdminApiError && ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(e.code)) { endSession(e); return; }
    reviewActionError.value = reviewMessageFor(e);
  } finally { reviewSubmitting.value = false; }
}

onMounted(() => { void loadList(1); });
onBeforeUnmount(() => { api.clearSession(); });

const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value)) + ' KST'
  : '—';
const statusLabel = (value: MemberStatus) => value === 'ACTIVE' ? '이용 가능' : value === 'RESTRICTED' ? '이용 제한' : '탈퇴';
</script>

<template>
  <header class="console-header">
    <h1>김고수 운영 콘솔</h1>
    <p class="meta">회원 조회·이용 제한, 리뷰 숨김 — 관리자 전용</p>
    <p class="who" v-if="operator">{{ operator.nickname }} · #{{ operator.customerNumber }}</p>
    <button class="text" type="button" :disabled="signingOut" @click="signOut">{{ signingOut ? '로그아웃 중…' : '로그아웃' }}</button>
  </header>

  <section v-if="forbidden" class="forbidden" role="alert">
    <h2>권한이 없습니다</h2>
    <p>이 계정에는 유효한 관리자(ADMIN) 역할이 없습니다. 운영 콘솔은 ADMIN만 사용할 수 있습니다. 다시 조회해도 결과가 달라지지 않으므로 다른 계정으로 로그인해주세요.</p>
    <button class="secondary" type="button" @click="signOut">로그인 화면으로</button>
  </section>

  <template v-else>
  <nav class="tabs" aria-label="운영 콘솔 화면">
    <button type="button" :class="{ active: tab === 'dashboard' }" :aria-current="tab === 'dashboard' ? 'page' : undefined" @click="showDashboard">대시보드</button>
    <button type="button" :class="{ active: tab === 'members' }" :aria-current="tab === 'members' ? 'page' : undefined" @click="tab = 'members'">회원 관리</button>
    <button type="button" :class="{ active: tab === 'reviews' }" :aria-current="tab === 'reviews' ? 'page' : undefined" @click="showReviews">리뷰 관리</button>
  </nav>

  <main class="console" :aria-busy="listLoading || detailLoading || submitting || reviewLoading || reviewSubmitting || statsLoading">
    <template v-if="tab === 'dashboard'">
      <form class="range" aria-label="집계 기간" @submit.prevent="loadStats">
        <label for="stats-from">시작일</label>
        <input id="stats-from" v-model="statsFrom" type="date" :max="statsTo || undefined">
        <label for="stats-to">종료일</label>
        <input id="stats-to" v-model="statsTo" type="date" :min="statsFrom || undefined">
        <button class="primary" type="submit" :disabled="statsLoading">{{ statsLoading ? '조회 중…' : '적용' }}</button>
      </form>

      <p v-if="statsError" class="notice error" role="alert">{{ statsError }} <button class="text" type="button" @click="loadStats">다시 조회</button></p>
      <p v-else-if="statsLoading && !stats" class="notice" role="status">지표를 불러오는 중입니다…</p>

      <template v-else-if="stats">
        <p class="meta">{{ stats.from }} ~ {{ stats.to }} (KST, 종료일 포함) · 서버가 집계한 값이며 화면에서 다시 계산하지 않습니다.</p>
        <div class="metrics">
          <div class="metric"><span class="metric-label">거래 수</span><strong>{{ stats.totals.trades }}</strong><span class="meta">기간 내 합의 요청</span></div>
          <div class="metric"><span class="metric-label">완료율</span><strong>{{ stats.totals.completionRate }}%</strong><span class="meta">완료 {{ stats.totals.completed }}건</span></div>
          <div class="metric"><span class="metric-label">신고 수</span><strong>{{ stats.totals.reports }}</strong><span class="meta">접수된 신고</span></div>
          <div class="metric"><span class="metric-label">신규 회원</span><strong>{{ stats.totals.newMembers }}</strong><span class="meta">기간 내 가입</span></div>
        </div>

        <h2 class="trend-title">최근 7일 추이 · 거래 수</h2>
        <p v-if="statsEmpty" class="notice">선택한 기간에 거래·신고·신규 회원이 없습니다.</p>
        <ol v-else class="trend" aria-label="일자별 거래 수">
          <li v-for="day in stats.daily" :key="day.date">
            <span class="trend-date">{{ day.date.slice(5) }}</span>
            <span class="trend-track">
              <span class="trend-bar" :style="{ width: barWidth(day.trades) }"></span>
            </span>
            <span class="trend-value">{{ day.trades }}</span>
            <span class="meta trend-extra">완료 {{ day.completed }} · 신고 {{ day.reports }} · 신규 {{ day.newMembers }}</span>
          </li>
        </ol>
        <p class="meta">막대 길이는 표시 비율일 뿐이며, 값은 모두 서버 응답의 daily 값입니다.</p>
      </template>
    </template>

    <template v-else-if="tab === 'members'">
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

    <template v-else>
      <p class="meta">총 {{ reviewTotal }}개 · 공개·숨김 리뷰를 모두 표시합니다. 숨김은 삭제가 아니라 공개 목록에서 제외하는 처리입니다.</p>
      <p v-if="reviewMessage" class="notice success" role="status">{{ reviewMessage }}</p>
      <p v-if="reviewError" class="notice error" role="alert">{{ reviewError }} <button class="text" type="button" @click="loadReviews(reviewPage)">다시 조회</button></p>
      <p v-else-if="reviewLoading" class="notice" role="status">리뷰 목록을 불러오는 중입니다…</p>
      <p v-else-if="reviewLoaded && reviews.length === 0" class="notice">등록된 리뷰가 없습니다.</p>

      <table v-if="reviews.length" class="members">
        <caption class="sr-only">리뷰 목록</caption>
        <thead><tr><th scope="col">작성자</th><th scope="col">별점</th><th scope="col">내용</th><th scope="col">작성일</th><th scope="col">상태</th><th scope="col">처리</th></tr></thead>
        <tbody>
          <tr v-for="r in reviews" :key="r.id">
            <td>{{ r.authorNickname }}</td>
            <td>{{ r.rating }} / 5</td>
            <td class="body">{{ r.body ?? '—' }}</td>
            <td>{{ date(r.createdAt) }}</td>
            <td>
              <span class="badge" :class="r.hiddenAt ? 'restricted' : 'active'">{{ r.hiddenAt ? '숨김' : '공개' }}</span>
              <span v-if="r.hiddenAt && r.hiddenReason" class="meta">사유: {{ r.hiddenReason }}</span>
            </td>
            <td>
              <button v-if="!r.hiddenAt" class="text" type="button" :aria-label="r.authorNickname + ' 리뷰 숨김'" @click="openReviewDialog(r, 'hide', $event)">숨김</button>
              <button v-else class="text" type="button" :aria-label="r.authorNickname + ' 리뷰 숨김 해제'" @click="openReviewDialog(r, 'unhide', $event)">숨김 해제</button>
            </td>
          </tr>
        </tbody>
      </table>

      <p class="pagination" v-if="reviews.length">
        <button class="secondary" type="button" :disabled="reviewPage <= 1 || reviewLoading" @click="loadReviews(reviewPage - 1)">이전</button>
        <span>{{ reviewPage }} / {{ reviewPages }}</span>
        <button class="secondary" type="button" :disabled="reviewPage >= reviewPages || reviewLoading" @click="loadReviews(reviewPage + 1)">다음</button>
      </p>
      <p class="meta">숨김 사유는 감사 로그(audit_log)에 운영자와 함께 기록되며 리뷰 본문은 기록하지 않습니다.</p>
    </template>
  </main>
  </template>

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

  <dialog ref="reviewDialog" aria-labelledby="review-dialog-title" @close="reviewActionError = ''">
    <form method="dialog" class="stack" @submit.prevent="submitReviewAction">
      <h2 id="review-dialog-title">{{ reviewAction === 'hide' ? '리뷰 숨김' : '숨김 해제' }}</h2>
      <p v-if="reviewTarget" class="meta">{{ reviewTarget.authorNickname }} · 별점 {{ reviewTarget.rating }}/5 · {{ date(reviewTarget.createdAt) }}</p>
      <p>{{ reviewAction === 'hide' ? '숨긴 리뷰는 공개 목록에서 빠지며 삭제되지 않습니다.' : '숨김을 해제하면 공개 목록에 다시 노출됩니다.' }}</p>
      <label for="review-reason">사유 <span class="required">필수</span></label>
      <textarea id="review-reason" v-model="reviewReason" rows="3" maxlength="500"></textarea>
      <p class="meta">{{ [...reviewReason].length }}/500 · 2자 이상이어야 하며, 비우면 서버가 400으로 거부합니다.</p>
      <p v-if="reviewActionError" role="alert" class="error">{{ reviewActionError }}</p>
      <div class="actions">
        <button class="primary" type="submit" :disabled="reviewSubmitting">{{ reviewSubmitting ? '처리 중…' : '확인' }}</button>
        <button class="secondary" type="button" :disabled="reviewSubmitting" @click="closeReviewDialog">취소</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
:global(body) { margin: 0; background: #f4f6f8; color: #172033; font-family: 'Pretendard Variable', Pretendard, system-ui, -apple-system, sans-serif; }
.console-header { display: flex; align-items: baseline; gap: 16px; padding: 20px 32px; background: #101a2b; color: #fff; flex-wrap: wrap; }
.console-header h1 { font-size: 20px; margin: 0; }
.console-header .meta { color: #9fb0c9; margin: 0; }
.console-header .who { margin: 0 0 0 auto; font-size: 14px; color: #cfe0ff; }
.console { max-width: 1120px; margin: 0 auto; padding: 24px 32px 96px; }
.forbidden { max-width: 1120px; margin: 24px auto 0; padding: 24px; background: #fff; border: 1px solid #f2c6c1; border-left: 6px solid #b42318; border-radius: 14px; box-sizing: border-box; }
.forbidden h2 { margin: 0 0 8px; font-size: 18px; color: #8f1d14; }
.forbidden p { margin: 0 0 16px; }
.tabs { display: flex; gap: 8px; max-width: 1120px; margin: 0 auto; padding: 16px 32px 0; }
.tabs button { background: #fff; border-color: #d8e0e8; color: #44556d; }
.tabs button.active { background: #1b53c8; border-color: #1b53c8; color: #fff; }
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
.members th, .members td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e6ecf2; font-size: 14px; vertical-align: top; }
.members td.body { max-width: 360px; white-space: pre-wrap; overflow-wrap: anywhere; }
.members thead th { background: #f7f9fc; font-size: 13px; color: #44556d; }
.members tr.selected { background: #eef4ff; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #eef2f7; margin-right: 4px; }
.badge.active { background: #e6f6ec; color: #17603a; }
.badge.restricted { background: #fdeceb; color: #8f1d14; }
.badge.withdrawn { background: #eef2f7; color: #5b6b80; }
.badge.expert { background: #eef1ff; color: #2b2f8f; }
.pagination { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.range { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; margin-top: 16px; }
.range input { width: auto; }
.range label { flex-basis: 100%; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
.metric { display: grid; gap: 4px; padding: 16px 18px; background: #fff; border: 1px solid var(--border); border-radius: 14px; }
.metric-label { font-size: 13px; color: var(--muted); }
.metric strong { font-size: 28px; line-height: 1.1; color: var(--navy); font-variant-numeric: tabular-nums; }
.trend-title { margin: 28px 0 0; font-size: 16px; }
.trend { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 8px; }
.trend li { display: grid; grid-template-columns: 52px 1fr 40px; align-items: center; column-gap: 10px; }
.trend-date { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.trend-track { display: block; height: 14px; border-radius: 7px; background: var(--track); }
.trend-bar { display: block; height: 100%; min-width: 2px; border-radius: 7px; background: var(--navy); }
.trend-value { font-size: 14px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.trend-extra { grid-column: 2 / 4; margin: 0; }
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
