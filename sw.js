/* PWA V031: Cache nur freigegebene statische App-Dateien, keine importierten JSON-Daten. */
const CACHE_NAME="pmi-wissensnavigator-v031-flat-1";
const SHELL=["./", "./index.html", "./viewer.css", "./viewer.js", "./sync-core.js", "./vis-network.min.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];
const ALLOWED=new Set(SHELL.map(p=>new URL(p,self.registration.scope).pathname));
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pmi-wissensnavigator-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request, url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 if(req.mode==='navigate'){event.respondWith(fetch(req).catch(async()=> (await caches.open(CACHE_NAME)).match('./index.html')));return;}
 if(!ALLOWED.has(url.pathname))return;
 event.respondWith(caches.open(CACHE_NAME).then(cache=>cache.match(new URL(url.pathname,self.location.origin).href).then(cached=>cached||fetch(req))));
});
