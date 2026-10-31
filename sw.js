// Couch Bandit: minimal service worker so the site installs as an app on phones, laptops and TVs.
// It caches nothing and never touches streams; every request goes straight to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
