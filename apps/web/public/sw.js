const CACHE='council-task-shell-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/'))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  // Pages: network first, so a new deploy shows at once; the cached shell only when offline. API requests never enter this cache.
  if(event.request.mode==='navigate'){
   try{const fresh=await fetch(event.request);if(fresh.ok)cache.put('/',fresh.clone());return fresh;}
   catch{return (await cache.match('/'))??Response.error();}
  }
  if(PRECACHE.includes(url.pathname)){
   const cached=await cache.match(url.pathname,{ignoreVary:true});
   if(cached)return cached;
  }
  return fetch(event.request);
 })());
});
