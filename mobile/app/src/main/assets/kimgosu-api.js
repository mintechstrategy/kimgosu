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
    const response = await fetch(path, {method, headers: {'Content-Type': 'application/json'},
      body: body || undefined});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.detail || `요청에 실패했습니다 (${response.status})`);
    return value;
  }
  function profile() {
    try { return JSON.parse(window.KimgosuNative?.profile() || '{}'); }
    catch (_) { return {}; }
  }
  return {resolve, request, profile};
})();
