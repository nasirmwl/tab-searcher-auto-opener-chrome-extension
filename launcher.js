(function() {
  'use strict';
  if (document.getElementById('tl-root')) return;

  let allTabs = [], shortcuts = [], bookmarks = [];
  let filtered = [], selectedIdx = 0;
  let autoTimer = null, timerRaf = null, timerStart = null;
  let autoFireDelay = 300;

  // ── Build DOM ──────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'tl-root';
  root.innerHTML = `
    <div id="tl-scrim"></div>
    <div id="tl-panel">
      <div id="tl-search-row">
        <div id="tl-icon">
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
            <circle cx="7.5" cy="7.5" r="5.5" stroke="rgba(200,200,210,0.45)" stroke-width="1.5"/>
            <path d="M12.5 12.5L16 16" stroke="rgba(200,200,210,0.45)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <input id="tl-input" type="text" placeholder="Search tabs or @shortcut key…" autocomplete="off" spellcheck="false"/>
        <div id="tl-shortcut-chip" style="display:none"></div>
      </div>
      <div id="tl-timer-track"><div id="tl-timer-bar"></div></div>
      <div id="tl-results">
        <div class="tl-empty"><p>Loading…</p></div>
      </div>
      <div id="tl-footer">
        <div class="tl-hints">
          <span class="tl-hint"><span class="tl-kbd">↑↓</span> navigate</span>
          <span class="tl-hint"><span class="tl-kbd">↵</span> open</span>
          <span class="tl-hint"><span class="tl-kbd">Esc</span> close</span>
        </div>
        <div id="tl-autofire">
          <div class="tl-dot"></div>
          <span>opening in <b id="tl-ms">300</b>ms</span>
        </div>
        <button id="tl-settings-btn" title="Settings">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>`;
  document.body.appendChild(root);

  // Esc is handled in the page MAIN world (see background.js) so preventDefault runs before the
  // focused input’s default behavior. That path dispatches this event into the isolated world.
  function onEscFromMain() {
    if (document.getElementById('tl-root')) closeLauncher();
  }
  document.addEventListener('tl-esc-close', onEscFromMain);

  const inputEl   = document.getElementById('tl-input');
  const resultsEl = document.getElementById('tl-results');
  const timerBar  = document.getElementById('tl-timer-bar');
  const afEl      = document.getElementById('tl-autofire');
  const msEl      = document.getElementById('tl-ms');
  const scChip    = document.getElementById('tl-shortcut-chip');

  document.getElementById('tl-scrim').addEventListener('click', closeLauncher);
  document.getElementById('tl-settings-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TL_OPEN_SETTINGS' });
    closeLauncher();
  });

  setTimeout(() => inputEl.focus(), 50);

  // ── Load data via background ───────────────────────
  function init() {
    chrome.runtime.sendMessage({ type: 'TL_GET_DATA' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        resultsEl.innerHTML = emptyHtml('Could not connect to extension', 'Try reloading the page');
        return;
      }
      allTabs       = resp.tabs        || [];
      bookmarks     = resp.bookmarks   || [];
      shortcuts     = resp.shortcuts   || [];
      autoFireDelay = resp.autoFireDelay ?? 300;
      renderDefault();
    });
  }

  // ── Direct (substring) match — query must appear contiguously in title or URL ──
  function directMatchScore(str, q) {
    if (!str || !q) return -1;
    const i = str.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return -1;
    const len = str.length;
    let score = 1000 - i;
    if (i === 0) score += 300;
    const needleLen = q.length;
    if (needleLen === len) score += 500;
    return score;
  }

  function substringHighlightPos(str, q) {
    if (!str || !q) return [];
    const lower = str.toLowerCase();
    const i = lower.indexOf(q.toLowerCase());
    if (i === -1) return [];
    const pos = new Array(str.length).fill(false);
    for (let j = i; j < i + q.length && j < str.length; j++) pos[j] = true;
    return pos;
  }

  function highlight(text, q) {
    if (!text) return '';
    if (!q) return esc(text);
    const pos = substringHighlightPos(text, q);
    let out = '';
    for (let i = 0; i < text.length; i++)
      out += pos[i] ? `<mark>${esc(text[i])}</mark>` : esc(text[i]);
    return out;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── @shortcut key match (tabs/bookmarks use plain search; keys require @) ──
  function shortcutKeyLower(s) {
    return (s.key || '').toLowerCase();
  }

  function shortcutsMatchingAtQuery(kp) {
    if (!shortcuts.length) return [];
    const lower = (kp || '').trim().toLowerCase();
    if (!lower) return shortcuts.slice();

    const exact = shortcuts.filter(s => shortcutKeyLower(s) === lower);
    if (exact.length) return exact;

    if (lower.length >= 2) {
      const byKeyPrefix = shortcuts.filter(s => shortcutKeyLower(s).startsWith(lower));
      if (byKeyPrefix.length) return byKeyPrefix;
    }

    const keyIsPrefixOfTyped = shortcuts.filter(s => {
      const k = shortcutKeyLower(s);
      return k.length >= 2 && lower.startsWith(k) && lower.length <= k.length + 2;
    });
    if (keyIsPrefixOfTyped.length) return keyIsPrefixOfTyped;

    if (lower.length === 1) {
      const one = shortcuts.filter(s => shortcutKeyLower(s).startsWith(lower));
      if (one.length) return one;
    }

    return shortcuts.filter(s =>
      directMatchScore(s.label || '', kp.trim()) >= 0 ||
      directMatchScore(s.url || '', kp.trim()) >= 0
    );
  }

  // ── Render default (no query) ──────────────────────
  function renderDefault() {
    filtered = [];
    let html = '';

    if (shortcuts.length) {
      html += sectionLabel('Shortcuts');
      shortcuts.forEach(sc => {
        const item = { type:'shortcut', title: sc.label||sc.url, url: sc.url, key: sc.key };
        html += itemHtml(item, filtered.length, '');
        filtered.push(item);
      });
    }

    const recent = allTabs.slice(0, 9);
    if (recent.length) {
      html += sectionLabel('Open Tabs');
      recent.forEach(t => {
        const item = { type:'tab', title: t.title, url: t.url, tabId: t.id, windowId: t.windowId, fav: t.favIconUrl };
        html += itemHtml(item, filtered.length, '');
        filtered.push(item);
      });
    }

    resultsEl.innerHTML = html || emptyHtml('Start typing to search tabs', 'or @key for a saved shortcut');
    bindClicks();
  }

  // ── Render search results ──────────────────────────
  function renderSearch(q) {
    filtered = [];
    const raw = q.trim();

    // ── @shortcut — key / prefix / label / URL (never mixed with tab search) ──
    if (raw.startsWith('@')) {
      const kp = raw.slice(1).trim();
      const matched = shortcutsMatchingAtQuery(kp);
      filtered = matched.map(s => ({
        type: 'shortcut',
        title: s.label || s.url,
        url: s.url,
        key: s.key
      }));

      if (!filtered.length) {
        scChip.style.display = 'none';
        resultsEl.innerHTML = emptyHtml(`No shortcut for "${raw}"`, 'Try @ followed by a shortcut key');
        return;
      }

      const hl = kp;
      if (filtered.length === 1) {
        scChip.textContent = filtered[0].title;
        scChip.style.display = 'block';
        resultsEl.innerHTML = sectionLabel('1 result — auto-opening…') + itemHtml(filtered[0], 0, hl);
      } else {
        scChip.style.display = 'none';
        let html = sectionLabel('Shortcuts');
        filtered.forEach((item, i) => { html += itemHtml(item, i, hl); });
        resultsEl.innerHTML = html;
      }
      bindClicks();
      if (filtered.length === 1) startTimer();
      return;
    }

    scChip.style.display = 'none';

    const tabSet = new Set(allTabs.map(t => t.url));

    // Score open tabs
    const scoredTabs = allTabs
      .map(t => ({
        item: { type:'tab', title:t.title, url:t.url, tabId:t.id, windowId:t.windowId, fav:t.favIconUrl },
        score: Math.max(directMatchScore(t.title, raw), directMatchScore(t.url, raw))
      }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0, 7);

    // Score shortcuts by label/url (not key — key is handled above)
    const scoredSc = shortcuts
      .map(s => ({
        item: { type:'shortcut', title:s.label||s.url, url:s.url, key:s.key },
        score: Math.max(directMatchScore(s.label, raw), directMatchScore(s.url, raw))
      }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score);

    // Score bookmarks
    const scoredBk = bookmarks
      .filter(b => !tabSet.has(b.url))
      .map(b => ({
        item: { type:'bookmark', title:b.title||b.url, url:b.url },
        score: Math.max(directMatchScore(b.title, raw), directMatchScore(b.url, raw))
      }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0, 4);

    let html = '';
    const addSec = (label, arr) => {
      if (!arr.length) return;
      html += sectionLabel(label);
      arr.forEach(({item}) => {
        html += itemHtml(item, filtered.length, raw);
        filtered.push(item);
      });
    };

    addSec('Shortcuts', scoredSc);
    addSec('Open Tabs', scoredTabs);
    addSec('Bookmarks', scoredBk);

    if (!filtered.length) {
      resultsEl.innerHTML = emptyHtml(`No results for "${raw}"`, 'Try different keywords');
      return;
    }

    // If exactly 1 result — show hint and auto-fire
    if (filtered.length === 1) {
      resultsEl.innerHTML = sectionLabel('1 result — auto-opening…') + html;
    } else {
      resultsEl.innerHTML = html;
    }

    bindClicks();

    // Auto-fire if single result
    if (filtered.length === 1) {
      startTimer();
    }
  }

  // ── Helpers ────────────────────────────────────────
  function sectionLabel(t) {
    return `<div class="tl-section">${esc(t)}</div>`;
  }

  function emptyHtml(p, span) {
    return `<div class="tl-empty">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <circle cx="14" cy="14" r="10" stroke="rgba(200,200,210,0.18)" stroke-width="1.5"/>
        <path d="M22 22L29 29" stroke="rgba(200,200,210,0.18)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <p>${esc(p)}</p>${span ? `<span>${esc(span)}</span>` : ''}
    </div>`;
  }

  function itemHtml(item, idx, q) {
    const sel = idx === selectedIdx ? 'tl-sel' : '';
    const fav = item.fav && item.fav.startsWith('http')
      ? `<img class="tl-fav" src="${esc(item.fav)}" onerror="this.outerHTML='<div class=tl-fav-ph>${esc((item.title||'?')[0].toUpperCase())}</div>'">`
      : `<div class="tl-fav-ph">${esc((item.title||item.url||'?')[0].toUpperCase())}</div>`;
    const keyChip = item.key ? `<div class="tl-key-chip">${esc(item.key)}</div>` : '';
    const badgeCls = { tab:'tl-tab', shortcut:'tl-shortcut', bookmark:'tl-bookmark' }[item.type] || 'tl-tab';
    const badgeTx  = { tab:'TAB', shortcut:'⌘', bookmark:'BKM' }[item.type] || 'TAB';
    const urlShort = (item.url||'').replace(/^https?:\/\//,'').replace(/\/$/,'').slice(0,58);
    return `<div class="tl-item ${sel}" data-idx="${idx}">
      ${fav}
      <div class="tl-info">
        <div class="tl-title">${highlight(item.title||item.url||'', q)}</div>
        <div class="tl-url">${esc(urlShort)}</div>
      </div>
      ${keyChip}
      <span class="tl-badge ${badgeCls}">${badgeTx}</span>
    </div>`;
  }

  function bindClicks() {
    resultsEl.querySelectorAll('.tl-item').forEach(el => {
      el.addEventListener('mouseenter', () => { selectedIdx = +el.dataset.idx; updateSel(); });
      el.addEventListener('click', () => { selectedIdx = +el.dataset.idx; openSelected(); });
    });
  }

  function updateSel() {
    resultsEl.querySelectorAll('.tl-item').forEach(el => {
      const on = +el.dataset.idx === selectedIdx;
      el.classList.toggle('tl-sel', on);
      if (on) el.scrollIntoView({ block:'nearest' });
    });
  }

  // ── Open selected ──────────────────────────────────
  function openSelected() {
    clearTimer();
    const item = filtered[selectedIdx];
    if (!item) return;
    if (item.type === 'tab') {
      chrome.runtime.sendMessage({ type:'TL_SWITCH_TAB', tabId: item.tabId, windowId: item.windowId });
    } else {
      chrome.runtime.sendMessage({ type:'TL_OPEN_URL', url: item.url });
    }
    closeLauncher();
  }

  // ── Timer ──────────────────────────────────────────
  function startTimer() {
    clearTimer();
    if (!filtered.length) return;
    timerStart = Date.now();
    timerBar.style.transition = 'none';
    timerBar.style.width = '0%';
    void timerBar.offsetWidth;
    timerBar.style.transition = `width ${autoFireDelay}ms linear`;
    timerBar.style.width = '100%';
    afEl.classList.add('tl-show');
    msEl.textContent = autoFireDelay;
    const tick = () => {
      if (!timerStart) return;
      const left = Math.max(0, autoFireDelay - (Date.now() - timerStart));
      msEl.textContent = left;
      if (left > 0) timerRaf = requestAnimationFrame(tick);
    };
    timerRaf = requestAnimationFrame(tick);
    autoTimer = setTimeout(openSelected, autoFireDelay);
  }

  function clearTimer() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (timerRaf)  { cancelAnimationFrame(timerRaf); timerRaf = null; }
    timerStart = null;
    timerBar.style.transition = 'none';
    timerBar.style.width = '0%';
    afEl.classList.remove('tl-show');
  }

  // ── Keyboard ───────────────────────────────────────
  // Escape → MAIN-world bridge + tl-esc-close (see background.js). Isolated listeners lose to page.
  function onKey(e) {
    if (!document.getElementById('tl-root')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      updateSel(); clearTimer(); // don't auto-fire while navigating manually
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      updateSel(); clearTimer();
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      openSelected();
    }
  }

  window.addEventListener('keydown', onKey, true);

  inputEl.addEventListener('input', () => {
    selectedIdx = 0;
    clearTimer();
    const q = inputEl.value;
    if (!q.trim()) {
      scChip.style.display = 'none';
      renderDefault();
    } else {
      renderSearch(q);
    }
  });

  // ── Close ──────────────────────────────────────────
  function closeLauncher() {
    clearTimer();
    document.removeEventListener('tl-esc-close', onEscFromMain);
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }

  init();
})();
