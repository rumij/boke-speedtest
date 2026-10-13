/* The visual layer never creates speed measurements; LibreSpeed owns the test. */
window.addEventListener("DOMContentLoaded", () => {
  const video = document.querySelector("#hero-video");
  const startButton = document.querySelector("#start-button");
  const motionToggle = document.querySelector("#motion-toggle");
  const status = document.querySelector("#test-status-text");
  const selector = document.querySelector(".server-selector");
  const chosen = selector.querySelector(".chosen");
  const servers = selector.querySelector(".servers");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let pausedByUser = false;
  let previousState = null;

  function stopBackground() {
    video.pause();
    // Pausing alone still allows media buffering; removing src stops its traffic.
    video.removeAttribute("src");
    video.load();
  }

  function playBackground() {
    if (pausedByUser || reducedMotion.matches || document.hidden || testState.state === RUNNING) return;
    if (!video.hasAttribute("src")) video.src = video.dataset.src;
    video.play().catch(() => {}); // Static poster remains available if autoplay fails.
  }

  // Stop media requests before the speed test's click handler launches its worker.
  startButton.addEventListener("click", () => {
    if (testState.state === READY || testState.state === FINISHED) stopBackground();
  }, { capture: true });

  motionToggle.addEventListener("click", () => {
    pausedByUser = !pausedByUser;
    motionToggle.setAttribute("aria-pressed", String(pausedByUser));
    motionToggle.setAttribute("aria-label", pausedByUser ? "播放背景动画" : "暂停背景动画");
    motionToggle.textContent = pausedByUser ? "▷" : "Ⅱ";
    if (pausedByUser) stopBackground(); else playBackground();
  });

  function syncState() {
    const running = testState.state === RUNNING;
    document.body.classList.toggle("test-running", running);
    motionToggle.disabled = running || reducedMotion.matches;
    chosen.disabled = running || selector.classList.contains("single-server") || testState.state === INITIALIZING;
    chosen.setAttribute("aria-expanded", String(servers.classList.contains("active") && !running));
    if (running && servers.classList.contains("active")) servers.classList.remove("active");
    if (previousState !== testState.state) {
      if (running) stopBackground(); else playBackground();
      previousState = testState.state;
    }
    const phases = { 1: "正在测试下载速度", 2: "正在测量延迟与抖动", 3: "正在测试上传速度" };
    const idle = testState.testData?.testState === 5 ? "本次测试已停止" : "准备就绪，点击开始";
    const failed = ["dlStatus", "ulStatus", "pingStatus", "jitterStatus"].some((key) => testState.testData?.[key] === "Fail");
    const finished = failed ? "测速结束 · 部分项目未完成" : "测速完成 · 结果已更新";
    const labels = ["正在准备测速", idle, phases[testState.testData?.testState] || "正在建立测速连接", finished];
    const text = testState.initializationError || labels[testState.state];
    if (status.textContent !== text) status.textContent = text;
  }
  const observer = new MutationObserver(syncState);
  observer.observe(startButton, { childList: true, attributes: true, attributeFilter: ["class", "disabled", "data-phase"] });
  observer.observe(selector, { attributes: true, attributeFilter: ["class"] });
  observer.observe(servers, { attributes: true, attributeFilter: ["class"] });
  // Escape closes the node picker; links remain keyboard-focusable.
  selector.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      servers.classList.remove("active");
      chosen.focus();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopBackground(); else playBackground();
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) stopBackground(); else playBackground();
    syncState();
  });
  syncState();
});
