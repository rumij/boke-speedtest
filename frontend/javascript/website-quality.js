/* Browser-to-website samples. An opaque HTTP response is not proof of service health. */
window.addEventListener('DOMContentLoaded', () => {
  const section = document.querySelector('#website-quality');
  if (!section) return;
  const button = section.querySelector('#quality-recheck');
  const summary = section.querySelector('#quality-summary');
  const cards = [...section.querySelectorAll('[data-website]')];
  const SAMPLE_COUNT = 3;
  const TIMEOUT_MS = 4000;
  const GAP_MS = 800;
  let active = null;
  let autoPending = true;
  let autoTimer;

  const measuring = () => typeof testState !== 'undefined' && testState.state === RUNNING;
  const field = (card, name, value) => { card.querySelector(`[data-quality="${name}"]`).textContent = value; };

  function render(row, state) {
    const values = row.samples.filter(sample => sample.kind === 'response').map(sample => sample.ms).sort((a, b) => a - b);
    const count = values.length;
    const mid = Math.floor(count / 2);
    let median = null;
    if (count) median = count % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    field(row.card, 'duration', median === null ? '未测得' : `${median.toFixed(0)} ms`);
    field(row.card, 'variation', count < 2 ? '样本不足' : `${(values[count - 1] - values[0]).toFixed(0)} ms`);
    field(row.card, 'responses', `${count} / ${row.samples.length}`);
    field(row.card, 'timeouts', String(row.samples.filter(sample => sample.kind === 'timeout').length));
    field(row.card, 'failures', String(row.samples.filter(sample => sample.kind === 'uncompleted').length));
    let label = state === 'running' ? `检测中 ${row.samples.length}/${SAMPLE_COUNT}` : '已暂停';
    if (state === 'finished') {
      label = count ? '部分未完成' : '未收到响应';
      if (count === SAMPLE_COUNT) label = '收到响应';
    }
    field(row.card, 'state', label);
    row.card.dataset.state = state;
    if (state === 'finished') row.card.dataset.state = count === SAMPLE_COUNT ? 'responded' : 'incomplete';
  }

  function gap(signal) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, GAP_MS);
      if (signal.aborted) done(); else signal.addEventListener('abort', done, { once: true });
    });
  }

  async function probe(target, signal) {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
    const start = performance.now();
    try {
      const url = new URL(target);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('HTTPS target required');
      url.searchParams.set('boke_quality', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await fetch(url.href, {
        method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      return signal.aborted ? null : { kind: 'response', ms: performance.now() - start };
    } catch (error) {
      return signal.aborted ? null : { kind: timedOut ? 'timeout' : 'uncompleted' };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }

  function stop(message) {
    if (!active) return;
    const previous = active;
    active = null;
    previous.controller.abort();
    previous.rows.forEach(row => render(row, row.samples.length === SAMPLE_COUNT ? 'finished' : 'paused'));
    section.dataset.state = 'paused';
    summary.textContent = message;
    button.textContent = '重新检测';
    window.BokeTheme?.setQualityRunning(false);
  }

  async function start() {
    if (active || measuring() || document.hidden) return;
    if (!window.BokeTheme) { summary.textContent = '检测暂不可用，请刷新页面后重试。'; return; }
    autoPending = false;
    clearTimeout(autoTimer);
    const run = { controller: new AbortController(), rows: cards.map(card => ({ card, samples: [] })) };
    active = run;
    section.dataset.state = 'running';
    summary.textContent = '从当前设备发起检测，每个网站 3 次，单次最多等待 4 秒。';
    button.textContent = '停止检测';
    window.BokeTheme.setQualityRunning(true);
    run.rows.forEach(row => render(row, 'running'));
    try {
      // Two fixed targets, at most two small HEAD requests in flight. No page bodies downloaded.
      await Promise.all(run.rows.map(async row => {
        for (let index = 0; index < SAMPLE_COUNT; index++) {
          if (active !== run || run.controller.signal.aborted) return;
          const result = await probe(row.card.dataset.url, run.controller.signal);
          if (!result || active !== run) return;
          row.samples.push(result);
          render(row, index === SAMPLE_COUNT - 1 ? 'finished' : 'running');
          if (index < SAMPLE_COUNT - 1) await gap(run.controller.signal);
        }
      }));
      if (active !== run) return;
      section.dataset.state = 'finished';
      summary.textContent = `本轮完成 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · 结果来自此设备，点击可重新检测。`;
    } catch (error) {
      if (active === run) stop('本轮检测未完成，可以重新检测。');
    } finally {
      if (active === run) {
        active = null;
        button.textContent = '重新检测';
        window.BokeTheme.setQualityRunning(false);
      }
    }
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (autoPending && !document.hidden && !measuring()) autoTimer = setTimeout(start, 500);
  }
  button.addEventListener('click', () => {
    if (active) stop('本轮检测已停止，已完成的样本保留。'); else start();
  });
  window.addEventListener('boke:measurement', event => {
    button.disabled = event.detail.running;
    if (event.detail.running) {
      autoPending = false;
      clearTimeout(autoTimer);
      stop('已暂停网站检测，优先完成网络测速。测速结束后可重新检测。');
      if (section.dataset.state === 'waiting') summary.textContent = '正在进行网络测速，结束后可点击检测网站。';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(autoTimer); stop('页面已切换，检测暂停。返回后可重新检测。'); }
    else scheduleAuto();
  });
  window.addEventListener('pagehide', () => { clearTimeout(autoTimer); stop('检测已暂停，可重新检测。'); });
  window.addEventListener('pageshow', scheduleAuto);
  scheduleAuto();
});
