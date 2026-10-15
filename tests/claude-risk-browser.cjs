// Offline browser fixtures. Every third-party request is intercepted, never sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:18102');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const output = path.resolve('outputs/claude-risk');
fs.mkdirSync(output, { recursive: true });
const endpoint = '/backend/claude-risk.php';
const clean = {
  ip: '8.8.8.8', provider: 'ipapi.is', rule_version: 'boke-ip-v1', score: 100,
  known: 5, required: 5, level: 'low', label: '未命中所查风险', queried_at: '2026-10-15T00:00:00Z',
  country: '测试地区', city: '测试城市', asn: 'AS123', organization: '<img src=x onerror=alert(1)>',
  signals: { is_vpn: false, is_proxy: false, is_tor: false, is_abuser: false, is_datacenter: false, is_crawler: false },
  deductions: [{ name: '测试扣分项', points: 0, detail: '离线验证数据，不是对该 IP 的真实判断。' }],
};

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const checks = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    const page = await context.newPage();
    const errors = [];
    const outbound = [];
    const riskQueries = [];
    let mode = 'clean';
    let releaseHold;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.hostname === 'claude.ai') {
        outbound.push(request);
        if (mode === 'hold') await new Promise(resolve => { releaseHold = resolve; });
        if (mode === 'trace-fail') return route.abort();
        return route.fulfill({ contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'h=claude.ai\nip=8.8.8.8\nloc=US\n' });
      }
      if (url.origin !== base.origin) return route.abort();
      if (url.pathname === endpoint && request.method() === 'POST') {
        riskQueries.push(request.postDataJSON());
        if (mode === 'quota') return route.fulfill({ status: 429, json: { message: '测试：额度耗尽' } });
        if (mode === 'missing-key') return route.fulfill({ status: 503, json: { message: '测试：尚未配置 Key' } });
        if (mode === 'mismatch') return route.fulfill({ json: { ...clean, ip: '8.8.4.4' } });
        if (mode === 'malformed') return route.fulfill({ json: { ...clean, deductions: null } });
        if (mode === 'partial') return route.fulfill({ json: { ...clean, score: null, known: 4, level: 'unknown', signals: { ...clean.signals, is_vpn: null } } });
        return route.fulfill({ json: clean });
      }
      return route.continue();
    });
    await page.goto(new URL('/frontend/claude.html', base).href);
    await page.waitForFunction(() => document.querySelector('#risk-config').textContent.includes('尚未配置'));
    assert.equal(outbound.length, 0, 'No third-party calls on load');
    await page.locator('#risk-demo').click();
    assert.equal(await page.locator('#risk-score').innerText(), '65');
    assert.equal(await page.locator('#risk-demo-notice').isVisible(), true);
    assert.equal(outbound.length, 0, 'Demo does not query');
    await page.screenshot({ path: path.join(output, 'desktop-demo.png'), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No overflow at ${width}px`);
    }
    await page.screenshot({ path: path.join(output, 'mobile-demo.png'), fullPage: true });
    checks.push('no automatic probes; explicit sample; mobile 390/320');
    await page.setViewportSize({ width: 1440, height: 1080 });
    const detect = async () => {
      await page.locator('#risk-start').click();
      await page.waitForFunction(() => document.querySelector('#risk-results').getAttribute('aria-busy') === 'false');
    };
    await detect();
    assert.equal(await page.locator('#risk-score').innerText(), '100');
    assert.equal(await page.locator('#risk-demo-notice').isVisible(), false);
    assert.equal(await page.locator('#risk-organization img').count(), 0, 'Provider content treated as text');
    assert.equal(await page.locator('#risk-organization').innerText(), clean.organization);
    assert.deepEqual(riskQueries.at(-1), { ip: '8.8.8.8' });
    assert.equal(outbound.at(-1).headers().referer, undefined);
    assert.equal(outbound.at(-1).headers().cookie, undefined);
    checks.push('browser egress passed to backend; untrusted text safe; no cookies/referrer');
    for (const scenario of ['partial', 'mismatch', 'malformed', 'quota', 'missing-key', 'trace-fail']) {
      mode = scenario;
      const before = riskQueries.length;
      await detect();
      assert.equal(await page.locator('#risk-score').innerText(), '—', `${scenario} does not show stale/clean score`);
      if (scenario === 'trace-fail') assert.equal(riskQueries.length, before, 'No alternative-IP fallback');
      else assert.equal(riskQueries.length, before + 1, 'No automatic retries');
    }
    checks.push('partial, mismatch, malformed payload, quota, missing key and failed trace leave score empty');
    mode = 'hold';
    const beforeCancel = riskQueries.length;
    await page.locator('#risk-start').click();
    await page.waitForFunction(() => document.querySelector('#risk-results').getAttribute('aria-busy') === 'true');
    while (!releaseHold) await new Promise(resolve => setTimeout(resolve, 25));
    await page.locator('#risk-start').click();
    releaseHold();
    await page.waitForFunction(() => document.querySelector('#risk-results').getAttribute('aria-busy') === 'false');
    assert.equal(riskQueries.length, beforeCancel, 'Cancelled trace cannot start backend query');
    assert.equal(await page.locator('#risk-score').innerText(), '—');
    mode = 'clean';
    await page.locator('.manual-query summary').click();
    await page.locator('#risk-input').fill('8.8.8.8');
    const beforeManual = outbound.length;
    await page.locator('#risk-submit').click();
    await page.waitForFunction(() => document.querySelector('#risk-score').textContent === '100');
    assert.equal(outbound.length, beforeManual, 'Manual lookup does not query Claude');
    assert.equal(await page.locator('#risk-source').innerText(), '手动输入');
    checks.push('cancellation and manual provenance');
    // Actual local HTTP handler: no key, invalid IP, body/method guards. No provider traffic.
    const api = await context.request.get(new URL(endpoint, base).href);
    assert.equal((await api.json()).configured, false);
    for (const [ip, status] of [['8.8.8.8', 503], ['10.0.0.1', 400], ['::1', 400], [['8.8.8.8'], 400]]) {
      const result = await context.request.post(new URL(endpoint, base).href, { data: { ip } });
      assert.equal(result.status(), status);
    }
    assert.equal((await context.request.post(new URL(endpoint, base).href, { data: { ip: 'x'.repeat(600) } })).status(), 413);
    assert.equal((await context.request.delete(new URL(endpoint, base).href)).status(), 405);
    checks.push('real local handler rejects missing key/private IP/oversized body/method');
    // Homepage navigation regression, only same-origin assets are permitted.
    await page.goto(new URL('/index-modern.html', base).href);
    assert.equal(await page.locator('nav a[href="frontend/claude.html"]').count(), 1);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Homepage fits ${width}px`);
      assert.equal(await page.evaluate(() => document.querySelector('.site-header').getBoundingClientRect().bottom <= document.querySelector('.hero-copy .eyebrow').getBoundingClientRect().top), true, `Homepage header does not overlap hero at ${width}px`);
    }
    assert.deepEqual(errors, []);
    checks.push('homepage entry and widths; zero browser errors');
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
    console.log(JSON.stringify({ status: 'passed', checks }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
