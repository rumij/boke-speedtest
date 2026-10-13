/* Only trusted media and color values enter the existing layout. */
(() => {
  const root = document.documentElement;
  const applied = new Map();
  const blobs = new Map();
  let running = false;
  let enabled = true;
  let interval = 300000;
  let timer;
  let controller;
  let due = 0;

  const idle = () => !running && !document.hidden;
  function schedule() {
    clearTimeout(timer);
    if (enabled && idle()) timer = setTimeout(sync, Math.max(1000, due - Date.now()));
  }
  function suspend() {
    clearTimeout(timer);
    controller?.abort();
  }
  window.BokeTheme = {
    setRunning(value) {
      if (running === value) return;
      running = value;
      if (running) suspend(); else schedule();
    },
  };

  function mediaURL(asset) {
    if (!asset || !/^[a-f0-9]{20}$/.test(asset.revision)) throw new Error('Invalid asset revision');
    const url = new URL(asset.url);
    if (url.protocol !== 'https:' || !['png.pookcdn.net', 'www.boke.com'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('Invalid asset origin');
    url.searchParams.set('boke_v', asset.revision);
    return url.href;
  }

  // Keep white labels readable, even if the source changes to a pale accent.
  function readableAccent(hex) {
    if (!/^#[a-f0-9]{6}$/i.test(hex)) return null;
    let rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    const luminance = () => rgb.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    while (1.05 / (luminance() + .05) < 4.7) rgb = rgb.map(value => Math.floor(value * .94));
    return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function loadImage(url, signal) {
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', redirect: 'error' });
    if (!response.ok || !/^image\/(png|jpeg|webp|gif|x-icon|vnd.microsoft.icon)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Invalid image');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('Image too large'); }
      chunks.push(value);
    }
    const blob = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('content-type') }));
    try {
      const image = new Image();
      image.src = blob;
      await image.decode();
      if (signal.aborted || !idle() || image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error('Image deferred');
      return blob;
    } catch (error) {
      URL.revokeObjectURL(blob);
      throw error;
    }
  }

  async function apply(theme, signal) {
    if (!theme || !theme.assets || !idle()) return;
    const accent = readableAccent(theme.accent);
    if (accent) {
      root.style.setProperty('--red', accent);
      root.style.setProperty('--brand-text', accent);
      root.style.setProperty('--brand-highlight', theme.accent);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
    }
    for (const kind of ['poster', 'logo', 'icon']) {
      if (!idle() || signal.aborted) return;
      let blob;
      try {
        const url = mediaURL(theme.assets[kind]);
        if (applied.get(kind) === url) continue;
        blob = await loadImage(url, signal);
        if (kind === 'poster') {
          root.style.setProperty('--boke-poster', `url("${blob}")`);
          document.querySelector('#hero-video')?.setAttribute('poster', blob);
        } else if (kind === 'logo') {
          document.querySelectorAll('.boke-logo').forEach(image => { image.src = blob; });
        } else {
          const icon = document.querySelector('link[rel="icon"]');
          if (icon) { icon.removeAttribute('type'); icon.href = blob; }
        }
        if (blobs.has(kind)) URL.revokeObjectURL(blobs.get(kind));
        blobs.set(kind, blob);
        applied.set(kind, url);
      } catch (error) {
        if (signal.aborted) return;
        // Keep the currently displayed image or the bundled fallback.
      }
    }
    if (!idle() || signal.aborted) return;
    const video = document.querySelector('#hero-video');
    if (video) {
      try {
        const url = mediaURL(theme.assets.video);
        if (video.dataset.src !== url) {
          video.dataset.src = url;
          window.dispatchEvent(new Event('boke:video-changed'));
        }
      } catch (error) { /* Keep the existing video. */ }
    }
    root.dataset.themeUpdated = theme.updatedAt || '';
  }

  async function sync() {
    if (!enabled || !idle() || controller) return;
    controller = new AbortController();
    const current = controller;
    const timeout = setTimeout(() => current.abort(), 15000);
    due = Date.now() + interval;
    try {
      const response = await fetch('frontend/theme.php', { signal: current.signal, cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('Theme unavailable');
      const manifest = await response.json();
      if (!idle() || current.signal.aborted) return;
      if (manifest.enabled === false) { enabled = false; return; }
      interval = Math.max(60, Math.min(86400, Number(manifest.interval) || 300)) * 1000;
      due = Date.now() + interval;
      await apply(manifest.theme, current.signal);
    } catch (error) { /* A network outage never blocks the speed test. */ }
    finally {
      clearTimeout(timeout);
      controller = null;
      if (current.signal.aborted && running) due = 0;
      schedule();
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else schedule(); });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('DOMContentLoaded', schedule);
})();
