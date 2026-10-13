// Smoke-test the actual release container, using only local endpoints.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:18090');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Release checks must target a local container');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    for (const path of ['/backend/empty.php', '/favicon.ico', '/manifest.webmanifest', '/frontend/images/boke/logo.png', '/frontend/images/boke/hero-poster.jpg']) {
      const response = await page.request.get(new URL(path, base).href);
      assert.equal(response.status(), 200, path);
    }
    // The default route must select the customized homepage.
    await page.goto(base.href);
    await page.waitForURL('**/index-modern.html*');
    await page.waitForFunction(() => testState.state === READY);
    assert.match(await page.title(), /波克/);
    for (const selector of ['#download-speed', '#upload-speed', '#ping', '#jitter']) {
      assert.equal(await page.locator(selector).innerText(), '0.00', selector);
    }
    assert.equal(await page.locator('.site-header .header-pill').count(), 0);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'homepage overflow');
    }
    // Disable remote ISP lookup and keep this local test short.
    await page.evaluate(() => {
      for (const [key, value] of Object.entries({ getIp_ispInfo: false, time_dl_max: 2, time_ul_max: 2, count_ping: 4 })) {
        testState.speedtest.setParameter(key, value);
      }
    });
    // An immediate abort must cancel the initial IP request safely.
    await page.evaluate(() => { document.querySelector('#start-button').click(); document.querySelector('#start-button').click(); });
    await page.waitForFunction(() => testState.state === READY);
    await page.locator('#start-button').click();
    await page.waitForFunction(() => testState.state === RUNNING);
    assert.equal(await page.locator('#hero-video').getAttribute('src'), null);
    await page.waitForFunction(() => testState.state === FINISHED, null, { timeout: 45000 });
    for (const selector of ['#download-speed', '#upload-speed', '#ping']) {
      assert.ok(Number(await page.locator(selector).innerText()) > 0, selector);
    }
    assert.equal(await page.locator('#download-gauge .measurement-state').innerText(), '已完成');
    const readings = await page.evaluate(() => ({ download: testState.testData.dlStatus, upload: testState.testData.ulStatus, ping: testState.testData.pingStatus }));
    await page.locator('#start-button').click();
    await page.waitForFunction(() => testState.state === RUNNING);
    await page.locator('#start-button').click();
    await page.waitForFunction(() => testState.state === READY);
    await page.waitForFunction(() => document.querySelector('#download-speed').textContent === '0.00');
    await page.goto(new URL('/stability.html', base).href);
    await page.waitForFunction(() => !document.querySelector('#startBtn').disabled);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'stability overflow');
    }
    await page.evaluate(() => {
      const select = document.querySelector('#durationSelect');
      select.add(new Option('2 seconds (release check)', '2'));
      select.value = '2';
    });
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => running);
    await page.waitForFunction(() => !running && allPingData.length > 0, null, { timeout: 15000 });
    const samples = await page.evaluate(() => allPingData.length);
    assert.deepEqual(errors, [], 'browser errors');
    console.log(JSON.stringify({ result: 'passed', scope: 'local standalone container', readings, stabilitySamples: samples, browserErrors: errors }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
