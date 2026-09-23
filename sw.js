/* =====================================================================
   Year Planner — service worker (makes the app work offline)

   How it works
   • On first visit it saves the app (index.html + icons) on the device.
   • After that, the app opens instantly from the saved copy — even with no
     internet — and quietly refreshes the copy in the background when online.
   • It also saves the Google Fonts and the EmailJS library so the app looks
     the same offline.
   • Your planner data lives in the browser (localStorage / IndexedDB), so it
     is always available offline and is never touched by this file.

   Updating the app: after you change index.html, bump VERSION below
   (e.g. 'v2'). Visitors get the new version the next time they open the app.
   ===================================================================== */
const VERSION = 'v1';
const CACHE = 'year-planner-' + VERSION;

// Must exist next to sw.js — if the page can't be saved, the service worker won't install
const PAGE = './index.html';

// Nice to have — saved if available
const EXTRAS = [
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

// Third-party files used by index.html (keep these identical to the tags in index.html)
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600;700&display=swap';
const EMAILJS_JS = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
const THIRD_PARTY_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

const SCOPE_PATH = new URL('./', self.location).pathname;

/* A response that came from a redirect can't be used to answer a page load,
   so make a clean copy of it. */
function clean(res){
  if(!res || !res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/* Save the Google Fonts stylesheet and the (Latin) font files it points to. */
async function cacheFonts(cache){
  const cssRes = await fetch(new Request(FONT_CSS, { mode: 'cors', credentials: 'omit' }));
  if(!cssRes.ok) return;
  const css = await cssRes.clone().text();
  await cache.put(FONT_CSS, cssRes);
  // The stylesheet is split into "/* latin */ @font-face {...}" blocks — keep only latin + latin-ext
  const parts = css.split(/\/\*\s*([\w-]+)\s*\*\//);
  const urls = [];
  for(let i = 1; i < parts.length; i += 2){
    if(parts[i] !== 'latin' && parts[i] !== 'latin-ext') continue;
    const re = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
    let m;
    while((m = re.exec(parts[i + 1])) !== null) urls.push(m[1]);
  }
  await Promise.all(urls.map(async function(u){
    try{
      const r = await fetch(new Request(u, { mode: 'cors', credentials: 'omit' }));
      if(r.ok) await cache.put(u, r);
    }catch(e){ /* skip this font file */ }
  }));
}

async function cacheEmailJs(cache){
  const r = await fetch(new Request(EMAILJS_JS, { mode: 'cors', credentials: 'omit' }));
  if(r.ok) await cache.put(EMAILJS_JS, r);
}

self.addEventListener('install', function(event){
  event.waitUntil((async function(){
    const cache = await caches.open(CACHE);

    // 1) The page itself (required). Saved under ./index.html; fetched from the folder address.
    const pageRes = await fetch(new Request('./', { cache: 'reload' }));
    if(!pageRes.ok) throw new Error('Could not save the page (' + pageRes.status + ')');
    await cache.put(PAGE, clean(pageRes));

    // 2) Icons + manifest, fonts and the EmailJS library (best effort — never blocks the install)
    await Promise.all(EXTRAS.map(function(u){
      return fetch(new Request(u, { cache: 'reload' })).then(function(r){ if(r.ok) return cache.put(u, r); }).catch(function(){});
    }));
    await Promise.all([ cacheFonts(cache).catch(function(){}), cacheEmailJs(cache).catch(function(){}) ]);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function(event){
  event.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k.indexOf('year-planner-') === 0 && k !== CACHE; })
                          .map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});

/* The app's page: open from the saved copy, refresh the copy in the background. */
async function appPage(event){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(PAGE);
  const update = fetch(event.request)
    .then(function(res){
      if(res && res.status === 200){ cache.put(PAGE, clean(res.clone())).catch(function(){}); }
      return res;
    })
    .catch(function(){ return null; });
  if(cached){ event.waitUntil(update); return cached; }
  const res = await update;
  return res || new Response('You are offline and the app has not been saved yet. Open it once with internet.',
                             { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/* Other files from this site (icons, manifest…): saved copy first, refreshed in the background. */
async function sameOriginFile(event){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  const update = fetch(event.request)
    .then(function(res){
      if(res && res.status === 200 && res.type === 'basic'){ cache.put(event.request, res.clone()).catch(function(){}); }
      return res;
    })
    .catch(function(){ return null; });
  if(cached){ event.waitUntil(update); return cached; }
  return (await update) || Response.error();
}

/* Fonts + EmailJS: saved copy first, otherwise fetch it and save it. */
async function thirdPartyFile(request){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request.url, { ignoreVary: true });
  if(hit) return hit;
  try{
    const res = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
    if(res && res.ok) cache.put(request.url, res.clone()).catch(function(){});
    return res;
  }catch(e){
    return Response.error();
  }
}

self.addEventListener('fetch', function(event){
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(url.origin === self.location.origin){
    if(req.mode === 'navigate'){
      const isAppPage = url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH.slice(0, -1) ||
                        url.pathname === SCOPE_PATH + 'index.html';
      if(isAppPage) event.respondWith(appPage(event));
      return;
    }
    event.respondWith(sameOriginFile(event));
    return;
  }

  if(THIRD_PARTY_HOSTS.indexOf(url.hostname) !== -1){
    event.respondWith(thirdPartyFile(req));
  }
  // everything else (e.g. sending a message through EmailJS) goes straight to the network
});
