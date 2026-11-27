(async () => {
  const CONFIG = {
    playlistName: 'test 1',
    menuAriaLabel: 'その他の操作',
    saveMenuText: '再生リストに保存',
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
      'ytd-add-to-playlist-renderer button[aria-label*="Close"]',
      'ytd-add-to-playlist-renderer button[aria-label*="閉じる"]',
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

  const getVideoCards = () => [
    ...document.querySelectorAll(
      'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer'
    ),
  ];

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

  const findPlaylistButton = name =>
    [...document.querySelectorAll('button[role="menuitem"], tp-yt-paper-item')].find(el => {
      if (!isVisible(el)) return false;
      const ariaLabel = el.getAttribute('aria-label') || '';
      const text = (el.textContent || '').trim();
      return ariaLabel.startsWith(`${name},`) || text === name;
    });

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
        await sleep(CONFIG.afterScrollWaitMs);

        const menuButton = await waitFor(() =>
          [...card.querySelectorAll('button')].find(
            btn => isVisible(btn) && (btn.getAttribute('aria-label') || '').includes(CONFIG.menuAriaLabel)
          )
        );

        if (!menuButton) {
          recordFailure(`Item #${processedIds.size} (${videoId}): Menu button not found`);
          continue;
        }

        menuButton.click();
        await sleep(CONFIG.afterMenuClickWaitMs);

        const saveMenuItem = await waitFor(() =>
          [
            ...document.querySelectorAll(
              '[role="menuitem"], tp-yt-paper-item, ytd-menu-service-item-renderer'
            ),
          ].find(el => isVisible(el) && (el.textContent || '').trim() === CONFIG.saveMenuText)
        );

        if (!saveMenuItem) {
          recordFailure(`Item #${processedIds.size} (${videoId}): "${CONFIG.saveMenuText}" option not found`);
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

        const isAlreadySaved = playlistButton.getAttribute('aria-pressed') === 'true';

        if (isAlreadySaved) {
          skippedCount++;
          consecutiveFailures = 0;
          console.log(`[SKIP] Item #${processedIds.size} (${videoId}): Already saved to "${CONFIG.playlistName}"`);
        } else {
          playlistButton.click();
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