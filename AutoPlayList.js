(async () => {
  const CONFIG = {
    playlistName: 'test 1',
    afterScrollWaitMs: 600,
    afterMenuClickWaitMs: 800,
    afterSaveMenuClickWaitMs: 900,
    afterToggleWaitMs: 1000,
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

  const processedIds = new Set();
  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let consecutiveFailures = 0;
  let lastVideoCount = 0;
  let unchangedScrolls = 0;

  const getVideoCards = () => {
    const activePage =
      [...document.querySelectorAll('ytd-browse[role="main"], ytd-search[role="main"], ytd-browse:not([hidden])')].find(
        el => !el.hasAttribute('hidden') && isVisible(el)
      ) || document;

    return [
      ...activePage.querySelectorAll(
        'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer'
      ),
    ].filter(card => !card.closest('[hidden]') && isVisible(card));
  };

  const extractVideoId = card => {
    const link = card.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!link) return null;
    try {
      const url = new URL(link.href, window.location.origin);
      const vParam = url.searchParams.get('v');
      if (vParam) return vParam;
      const shortsMatch = url.pathname.match(/\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
      return url.href;
    } catch {
      return link.href;
    }
  };

  const findCardMenuButton = card => {
    const allButtons = [...card.querySelectorAll('button')];
    if (allButtons.length === 0) return null;

    const threeDotsBtn = allButtons.find(btn => {
      const d = btn.querySelector('path')?.getAttribute('d') || '';
      return d.includes('M12 16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zM10.5 12c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5zm0-6c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5z') ||
             d.includes('M12 4a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z');
    });
    if (threeDotsBtn) return threeDotsBtn;

    const menuRendererBtn = card.querySelector(
      'ytd-menu-renderer button, yt-lockup-metadata-view-model button, #menu button'
    );
    if (menuRendererBtn) return menuRendererBtn;

    const titleEl = card.querySelector('#video-title, h3 a, a#video-title-link, yt-lockup-metadata-view-model h3');
    const videoTitle = (titleEl?.textContent || '').trim();
    if (videoTitle) {
      const titleMatch = allButtons.find(btn =>
        (btn.getAttribute('aria-label') || '').includes(videoTitle)
      );
      if (titleMatch) return titleMatch;
    }

    const nonThumbButtons = allButtons.filter(
      btn => !btn.closest('#thumbnail, ytd-thumbnail, yt-thumbnail-view-model')
    );
    if (nonThumbButtons.length > 0) {
      return nonThumbButtons[nonThumbButtons.length - 1];
    }

    return allButtons[allButtons.length - 1];
  };

  const findSaveToPlaylistMenuItem = () => {
    const items = [
      ...document.querySelectorAll(
        '[role="menuitem"], tp-yt-paper-item, ytd-menu-service-item-renderer'
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
      const text = (el.textContent || '').trim();
      return saveKeywords.some(kw => text.includes(kw));
    });
    if (keywordMatch) return keywordMatch;

    const svgMatch = items.find(el => {
      const d = el.querySelector('path')?.getAttribute('d') || '';
      return d.includes('M22 13h-4v4h-2v-4h-4v-2h4V7h2v4h4v2') ||
             d.includes('M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4z');
    });
    if (svgMatch) return svgMatch;

    if (items.length >= 4) {
      return items[2];
    }

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

  console.log(`[START] Auto-saving to playlist "${CONFIG.playlistName}"`);

  while (true) {
    const cards = getVideoCards();

    for (const card of cards) {
      if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
        console.error('[STOP] Stopped safely after reaching maximum consecutive failures.');
        break;
      }

      const videoId = extractVideoId(card);
      if (!videoId || processedIds.has(videoId)) continue;
      processedIds.add(videoId);

      try {
        card.scrollIntoView({ behavior: 'instant', block: 'center' });
        card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(CONFIG.afterScrollWaitMs);

        const menuButton = await waitFor(() => findCardMenuButton(card));

        if (!menuButton) {
          recordFailure(`Item #${processedIds.size} (${videoId}): Menu button not found`);
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
          recordFailure(`Item #${processedIds.size} (${videoId}): "Save to playlist" option not found`);
          await closeOpenOverlays();
          continue;
        }

        saveMenuItem.click();
        await sleep(CONFIG.afterSaveMenuClickWaitMs);

        const playlistButton = await waitFor(() => findPlaylistButton(CONFIG.playlistName));

        if (!playlistButton) {
          recordFailure(`Item #${processedIds.size} (${videoId}): Playlist "${CONFIG.playlistName}" not found`);
          await closeOpenOverlays();
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
          console.log(`[SKIP] Item #${processedIds.size} (${videoId}): Already saved to "${CONFIG.playlistName}"`);
        } else {
          (checkbox || playlistButton).click();
          await sleep(CONFIG.afterToggleWaitMs);
          savedCount++;
          consecutiveFailures = 0;
          console.log(`[SAVED] Item #${processedIds.size} (${videoId}): Saved to "${CONFIG.playlistName}"`);
        }

        await closeOpenOverlays();
      } catch (err) {
        recordFailure(`Item #${processedIds.size} (${videoId}): Unexpected error (${err?.message || err})`);
        await closeOpenOverlays();
      }
    }

    if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
      break;
    }

    const currentVideoCount = getVideoCards().length;
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
