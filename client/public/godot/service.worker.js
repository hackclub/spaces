self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(keys.filter((key) => key.startsWith('GodotEngine-sw-cache-')).map((key) => caches.delete(key)));
		await self.registration.unregister();
		const windows = await self.clients.matchAll({ type: 'window' });
		windows.forEach((client) => client.navigate(client.url));
	})());
});
