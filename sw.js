/* SkiKarta: rad bez interneta (2.9). Datoteku sw.js stvara napravi_web.py; verzija se računa iz sadržaja.
   Stranica, paketi (karte, profili, kod, fontovi) spremaju se pri instalaciji; Python (Pyodide) i fontovi
   s mreže spremaju se pri prvom učitavanju (stranica ih sama upiše u predmemoriju kad je spremna). */
const VERSION = "9c20e0f88171";
const APP = "skikarta-app-" + VERSION;
const CDN = "skikarta-cdn-v1";   // Pyodide ne mijenja se s verzijom aplikacije
const SHELL = ["index.html", "manifest.json", "ikona-192.png", "ikona-512.png", "pyradnik.js"];
const CDN_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const EXTRA = ["primjeri_hr.json", "primjeri_en.json"];   // 3.8.2

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP);
    const fresh = (url) => new Request(url, { cache: "reload" });   // bez HTTP predmemorije: nova verzija = nove datoteke
    const listResponse = await fetch(fresh("paketi.json"));
    if (!listResponse.ok) throw new Error("paketi.json " + listResponse.status);
    const packs = await listResponse.clone().json();
    await cache.put("paketi.json", listResponse);
    await cache.addAll([...SHELL, ...packs].map(fresh));
    // 3.8.2: primjeri sličica nisu nužni za rad; ako ih nema, instalacija ne pada
    await Promise.all(EXTRA.map((u) => cache.add(fresh(u)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("skikarta-app-") && key !== APP) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, ms, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
    if (response && response.ok) { cache.put(request, response.clone()); return response; }
    // 3.8.1: privremena greška poslužitelja (npr. 503) ne smije zamijeniti zadnju cjelovitu verziju
    const kept = (await cache.match(request, { ignoreSearch: true })) || (fallbackKey && (await cache.match(fallbackKey)));
    return kept || response;
  } catch (err) {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (fallbackKey && (await cache.match(fallbackKey)));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

// 3.7: „Podijeli → SkiKarta” (Web Share Target): GPX iz druge aplikacije stiže kao POST na ./podijeli.
// Datoteke se spremaju u zasebnu predmemoriju; stranica preuzme samo svoju pošiljku (?podijeljeno=ID) i zatim je briše.
const SHARED = "skikarta-podijeljeno";
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARED);
  // 3.8.1: svaka pošiljka ima svoj ID; stranica preuzima samo nju i briše je tek nakon preuzimanja
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let n = 0;
  for (const file of form.getAll("gpx")) {
    if (!file || typeof file === "string") continue;
    const key = new URL(`podijeljeno/${id}/${n}?ime=${encodeURIComponent(file.name || "zapis.gpx")}`, self.registration.scope);
    await cache.put(key, new Response(file));
    n += 1;
  }
  return Response.redirect(new URL(`index.html?podijeljeno=${id}`, self.registration.scope).href, 303);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method === "POST" && new URL(request.url).pathname.endsWith("/podijeli")) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    const name = url.pathname.split("/").pop();
    if (request.mode === "navigate" || name === "" || name === "index.html" || name === "paketi.json") {
      event.respondWith(networkFirst(request, APP, 4000, "index.html"));   // nova verzija se vidi čim ima mreže
    } else if (name !== "sw.js") {
      event.respondWith(cacheFirst(request, APP));            // paketi su vezani uz verziju (APP)
    }
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, CDN));
  }
});
