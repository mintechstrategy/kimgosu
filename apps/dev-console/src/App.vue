<script setup lang="ts">
import { ref, onMounted } from 'vue';
const api = 'https://api-dev-kimgosu.mintech.ai';
const status = ref('연결 확인 중');
const token = ref('');
const message = ref('웹 개발환경 실제 거래 점검');
const result = ref('');
const busy = ref(false);
const pendingId = ref('');
async function health() {
  try { const r = await fetch(api + '/health'); const data = await r.json(); if (!r.ok) throw new Error(); status.value = 'API 연결 성공 · ' + data.release.slice(0, 12); }
  catch { status.value = 'API 연결 실패 — 네트워크와 배포 상태 확인 필요'; }
}
async function transact() {
  if (!token.value || busy.value) return;
  busy.value = true;
  // Retain the same ID after an uncertain write; do not create duplicate business effects.
  pendingId.value ||= crypto.randomUUID();
  const id = pendingId.value;
  try {
    const headers = { Authorization: 'Bearer ' + token.value, 'Content-Type': 'application/json' };
    const created = await fetch(api + '/sample/records', { method: 'POST', headers, body: JSON.stringify({ id, message: message.value }) });
    if (![201, 409].includes(created.status)) throw new Error('저장 응답 ' + created.status);
    const read = await fetch(api + '/sample/records/' + id, { headers });
    const body = await read.json();
    if (!read.ok || body.id !== id || body.message !== message.value) throw new Error('재조회 불일치');
    result.value = '저장·재조회 성공\n' + JSON.stringify(body, null, 2);
    pendingId.value = '';
  } catch (error) { result.value = error instanceof Error ? error.message : '요청 실패'; }
  finally { busy.value = false; }
}
onMounted(health);
</script>
<template>
  <main>
    <p class="badge">개발환경 전용 · 제품 서비스가 아닙니다</p>
    <h1>김고수 개발 연결 점검</h1>
    <p>Cloudflare → Railway → PostgreSQL 연결을 확인합니다.</p>
    <section aria-label="연결 상태"><h2>API 상태</h2><p data-testid="health" role="status">{{ status }}</p><button @click="health">다시 확인</button></section>
    <section><h2>실제 저장·조회</h2><p>승인된 임시 테스트 토큰만 입력하세요. 토큰은 서버에 전달하며 브라우저 저장소에 보관하지 않습니다.</p>
      <label>임시 토큰<input v-model="token" data-testid="token" type="password" autocomplete="off"></label>
      <label>테스트 메시지<input v-model="message" data-testid="message" maxlength="120"></label>
      <button data-testid="transact" :disabled="!token || busy" @click="transact">{{ busy ? '거래 확인 중…' : '저장 후 재조회' }}</button>
      <pre data-testid="result" role="status">{{ result }}</pre>
    </section>
  </main>
</template>
<style>
body{font-family:system-ui,sans-serif;background:#f4f6f8;color:#172033;margin:0}main{max-width:760px;margin:40px auto;padding:24px}section{background:white;border:1px solid #d8e0e8;border-radius:16px;padding:24px;margin-top:24px}.badge{font-weight:700;color:#44556d}label{display:block;margin:16px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:8px;border:1px solid #728197;border-radius:8px}button{padding:12px 20px;background:#174cc7;color:white;border:0;border-radius:8px;cursor:pointer}button:disabled{opacity:.5;cursor:default}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:28px}p{line-height:1.6}
</style>
