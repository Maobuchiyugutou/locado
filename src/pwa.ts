import { isTauri } from "@tauri-apps/api/core";

// PWA 只在生产构建启用。dev 与 preview 共用 origin,开发时清掉旧 SW 和缓存,
// 避免改代码后仍拿到生产缓存。原生壳直接加载构建资源,不注册 Service Worker。
export function setupPWA(): void {
  if (isTauri() || !("serviceWorker" in navigator)) return;

  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister();
    });
    if ("caches" in window) {
      void caches.keys().then((keys) => {
        for (const key of keys) {
          if (key.startsWith("locado-shell-")) void caches.delete(key);
        }
      });
    }
    return;
  }

  const base = import.meta.env.BASE_URL;
  const register = () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
      .catch((error) => console.warn("[Locado] PWA 注册失败", error));
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
