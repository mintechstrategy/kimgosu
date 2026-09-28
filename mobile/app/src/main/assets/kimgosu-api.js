/* HTTP/JSON contract shared by Android WebViews and a future browser front end. */
window.KimgosuApi = (() => {
  let sequence = 0;
  const pending = new Map();
  function resolve(id, status, raw) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    let value;
    try { value = JSON.parse(raw || '{}'); } catch (_) { value = {detail: raw}; }
    if (status >= 200 && status < 300) entry.resolve(value);
    else entry.reject(new Error(value.detail || value.message || `요청에 실패했습니다 (${status})`));
  }
  async function request(method, path, data) {
    const body = data === undefined ? '' : JSON.stringify(data);
    if (window.KimgosuNative) {
      return new Promise((ok, fail) => {
        const id = ++sequence;
        pending.set(id, {resolve: ok, reject: fail});
        window.KimgosuNative.request(id, method, path, body);
      });
    }
    const headers = {'Content-Type': 'application/json'};
    if (window.KimgosuAccessToken) headers.Authorization = `Bearer ${window.KimgosuAccessToken}`;
    const response = await fetch(path, {method, headers,
      body: body || undefined});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.detail || `요청에 실패했습니다 (${response.status})`);
    return value;
  }
  async function pickAttachment(roomId) {
    if (window.KimgosuNative) return new Promise((ok, fail) => {
      const id = ++sequence;
      pending.set(id, {resolve: ok, reject: fail});
      window.KimgosuNative.pickAttachment(id, roomId);
    });
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
    const file = await new Promise((ok, fail) => {
      input.onchange = () => input.files?.[0] ? ok(input.files[0]) : fail(new Error('파일을 선택하지 않았습니다'));
      input.click();
    });
    if (file.size > 100 * 1024 * 1024) throw new Error('파일은 100MB 이하만 첨부할 수 있습니다');
    const form = new FormData();form.append('file', file);
    const headers = window.KimgosuAccessToken ? {Authorization: `Bearer ${window.KimgosuAccessToken}`} : {};
    const response = await fetch(`/api/v1/chat/rooms/${encodeURIComponent(roomId)}/attachments`,
      {method:'POST',headers,body:form});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.detail || '첨부파일 업로드에 실패했습니다');
    return value;
  }
  async function saveAttachment(id, filename) {
    if (window.KimgosuNative) window.KimgosuNative.saveAttachment(id, filename);
    else {
      const headers = window.KimgosuAccessToken ? {Authorization: `Bearer ${window.KimgosuAccessToken}`} : {};
      const response = await fetch(`/api/v1/chat/attachments/${encodeURIComponent(id)}/download`, {headers});
      if (!response.ok) throw new Error('파일을 다운로드할 수 없습니다');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');anchor.href=url;anchor.download=filename || 'attachment';anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }
  function profile() {
    try {
      if (window.KimgosuNative) return JSON.parse(window.KimgosuNative.profile());
      return {...(window.KimgosuProfile || {}),expertMode:localStorage.getItem('kimgosu_mode') === 'expert'};
    }
    catch (_) { return {}; }
  }
  function setMode(mode) {
    if (window.KimgosuNative) window.KimgosuNative.setMode(mode);
    else {localStorage.setItem('kimgosu_mode',mode);location.href=mode==='expert'?'expert.html':'home.html'}
  }
  return {resolve, request, pickAttachment, saveAttachment, profile, setMode};
})();
