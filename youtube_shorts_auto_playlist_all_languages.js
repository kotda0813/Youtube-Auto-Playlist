(async () => {
  const CONFIG = {
    playlistName: 'test 1',
    afterScrollWaitMs: 600,
    afterOpenShortsWaitMs: 1800,
    afterMenuClickWaitMs: 800,
    afterSaveMenuClickWaitMs: 900,
    afterToggleWaitMs: 1000,
    afterBackWaitMs: 1200,
    scrollLoadWaitMs: 2800,
    elementPollIntervalMs: 150,
    elementTimeoutMs: 4000,
    maxUnchangedScrolls: 3,
    maxConsecutiveFailures: 5,
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const waitFor = async (getter, timeoutMs = CONFIG.elementTimeoutMs) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = getter();
      if (result) return result;
      await sleep(CONFIG.elementPollIntervalMs);
    }
    return null;
  };

  const isVisible = el => {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const closeOpenOverlays = async () => {
    const closeSelectors = [
      'ytd-add-to-playlist-renderer yt-icon-button button',
      'ytd-add-to-playlist-renderer #close-button button',
      'tp-yt-iron-overlay-backdrop',
    ];

    for (const selector of closeSelectors) {
      const target = [...document.querySelectorAll(selector)].find(isVisible);
      if (target) {
        target.click();
        await sleep(250);
      }
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
  };

  const returnToListPage = async listUrl => {
    await closeOpenOverlays();
    if (window.location.pathname.startsWith('/shorts/')) {
      window.history.back();
      await waitFor(() => !window.location.pathname.startsWith('/shorts/'), 4000);
      if (window.location.pathname.startsWith('/shorts/')) {
        window.location.href = listUrl;
      }
      await sleep(CONFIG.afterBackWaitMs);
    }
  };

  const processedIds = new Set();
  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let consecutiveFailures = 0;
  let lastVideoCount = 0;
  let unchangedScrolls = 0;

  const getShortsCards = () => {
    const activePage =
      [...document.querySelectorAll('ytd-browse[role="main"], ytd-search[role="main"], ytd-browse:not([hidden])')].find(
        el => !el.hasAttribute('hidden') && isVisible(el)
      ) || document;

    const candidates = [
      ...activePage.querySelectorAll(
        'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-rich-grid-slim-media, ytd-rich-item-renderer'
      ),
    ];

    return candidates.filter(card => {
      if (card.closest('[hidden]') || !isVisible(card)) return false;
      if (
        card.tagName.toLowerCase() === 'ytd-rich-item-renderer' &&
        card.querySelector('ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-rich-grid-slim-media')
      ) {
        return false;
      }
      return Boolean(card.querySelector('a[href*="/shorts/"]'));
    });
  };

  const extractShortsId = card => {
    const link = card.querySelector('a[href*="/shorts/"]');
    if (!link) return null;
    try {
      const url = new URL(link.href, window.location.origin);
      const shortsMatch = url.pathname.match(/\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
      return url.href;
    } catch {
      return link.href;
    }
  };

  const findShortsPlayerMenuButton = () => {
    const activeReel =
      [...document.querySelectorAll('ytd-reel-video-renderer[is-active], ytd-reel-video-renderer')].find(isVisible) ||
      document;

    const menuBtn = [
      ...activeReel.querySelectorAll(
        '#menu-button button, #menu-button yt-icon-button, ytd-menu-renderer button, ytd-menu-renderer yt-icon-button, #actions button'
      ),
    ].find(btn => {
      if (!isVisible(btn)) return false;
      const d = btn.querySelector('path')?.getAttribute('d') || '';
      return (
        d.includes('M12 16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zM10.5 12c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5zm0-6c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5z') ||
        d.includes('M12 4a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z') ||
        Boolean(btn.closest('#menu-button, ytd-menu-renderer'))
      );
    });

    return menuBtn || null;
  };

  const findSaveToPlaylistMenuItem = () => {
    const activeMenu =
      [...document.querySelectorAll('tp-yt-iron-dropdown:not([aria-hidden="true"]), yt-sheet-view-model, ytd-menu-popup-renderer')].find(
        isVisible
      ) || document;

    const items = [
      ...activeMenu.querySelectorAll(
        '[role="menuitem"], tp-yt-paper-item, ytd-menu-service-item-renderer, yt-list-item-view-model'
      ),
    ].filter(isVisible);

    if (items.length === 0) return null;

    const saveKeywords = [
      '再生リストに保存', 'Save to playlist', 'Guardar en lista', 'Enregistrer dans',
      'In Playlist speichern', 'Salva nella playlist', 'Salvar na playlist',
      'Сохранить в плейлист', '재생목록에 저장', '保存到播放列表', '儲存至播放清單',
      'Simpan ke playlist', 'Lưu vào danh sách phát', 'บันทึกลงในเพลย์ลิสต์',
      'प्लेलिस्ट में सेव करें', 'حفظ في قائمة التشغيل', 'Oynatma listesine kaydet'
    ];
    const keywordMatch = items.find(el => {
      const text = (el.innerText || el.textContent || '').trim();
      return saveKeywords.some(kw => text.includes(kw));
    });
    if (keywordMatch) return keywordMatch;

    const svgMatch = items.find(el => {
      const paths = [...el.querySelectorAll('path')].map(p => p.getAttribute('d') || '');
      return paths.some(
        d =>
          d.includes('M22 13h-4v4h-2v-4h-4v-2h4V7h2v4h4v2') ||
          d.includes('M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4z') ||
          d.includes('M18 4v15.06l-5.42-3.87-.58-.42-.58.42L6 19.06V4h12m1-1H5v18l7-5 7 5V3z')
      );
    });
    if (svgMatch) return svgMatch;

    return null;
  };

  const findPlaylistButton = name => {
    const activeDialog =
      [
        ...document.querySelectorAll(
          'ytd-add-to-playlist-renderer, tp-yt-iron-dropdown:not([aria-hidden="true"]), ytd-popup-container tp-yt-paper-dialog'
        ),
      ].find(isVisible) || document;

    const candidates = [
      ...activeDialog.querySelectorAll(
        'ytd-playlist-add-to-option-renderer, button[role="menuitem"], tp-yt-paper-item'
      ),
    ].filter(isVisible);

    return candidates.find(el => {
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      const titleEl = el.querySelector('#label, yt-formatted-string, .yt-core-attributed-string');
      const text = (titleEl ? titleEl.textContent : el.textContent || '').trim();

      return text === name || ariaLabel === name || ariaLabel.startsWith(`${name},`);
    });
  };

  const recordFailure = message => {
    failedCount++;
    consecutiveFailures++;
    console.warn(`[WARN] ${message} (consecutive failures: ${consecutiveFailures}/${CONFIG.maxConsecutiveFailures})`);
  };

  console.log(`[START] Auto-saving Shorts to playlist "${CONFIG.playlistName}"`);

  while (true) {
    const cards = getShortsCards();
    let processedInPass = false;

    for (const card of cards) {
      if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
        console.error('[STOP] Stopped safely after reaching maximum consecutive failures.');
        break;
      }

      const shortsId = extractShortsId(card);
      if (!shortsId || processedIds.has(shortsId)) continue;
      processedIds.add(shortsId);
      processedInPass = true;

      const listUrl = window.location.href;

      try {
        card.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(CONFIG.afterScrollWaitMs);

        const link = card.querySelector('a[href*="/shorts/"]');
        if (!link) {
          recordFailure(`Shorts #${processedIds.size} (${shortsId}): Shorts link not found`);
          continue;
        }

        link.click();
        const opened = await waitFor(() => window.location.pathname.includes(`/shorts/${shortsId}`), 5000);
        if (!opened) {
          recordFailure(`Shorts #${processedIds.size} (${shortsId}): Failed to open Shorts player`);
          await returnToListPage(listUrl);
          continue;
        }

        await sleep(CONFIG.afterOpenShortsWaitMs);

        const videoEl = document.querySelector('ytd-reel-video-renderer[is-active] video, video');
        if (videoEl && !videoEl.paused) {
          videoEl.pause();
        }

        const menuButton = await waitFor(() => findShortsPlayerMenuButton());
        if (!menuButton) {
          recordFailure(`Shorts #${processedIds.size} (${shortsId}): Player menu button not found`);
          await returnToListPage(listUrl);
          continue;
        }

        menuButton.click();
        await sleep(CONFIG.afterMenuClickWaitMs);

        let saveMenuItem = await waitFor(() => findSaveToPlaylistMenuItem());
        if (!saveMenuItem) {
          menuButton.click();
          await sleep(CONFIG.afterMenuClickWaitMs);
          saveMenuItem = await waitFor(() => findSaveToPlaylistMenuItem());
        }

        if (!saveMenuItem) {
          recordFailure(`Shorts #${processedIds.size} (${shortsId}): "Save to playlist" option not found`);
          await returnToListPage(listUrl);
          continue;
        }

        saveMenuItem.click();
        await sleep(CONFIG.afterSaveMenuClickWaitMs);

        const playlistButton = await waitFor(() => findPlaylistButton(CONFIG.playlistName));
        if (!playlistButton) {
          recordFailure(`Shorts #${processedIds.size} (${shortsId}): Playlist "${CONFIG.playlistName}" not found`);
          await returnToListPage(listUrl);
          continue;
        }

        const checkbox = playlistButton.querySelector('tp-yt-paper-checkbox, [role="checkbox"]');
        const isAlreadySaved =
          playlistButton.getAttribute('aria-pressed') === 'true' ||
          playlistButton.getAttribute('aria-checked') === 'true' ||
          checkbox?.hasAttribute('checked') ||
          checkbox?.getAttribute('aria-checked') === 'true';

        if (isAlreadySaved) {
          skippedCount++;
          consecutiveFailures = 0;
          console.log(`[SKIP] Shorts #${processedIds.size} (${shortsId}): Already saved to "${CONFIG.playlistName}"`);
        } else {
          (checkbox || playlistButton).click();
          await sleep(CONFIG.afterToggleWaitMs);
          savedCount++;
          consecutiveFailures = 0;
          console.log(`[SAVED] Shorts #${processedIds.size} (${shortsId}): Saved to "${CONFIG.playlistName}"`);
        }

        await returnToListPage(listUrl);
        break;
      } catch (err) {
        recordFailure(`Shorts #${processedIds.size} (${shortsId}): Unexpected error (${err?.message || err})`);
        await returnToListPage(listUrl);
        break;
      }
    }

    if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
      break;
    }

    if (processedInPass) {
      continue;
    }

    const currentVideoCount = getShortsCards().length;
    if (currentVideoCount === lastVideoCount) {
      unchangedScrolls++;
    } else {
      unchangedScrolls = 0;
      lastVideoCount = currentVideoCount;
    }

    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth',
    });

    await sleep(CONFIG.scrollLoadWaitMs);

    if (unchangedScrolls >= CONFIG.maxUnchangedScrolls) {
      break;
    }
  }

  console.log('');
  console.log('[DONE] Processing complete');
  console.log(`Processed: ${processedIds.size}`);
  console.log(`Saved: ${savedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Failed: ${failedCount}`);
})();