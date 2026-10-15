'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const get = id => document.getElementById(id);
  const set = (id, value) => { get(id).textContent = value; };
  const endpoint = new URL('../backend/claude-risk.php', location.href);
  const policy = { version: 'boke-ip-v1', required: 5, trace: 'https://claude.ai/cdn-cgi/trace' };
  const names = { is_vpn: 'VPN', is_proxy: '公开代理', is_tor: 'Tor 出口', is_abuser: '该 IP 滥用标记', is_datacenter: '数据中心 / 机房', is_crawler: '爬虫网络（不扣分）' };
  let active = null;

  function canonicalIp(value) {
    if (typeof value !== 'string' || value.length > 45) return null;
    const text = value.trim();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) {
      const parts = text.split('.');
      return parts.every(part => String(Number(part)) === part && Number(part) <= 255) ? text : null;
    }
    if (!/^[0-9a-f:]+$/i.test(text) || !text.includes(':')) return null;
    try { return new URL(`https://[${text}]/`).hostname.slice(1, -1); } catch { return null; }
  }

  function signalRows(signals = {}) {
    const list = get('risk-signals');
    list.replaceChildren();
    for (const [key, name] of Object.entries(names)) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      const signal = signals[key];
      term.textContent = name;
      value.textContent = '未知';
      if (signal === true) value.textContent = '已命中';
      if (signal === false) value.textContent = '未命中';
      value.dataset.signal = String(signal);
      row.append(term, value);
      list.append(row);
    }
  }

  function reset() {
    set('risk-score', '—'); set('risk-label', '等待数据');
    set('risk-coverage', '5 项关键数据齐全后才给分，未知不按安全处理。');
    set('risk-provider', '尚未查询'); set('risk-time', '—'); set('risk-ip', '—');
    set('risk-source', '等待识别');
    set('risk-source-note', '自动检测以 claude.ai 的回显为准；不会用本站服务器的出口替代。');
    for (const field of ['country', 'city', 'asn', 'organization']) set(`risk-${field}`, '待检测');
    const card = document.querySelector('.score-card');
    card.dataset.level = 'unknown'; card.style.setProperty('--score-fill', '0%');
    signalRows();
    get('risk-deductions').replaceChildren();
    const text = document.createElement('p'); text.className = 'muted'; text.textContent = '数据齐全后展示本轮扣分；缺失不按零风险处理。';
    get('risk-deductions').append(text);
    get('risk-demo-notice').hidden = true;
  }

  function render(result, demo = false) {
    const score = result.score;
    set('risk-score', score === null ? '—' : String(score));
    set('risk-label', score === null ? '数据不足' : result.label);
    set('risk-coverage', `${result.known} / ${result.required} 项关键数据完整${score === null ? ' · 暂不评分' : ' · 仅评估 IP 风险信号'}`);
    set('risk-provider', demo ? '虚构演示数据' : `${result.provider}${result.cache_hit ? ' · 1 小时内缓存' : ' · 本次查询'}`);
    set('risk-time', demo ? '示例，无查询时间' : new Date(result.queried_at).toLocaleString('zh-CN', { hour12: false }));
    for (const field of ['country', 'city', 'asn', 'organization']) set(`risk-${field}`, result[field] || '数据源未提供');
    const card = document.querySelector('.score-card');
    card.dataset.level = result.level;
    card.style.setProperty('--score-fill', `${score ?? 0}%`);
    signalRows(result.signals);
    get('risk-deductions').replaceChildren();
    if (score === null) {
      const message = document.createElement('p'); message.className = 'muted';
      message.textContent = '关键标记不齐全，不能计算总分。请检查数据源权限或等待数据补齐。';
      get('risk-deductions').append(message);
      return;
    }
    for (const deduction of result.deductions) {
      const item = document.createElement('div'); item.className = 'deduction';
      const heading = document.createElement('div');
      const title = document.createElement('span'); title.textContent = deduction.name;
      const points = document.createElement('strong'); points.textContent = deduction.points ? `−${deduction.points} 分` : '未扣分';
      const text = document.createElement('p'); text.textContent = deduction.detail;
      heading.append(title, points); item.append(heading, text); get('risk-deductions').append(item);
    }
  }

  function busy(value) {
    get('risk-results').setAttribute('aria-busy', String(value));
    get('risk-start').textContent = value ? '停止检测' : '检测 Claude 出口 ↗';
    for (const id of ['risk-submit', 'risk-demo', 'risk-input']) get(id).disabled = value;
  }

  async function request(url, options, run, timeout) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    run.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeout);
    try {
      if (run.controller.signal.aborted) throw new Error('检测已停止。');
      const response = await fetch(url, { ...options, signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      const text = await response.text();
      if (text.length > 32768) throw new Error('检测响应格式异常，已停止评分。');
      return { response, text };
    } finally { clearTimeout(timer); run.controller.signal.removeEventListener('abort', abort); }
  }

  async function start(manual) {
    if (active) { active.controller.abort(); return; }
    const run = { controller: new AbortController() };
    active = run; reset(); busy(true);
    try {
      let ip;
      if (manual !== undefined) {
        ip = canonicalIp(manual);
        if (!ip) throw new Error('请输入有效的公网 IPv4 或 IPv6 地址。');
        set('risk-source', '手动输入');
        set('risk-source-note', '此地址由你输入，尚未验证为 Claude 实际出口。');
      } else {
        set('risk-status', '正在从当前浏览器读取 Claude 出口…');
        const { response, text } = await request(policy.trace, {}, run, 8000);
        if (!response.ok) throw new Error('Claude 出口回显不可用，可展开手动查询。不会改用其他线路冒充。');
        const fields = Object.fromEntries(text.trim().split('\n').map(line => {
          const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim()];
        }));
        ip = canonicalIp(fields.ip);
        if (!ip || fields.h !== 'claude.ai') throw new Error('未取得有效的 Claude 出口回显，可使用手动 IP 查询。');
        set('risk-source', 'Claude 浏览器出口');
        set('risk-source-note', '来自本浏览器此次 claude.ai 回显；不代表 Claude Code 或 API 的线路。');
      }
      if (run.controller.signal.aborted) throw new Error('检测已停止。');
      set('risk-ip', ip); set('risk-status', '出口已确定，正在查询 IP 风险信号…');
      const { response, text } = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip }) }, run, 11000);
      let result;
      try { result = JSON.parse(text); } catch { throw new Error('评分后端未返回有效数据，请检查站点部署。'); }
      if (!response.ok) throw new Error(result.message || '评分服务暂不可用，请稍后手动重试。');
      if (canonicalIp(result.ip) !== ip || result.rule_version !== policy.version || !result.signals || !Array.isArray(result.deductions) ||
          (result.score !== null && (!Number.isInteger(result.score) || result.score < 0 || result.score > 100 || result.known !== policy.required || result.required !== policy.required))) {
        throw new Error('返回的 IP 或评分数据不匹配，已停止评分。');
      }
      if (active !== run || run.controller.signal.aborted) throw new Error('检测已停止。');
      render(result);
      set('risk-status', result.score === null ? '数据源未提供完整风险标记，本轮没有生成总分。' : '检测完成。请结合下方扣分依据阅读结果。');
    } catch (error) {
      if (active === run) {
        set('risk-score', '—');
        set('risk-label', '暂无评分');
        document.querySelector('.score-card').dataset.level = 'unknown';
        document.querySelector('.score-card').style.setProperty('--score-fill', '0%');
        let message = error.message;
        if (error instanceof TypeError) message = '网络请求未完成，可能是跨域、网络或服务限制。可稍后重试或手动查询 IP。';
        if (error.name === 'AbortError') message = '检测超时，未生成评分；可稍后手动重试。';
        if (run.controller.signal.aborted) message = '检测已停止，未生成本轮评分。';
        set('risk-status', message);
      }
    } finally { if (active === run) { active = null; busy(false); } }
  }

  get('risk-start').addEventListener('click', () => start());
  get('risk-form').addEventListener('submit', event => { event.preventDefault(); start(get('risk-input').value); });
  window.addEventListener('pagehide', () => { active?.controller.abort(); });
  get('risk-demo').addEventListener('click', () => {
    reset();
    get('risk-demo-notice').hidden = false;
    set('risk-ip', '虚构的 VPN 机房出口'); set('risk-source', '演示样例');
    set('risk-source-note', '此样例没有发起网络查询；点击“检测 Claude 出口”可退出演示。');
    render({ score: 65, known: 5, required: 5, label: '存在风险信号', level: 'medium',
      country: '示例地区', city: '示例城市', asn: '示例 ASN', organization: '示例网络组织',
      signals: { is_vpn: true, is_proxy: false, is_tor: false, is_abuser: false, is_datacenter: true, is_crawler: false },
      deductions: [
        { name: '匿名网络标记', points: 20, detail: '命中 VPN −20；没有代理或 Tor 标记。' },
        { name: '该 IP 的滥用标记', points: 0, detail: '示例中未命中 IP 滥用标记。' },
        { name: '数据中心标记', points: 15, detail: '示例中命中数据中心标记 −15；100 − 20 − 15 = 65。' },
      ] }, true);
    set('risk-status', '正在展示规则示例，不代表你当前网络的结果。');
  });
  signalRows();
  // Only a same-origin readiness request runs on load; no automatic third-party probes.
  async function checkConfig() {
    try {
      const response = await fetch(endpoint, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Config unavailable');
      const config = await response.json();
      if (config.configured === true) get('risk-config').hidden = true;
      else set('risk-config', '评分数据源尚未配置。可先识别 Claude 出口或查看评分示例；管理员接入免费 ipapi.is Key 后即可获取真实分数。');
    } catch { set('risk-config', '评分后端暂不可用。可以查看评分示例，或请管理员检查部署。'); }
  }
  checkConfig();
});
