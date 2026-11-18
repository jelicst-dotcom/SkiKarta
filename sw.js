/* SkiKarta: rad bez interneta (2.9). Datoteku sw.js stvara napravi_web.py; verzija se računa iz sadržaja.
   Stranica, paketi (karte, profili, kod, fontovi) spremaju se pri instalaciji; Python (Pyodide) i fontovi
   s mreže spremaju se pri prvom učitavanju (stranica ih sama upiše u predmemoriju kad je spremna). */
const VERSION = "7cdf81b0b0aa";
const APP = "skikarta-app-" + VERSION;
const CDN = "skikarta-cdn-v1";   // Pyodide ne mijenja se s verzijom aplikacije
const SHELL = ["index.html", "manifest.json", "ikona-192.png", "ikona-512.png"];
const CDN_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP);
    const fresh = (url) => new Request(url, { cache: "reload" });   // bez HTTP predmemorije: nova verzija = nove datoteke
    const listResponse = await fetch(fresh("paketi.json"));
    if (!listResponse.ok) throw new Error("paketi.json " + listResponse.status);
    const packs = await listResponse.clone().json();
    await cache.put("paketi.json", listResponse);
    await cache.addAll([...SHELL, ...packs].map(fresh));
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
    if (response && response.ok) cache.put(request, response.clone());
    return response;
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
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
