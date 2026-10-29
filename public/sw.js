// 离线应用壳:HTML 网络优先(便于升级),静态资源缓存优先(带 hash 的构建产物可长期复用)。
// 只处理同源 GET;任务数据在 localStorage,不经过 Service Worker。
const CACHE = "locado-shell-v4";
const BASE = new URL("./", self.location.href).pathname;
const INDEX = BASE + "index.html";
const SHELL = [
  BASE,
  INDEX,
  BASE + "manifest.webmanifest",
  BASE + "favicon.svg",
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const indexResponse = await fetch(INDEX, { cache: "no-store" });
    if (!indexResponse.ok) {
      throw new Error(`无法预缓存应用入口: HTTP ${indexResponse.status}`);
    }

    const html = await indexResponse.clone().text();
    const assets = new Set();
    const attribute = (tag, name) => {
      const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
      return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
    };
    const markup = html.replace(/<!--[\s\S]*?-->/g, "");
    for (const match of markup.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const tag = match[0];
      const rel = attribute(tag, "rel").toLowerCase().split(/\s+/);
      const isScript = /^<script\b/i.test(tag);
      const isAssetLink = /^<link\b/i.test(tag)
        && (rel.includes("stylesheet") || rel.includes("modulepreload"));
      if (!isScript && !isAssetLink) continue;

      const reference = attribute(tag, isScript ? "src" : "href");
      if (!reference) continue;
      const url = new URL(reference, indexResponse.url);
      if (url.origin === self.location.origin) assets.add(url.pathname + url.search);
    }

    // addAll 任一核心或构建资源失败都会拒绝安装,避免产生不完整的离线版本。
    await cache.addAll([...new Set([...SHELL.filter((url) => url !== INDEX), ...assets])]);
    await cache.put(INDEX, indexResponse);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("locado-shell-") && key !== CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 生产 SW 可能恰好控制着一个 dev 页面;开发资源直接走网络,不入离线缓存。
  const devPrefixes = ["/@vite/", "/@fs/", "/@id/", "/src/", "/node_modules/"];
  if (devPrefixes.some((prefix) => url.pathname.startsWith(prefix))) return;

  // 页面导航:优先拿最新 HTML;服务没启动/断网时回退到缓存,实现离线打开。
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(INDEX, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(INDEX)) || (await caches.match(BASE)) || Response.error();
      }
    })());
    return;
  }

  // JS/CSS/图标:缓存优先;新 hash 资源首次在线加载后也会进入缓存。
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return new Response("离线且该资源尚未缓存", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});
