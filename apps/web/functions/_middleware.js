/**
 * The operator console has its own hostname (admin-kimgosu.mintech.ai), so the
 * root of that host belongs to the console, not the member app. Everything else
 * on the host is served as usual.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'admin-kimgosu.mintech.ai' && url.pathname === '/') {
    return Response.redirect(`${url.origin}/admin`, 302);
  }
  return context.next();
}
