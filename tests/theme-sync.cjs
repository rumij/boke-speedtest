// Local fixtures only: no network traffic to the official site during tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:18090');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const image = fs.readFileSync(require('node:path').join(__dirname, '../frontend/images/boke/logo.png'));
const theme = {
  accent: '#ffffaa', updatedAt: 'fixture-2',
  assets: Object.fromEntries(['video', 'poster', 'logo', 'icon'].map(kind => [kind, { url: `https://png.pookcdn.net/${kind}.${kind === 'video' ? 'mp4' : 'png'}`, revision: 'a'.repeat(20) }])),
};
const rectangles = page => page.evaluate(() => [...document.querySelectorAll('.site-header, .boke-logo, .hero-content, .test-panel, .gauge, .guide, .stability-shell, .stability-grid, .stability-main, .stability-aside')].map(element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return [element.className, x, y, width, height];
}));

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    for (const file of ['index-modern.html', 'stability.html']) {
      for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let releaseManifest;
        let mediaRequests = 0;
        await page.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/frontend/theme.php') {
            await new Promise(resolve => { releaseManifest = resolve; });
            return route.fulfill({ json: { enabled: true, interval: 60, theme } });
          }
          if (url.hostname === 'png.pookcdn.net') {
            mediaRequests++;
            return route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: image });
          }
          return url.origin === base.origin ? route.continue() : route.abort();
        });
        await page.goto(new URL(file, base).href);
        await page.waitForFunction(() => document.querySelector('#startBtn') ? !document.querySelector('#startBtn').disabled : testState.state === READY);
        await page.waitForFunction(() => document.querySelector('.boke-logo').complete);
        const before = await rectangles(page);
        while (!releaseManifest) await page.waitForTimeout(50);
        releaseManifest();
        await page.waitForFunction(() => document.documentElement.dataset.themeUpdated === 'fixture-2');
        assert.deepEqual(await rectangles(page), before, `${file} ${width}: layout unchanged`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(mediaRequests, 3, 'Only three images loaded, no video under reduced motion');
        assert.match(await page.locator('.boke-logo').getAttribute('src'), /^blob:/);
        assert.match(await page.locator('link[rel="icon"]').getAttribute('href'), /^blob:/);
        const color = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--red').trim());
        const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        assert.ok(1.05 / (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 + .05) >= 4.5, 'Readable white button labels');
        // A poll due during a real measurement must wait until it stops.
        await page.clock.install();
        if (file === 'index-modern.html') {
          await page.evaluate(() => { testState.speedtest.setParameter('getIp_ispInfo', false); testState.speedtest.setParameter('time_dl_max', 20); });
        }
        const button = page.locator(file === 'index-modern.html' ? '#start-button' : '#startBtn');
        releaseManifest = null;
        await button.click();
        await page.clock.fastForward(61000);
        assert.equal(releaseManifest, null, 'No sync request while measuring');
        assert.equal(mediaRequests, 3, 'No image requests while measuring');
        await button.click();
        assert.deepEqual(errors, [], `${file}: browser errors`);
        await page.close();
      }
    }
    // A late manifest cannot change the theme after a measurement has begun.
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    let release;
    await page.route('**/frontend/theme.php', async route => {
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: { enabled: true, interval: 60, theme } }).catch(() => {});
    });
    await page.goto(new URL('stability.html', base).href);
    await page.waitForFunction(() => !document.querySelector('#startBtn').disabled);
    while (!release) await page.waitForTimeout(50);
    await page.locator('#startBtn').click();
    release();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.themeUpdated), undefined);
    assert.ok(await page.evaluate(() => running));
    await page.locator('#startBtn').click();
    await page.close();
    // Failed CDN images and a broken movie keep readable, bundled fallbacks.
    const fallback = await browser.newPage();
    await fallback.route('**/frontend/theme.php', route => route.fulfill({ json: { enabled: true, interval: 300, theme } }));
    await fallback.route('https://png.pookcdn.net/**', route => route.abort());
    await fallback.goto(new URL('index-modern.html', base).href);
    await fallback.waitForFunction(() => document.documentElement.dataset.themeUpdated === 'fixture-2');
    await fallback.waitForFunction(() => document.querySelector('video').dataset.src === 'frontend/images/boke/hero.mp4');
    assert.equal(await fallback.locator('.boke-logo').getAttribute('src'), 'frontend/images/boke/logo.png');
    assert.match(await fallback.locator('link[rel="icon"]').getAttribute('href'), /^favicon.ico/);
    assert.equal(await fallback.evaluate(() => document.documentElement.style.getPropertyValue('--boke-poster')), '');
    await fallback.close();
    console.log('Theme sync: desktop/mobile geometry, contrast, reduced motion, measurement isolation and CDN outage passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
