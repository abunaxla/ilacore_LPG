// Service worker for the handheld screens (/field). It only keeps copies so the screens open with no signal;
// it never queues anything (that is the outbox, src/lib/field-outbox.ts) and never answers for the API.
//  - Pages under /field: the network first; the last copy when there is no signal.
//  - A handover started with no signal has no copy yet: the offline handover screen is shown instead.
//  - The app's own files (/_next/static, content-hashed): from the copy, fetched once.
//  - Everything else, including Server Actions and router data: straight to the network.
const CACHE = 'ilacore-field-v1';
const SHELL = '/field/offline-handover';
const HANDOVER = /^\/field\/handovers\/([0-9a-f-]{36})$/;

async function keepShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch(SHELL, { cache: 'no-store' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(SHELL, res);
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]))];
  await Promise.all(assets.map((a) => cache.add(a).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(keepShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ilacore-field-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Signing out forgets the copies of the last driver's pages (the outbox is kept until sent or removed).
self.addEventListener('message', (event) => {
  if (event.data === 'forget-pages') event.waitUntil(caches.delete(CACHE).then(keepShell).catch(() => undefined));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate' && (url.pathname === '/field' || url.pathname.startsWith('/field/'))) {
    event.respondWith(page(req, url));
  }
});

async function page(req, url) {
  const cache = await caches.open(CACHE);
  const key = url.pathname + url.search;
  try {
    const res = await fetch(req);
    // Only real pages are kept; a redirect (to sign in, say) is not a copy of the page.
    if (res.ok && !res.redirected) cache.put(key, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(key)) ?? (url.search ? await cache.match(url.pathname) : undefined);
    if (hit) return hit;
    const handover = HANDOVER.exec(url.pathname);
    if (handover) return Response.redirect(`${SHELL}#${handover[1]}`, 302);
    if (url.pathname === SHELL) {
      const shell = await cache.match(SHELL);
      if (shell) return shell;
    }
    return (await cache.match('/field')) ?? new Response('No signal, and this screen has not been opened on this handheld yet.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
