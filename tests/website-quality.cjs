// Browser-side fixtures; never sends test traffic to the real target websites.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:18090');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const siteHosts = new Set(['www.baidu.com', 'www.deepseek.com']);

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await context.addCookies([{ name: 'quality_fixture', value: 'must-not-be-sent', domain: '.baidu.com', path: '/', secure: true, sameSite: 'None' }]);
    const page = await context.newPage();
    const errors = [];
    const probes = [];
    let mode = 'response';
    const held = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/frontend/theme.php') return route.fulfill({ json: { enabled: false } });
      if (siteHosts.has(url.hostname)) {
        probes.push({ url: url.href, method: request.method(), headers: request.headers() });
        if (mode === 'hold' || (mode === 'failure' && url.hostname === 'www.deepseek.com')) {
          return new Promise(resolve => held.push(async () => { await route.abort().catch(() => {}); resolve(); }));
        }
        if (mode === 'failure') return route.abort();
        // Even a 403 resolves as an opaque response. It must NEVER be called service health.
        return route.fulfill({ status: url.hostname === 'www.baidu.com' ? 403 : 200, body: '' });
      }
      return url.origin === base.origin ? route.continue() : route.abort();
    });
    await page.goto(new URL('/index-modern.html', base).href);
    await page.waitForFunction(() => document.querySelector('#website-quality').dataset.state === 'running');
    assert.equal(await page.locator('#hero-video').getAttribute('src'), null, 'Background video stopped for website checks');
    assert.equal(await page.evaluate(() => window.BokeTheme.busy), true);
    const geometry = () => page.evaluate(() => ['.site-header', '.hero-content', '.test-panel'].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [selector, rect.x, rect.y, rect.width, rect.height];
    }));
    const before = await geometry();
    await page.waitForFunction(() => document.querySelector('#website-quality').dataset.state === 'finished');
    assert.deepEqual(await geometry(), before, 'Original hero geometry unchanged');
    assert.equal(probes.length, 6, 'Exactly one automatic round, three per website');
    for (const request of probes) {
      assert.equal(request.method, 'HEAD');
      assert.equal(request.headers.cookie, undefined);
      assert.equal(request.headers.referer, undefined);
    }
    for (const name of ['baidu', 'deepseek']) {
      const card = page.locator(`[data-website="${name}"]`);
      assert.equal(await card.locator('[data-quality="state"]').innerText(), '收到响应');
      assert.equal(await card.locator('[data-quality="responses"]').innerText(), '3 / 3');
      assert.match(await card.locator('[data-quality="duration"]').innerText(), /^\d+ ms$/);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No mobile overflow');

    mode = 'failure';
    await page.locator('#quality-recheck').click();
    await page.waitForFunction(() => document.querySelector('#website-quality').dataset.state === 'finished', null, { timeout: 20000 });
    assert.equal(await page.locator('[data-website="baidu"] [data-quality="failures"]').innerText(), '3');
    assert.equal(await page.locator('[data-website="deepseek"] [data-quality="timeouts"]').innerText(), '3');
    assert.equal(await page.locator('[data-website="deepseek"] [data-quality="duration"]').innerText(), '未测得');
    await Promise.all(held.splice(0).map(release => release()));

    mode = 'hold';
    await page.locator('#quality-recheck').click();
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      for (const [name, value] of Object.entries({ getIp_ispInfo: false, time_dl_max: 2, time_ul_max: 2, count_ping: 4 })) testState.speedtest.setParameter(name, value);
    });
    await page.locator('#start-button').click();
    await page.waitForFunction(() => testState.state === RUNNING);
    assert.equal(await page.locator('#website-quality').getAttribute('data-state'), 'paused');
    assert.equal(await page.locator('#quality-recheck').isDisabled(), true);
    assert.equal(await page.locator('#hero-video').getAttribute('src'), null);
    assert.equal(await page.locator('[data-website="baidu"] [data-quality="responses"]').innerText(), '0 / 0', 'Cancelled requests are not failures');
    const countDuringTest = probes.length;
    await Promise.all(held.splice(0).map(release => release()));
    await page.waitForFunction(() => testState.state === FINISHED, null, { timeout: 45000 });
    assert.equal(probes.length, countDuringTest, 'No site probes during speed measurement');
    assert.equal(await page.locator('#quality-recheck').isEnabled(), true);

    // Hidden tabs cancel work without inflating timeout/failure counts.
    await page.locator('#quality-recheck').click();
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#website-quality').getAttribute('data-state'), 'paused');
    assert.equal(await page.locator('[data-website="baidu"] [data-quality="failures"]').innerText(), '0');
    await Promise.all(held.splice(0).map(release => release()));
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    mode = 'response';
    await page.locator('#quality-recheck').click();
    await page.waitForFunction(() => document.querySelector('#website-quality').dataset.state === 'finished');
    assert.equal(await page.locator('[data-website="baidu"] [data-quality="responses"]').innerText(), '3 / 3', 'Clean recheck after cancellation');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', automaticRequests: 6, checks: ['opaque 403 is not called healthy', 'HEAD without cookies/referrer', 'timeouts versus failures', 'unchanged hero geometry', 'mobile layout', 'speedtest priority', 'hidden-tab cancellation', 'manual recheck'], browserErrors: errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
