chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-launcher') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const url = tab.url || '';
  const restricted =
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url === '' ||
    url.startsWith('https://chrome.google.com/webstore');

  if (restricted) return;

  try {
    // Check if already open — toggle off
    const [check] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!document.getElementById('tl-root')
    });

    if (check?.result) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          document.getElementById('tl-root')?.remove();
        }
      });
      return;
    }

    // Inject CSS + JS
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['launcher.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['launcher.js'] });

  } catch (err) {
    console.error('Tab Launcher inject error:', err);
  }
});

// Handle data requests from the injected launcher
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TL_GET_DATA') {
    Promise.all([
      chrome.tabs.query({}),
      chrome.bookmarks.getRecent(40),
      chrome.storage.sync.get(['shortcuts', 'autoFireDelay'])
    ]).then(([tabs, bmarks, stored]) => {
      sendResponse({
        tabs: tabs.map(t => ({
          id: t.id,
          windowId: t.windowId,
          title: t.title || '',
          url: t.url || '',
          favIconUrl: t.favIconUrl || ''
        })),
        bookmarks: bmarks.filter(b => b.url).map(b => ({ title: b.title || '', url: b.url })),
        shortcuts: stored.shortcuts || [],
        autoFireDelay: stored.autoFireDelay ?? 300
      });
    });
    return true; // keep channel open for async response
  }

  if (msg.type === 'TL_SWITCH_TAB') {
    chrome.tabs.update(msg.tabId, { active: true });
    chrome.windows.update(msg.windowId, { focused: true });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'TL_OPEN_URL') {
    const url = msg.url.startsWith('http') ? msg.url : 'https://' + msg.url;
    chrome.tabs.query({}).then(all => {
      let domain = '';
      try { domain = new URL(url).hostname; } catch(e) {}
      const existing = domain
        ? all.filter(t => { try { return new URL(t.url).hostname === domain; } catch(e) { return false; } })
        : [];
      if (existing.length) {
        chrome.tabs.update(existing[0].id, { active: true });
        chrome.windows.update(existing[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url, active: true });
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'TL_OPEN_SETTINGS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});
