
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	// Region / uptime lookup (done here so the page's CORS rules don't apply)
	if (message && message.type === 'rorsl server details') {
		const ids = (message.ids || []).filter(id => /^[0-9a-fA-F-]{36}$/.test(id)).slice(0, 50);
		const placeId = parseInt(message.placeId, 10);
		if (!ids.length || !placeId) { sendResponse({ servers: [] }); return; }
		fetch('https://apis.rovalra.com/v1/servers/details?place_id=' + placeId + '&server_ids=' + ids.join(','), { credentials: 'omit' })
			.then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
			.then(data => sendResponse({ servers: (data && data.status === 'success' && data.servers) || [] }))
			.catch(() => sendResponse({ servers: [], failed: true }));
		return true; // async response
	}
});
