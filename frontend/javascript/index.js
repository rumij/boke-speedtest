/**
 * Design by fromScratch Studio - 2022, 2023 (fromscratch.io)
 * Implementation in HTML/CSS/JS by Timendus - 2024 (https://github.com/Timendus)
 *
 * See https://github.com/librespeed/speedtest/issues/585
 */

// States the UI can be in
const INITIALIZING = 0;
const READY = 1;
const RUNNING = 2;
const FINISHED = 3;

// Keep some global state here
const testState = {
  state: INITIALIZING,
  speedtest: null,
  servers: [],
  initialGaugeScrollPending: false,
  initialGaugeScrollScheduled: false,
  selectedServerDirty: false,
  testData: null,
  testDataDirty: false,
  telemetryEnabled: false,
  initializationError: "",
};

// Bootstrap the application when the DOM is ready
window.addEventListener("DOMContentLoaded", async () => {
  createSpeedtest();
  hookUpButtons();
  startRenderingLoop();
  await applySettingsJSON();
  await applyServerListJSON();
});

/**
 * Create a new Speedtest and hook it into the global state
 */
function createSpeedtest() {
  testState.speedtest = new Speedtest();
  testState.speedtest.onupdate = (data) => {
    testState.testData = data;
    testState.testDataDirty = true;
  };
  testState.speedtest.onend = (aborted) =>
    (testState.state = aborted ? READY : FINISHED);
}

/**
 * Make all the buttons respond to the right clicks
 */
function hookUpButtons() {
  document
    .querySelector("#start-button")
    .addEventListener("click", startButtonClickHandler);
  document
    .querySelector("#choose-privacy")
    .addEventListener("click", () =>
      document.querySelector("#privacy").showModal()
    );
  document
    .querySelector("#share-results")
    .addEventListener("click", () =>
      document.querySelector("#share").showModal()
    );
  document
    .querySelector("#copy-link")
    .addEventListener("click", copyLinkButtonClickHandler);
  document
    .querySelectorAll(".close-dialog, #close-privacy")
    .forEach((element) => {
      element.addEventListener("click", () =>
        document.querySelectorAll("dialog").forEach((modal) => modal.close())
      );
    });
}

/**
 * Event listener for clicks on the main start button
 */
function startButtonClickHandler() {
  switch (testState.state) {
    case READY:
    case FINISHED:
      testState.speedtest.start();
      // Clear the previous run so pending measurements are not shown as new results.
      testState.testData = {
        testState: -1, dlStatus: "", ulStatus: "", pingStatus: "", jitterStatus: "",
        dlProgress: 0, ulProgress: 0,
      };
      testState.testDataDirty = true;
      testState.initialGaugeScrollPending = true;
      testState.state = RUNNING;
      return;
    case RUNNING:
      testState.speedtest.abort();
      // testState.state is updated by `onend` handler of speedtest
      return;
    default:
      return;
  }
}

/**
 * Scroll the initial download gauge into view on narrow viewports when starting a test
 */
function scrollInitialDownloadGaugeIntoView() {
  if (!window.matchMedia("(max-width: 800px)").matches) {
    return;
  }

  const downloadGauge = document.querySelector("#download-gauge");
  if (!downloadGauge) {
    return;
  }

  const { top, bottom } = downloadGauge.getBoundingClientRect();
  if (top >= 0 && bottom <= window.innerHeight) {
    return;
  }

  downloadGauge.scrollIntoView({
    block: "center",
    inline: "nearest",
  });
}

/**
 * Event listener for clicks on the "Copy link" button in the modal
 */
async function copyLinkButtonClickHandler() {
  const link = document.querySelector("img#results").src;
  const button = document.querySelector("#copy-link");
  const chinese = document.documentElement.lang.startsWith("zh");
  try {
    await navigator.clipboard.writeText(link);
    button.classList.add("active");
    button.textContent = chinese ? "已复制" : "Copied!";
  } catch {
    button.textContent = chinese ? "复制失败，请重试" : "Copy failed, try again";
  }
  setTimeout(() => {
    button.classList.remove("active");
    button.textContent = chinese ? "复制链接" : "Copy link";
  }, 3000);
}

/**
 * Load settings from settings.json on the server and apply them
 */
async function applySettingsJSON() {
  try {
    const response = await fetch("settings.json");
    const settings = await response.json();
    if (!settings || typeof settings !== "object") {
      return console.error("Settings are empty or malformed");
    }
    for (let setting in settings) {
      testState.speedtest.setParameter(setting, settings[setting]);
      if (
        setting == "telemetry_level" &&
        settings[setting] &&
        settings[setting] != "off" &&
        settings[setting] != "disabled" &&
        settings[setting] != "false"
      ) {
        testState.telemetryEnabled = true;
        document.querySelector("#privacy-warning").classList.remove("hidden");
      }
    }
  } catch (error) {
    console.error("Failed to fetch settings:", error);
  }
}

/**
 * Load server list from the configured source and populate the dropdown
 */
async function applyServerListJSON() {
  try {
    const serverSource =
      typeof globalThis.SPEEDTEST_SERVERS !== "undefined"
        ? globalThis.SPEEDTEST_SERVERS
        : "server-list.json";
    const servers = Array.isArray(serverSource)
      ? serverSource
      : await fetch(serverSource).then((response) => response.json());
    if (!servers || !Array.isArray(servers) || servers.length === 0) {
      reportServerListError("节点列表为空或格式不正确，请检查服务配置后刷新页面。");
      return;
    }

    testState.servers = servers;

    // If there's only one server, just show it. No reachability checks needed.
    if (servers.length === 1) {
      populateDropdown(servers);
      return;
    }

    // For multiple servers: first run the built-in selection (which pings servers
    // and annotates them with pingT). Only then populate the dropdown so that
    // dead servers don't appear.
    testState.speedtest.addTestPoints(servers);
    testState.speedtest.selectServer((bestServer) => {
      const aliveServers = testState.servers.filter((s) => {
        // Keep servers that responded to ping (pingT !== -1).
        if (s.pingT !== -1) return true;
        // Also keep protocol-relative servers ("//...") as a defensive fallback.
        // LibreSpeed normalizes them to the page protocol before pinging, so they
        // are normally treated like any other server and get a real pingT value.
        return typeof s.server === "string" && s.server.startsWith("//");
      });

      // Prefer to show only reachable servers, but if none are reachable,
      // fall back to the full list so users can still pick a server manually.
      if (aliveServers.length > 0) {
        testState.servers = aliveServers;
      }
      populateDropdown(testState.servers);


      if (bestServer) {
        selectServer(bestServer);
      } else {
        alert(
          "Can't reach any of the speedtest servers! But you're on this page. Something weird is going on with your network."
        );
      }
    });
  } catch (error) {
    console.error("Failed to load server list:", error);
    reportServerListError("无法加载测速节点，请检查服务配置后刷新页面。");
  }
}

function reportServerListError(message) {
  testState.initializationError = message;
  document.querySelector("#selected-server").textContent = message;
}

/**
 * Add all the servers to the server selection dropdown and make it actually
 * work.
 * @param {Array} servers - an array of server objects
 */
function populateDropdown(servers) {
  const serverSelector = document.querySelector("div.server-selector");
  const serverList = serverSelector.querySelector("ul.servers");

  // Reset previous state (populateDropdown can be called multiple times)
  serverSelector.classList.remove("single-server");
  serverSelector.classList.remove("active");
  serverList.classList.remove("active");
  serverList.innerHTML = "";

  // If we have only a single server, just show it
  if (servers.length === 1) {
    serverSelector.classList.add("single-server");
    selectServer(servers[0]);
    return;
  }
  serverSelector.classList.add("active");

  // Make the dropdown open and close (hook only once)
  if (serverSelector.dataset.hooked !== "1") {
    serverSelector.dataset.hooked = "1";

    serverSelector.addEventListener("click", () => {
      serverList.classList.toggle("active");
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("div.server-selector") !== serverSelector)
        serverList.classList.remove("active");
    });
  }

  // Sort servers by country, then by city within the same country.
  // Name formats: "City, Country", "City, Country (qualifier)", "City, Country, Provider", "Country"
  const parseServerName = (name) => {
    const parts = (name || "").split(",").map((s) => s.trim());
    let country, city;
    if (parts.length >= 3) {
      // "City, Country, Provider" — use second part as country
      country = parts[1];
      city = parts[0];
    } else if (parts.length === 2) {
      country = parts[1];
      city = parts[0];
    } else {
      country = parts[0];
      city = "";
    }
    // Strip parenthetical qualifiers for sorting: "Germany (1) (Hetzner)" → "Germany"
    country = country.replace(/\s*\([^)]*\)\s*/g, "").trim();
    return { country, city };
  };
  const sorted = [...servers].sort((a, b) => {
    const pa = parseServerName(a.name);
    const pb = parseServerName(b.name);
    return pa.country.localeCompare(pb.country) || pa.city.localeCompare(pb.city);
  });

  // Populate the list to choose from
  sorted.forEach((server) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = server.name;
    if (server.sponsorName) {
      const sponsorLabel = document.createElement("span");
      sponsorLabel.textContent = ` (${server.sponsorName})`;
      link.appendChild(sponsorLabel);
    }
    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectServer(server);
    });
    item.appendChild(link);
    serverList.appendChild(item);
  });
}

/**
 * Set the given server as the selected server for the speedtest
 * @param {Object} server - a server object
 */
function selectServer(server) {
  testState.speedtest.setSelectedServer(server);
  testState.selectedServerDirty = true;
  testState.state = READY;
}

/**
 * Start the requestAnimationFrame UI rendering loop
 */
function startRenderingLoop() {
  // Do these queries once to speed up the rendering itself
  const serverSelector = document.querySelector("div.server-selector");
  const selectedServer = serverSelector.querySelector("#selected-server");
  const sponsor = serverSelector.querySelector("#sponsor");
  const startButton = document.querySelector("#start-button");
  const privacyWarning = document.querySelector("#privacy-warning");

  const gauges = document.querySelectorAll("#download-gauge, #upload-gauge");
  const dialViews = [
    { element: document.querySelector("#download-gauge"), key: "dl", phase: 1 },
    { element: document.querySelector("#upload-gauge"), key: "ul", phase: 3 },
  ].map((view) => ({ ...view,
    arc: view.element.querySelector(".speed"),
    progress: view.element.querySelector(".progress"),
    label: view.element.querySelector(".measurement-state"),
  }));
  const downloadText = document.querySelector("#download-speed");
  const uploadText = document.querySelector("#upload-speed");

  const pingAndJitter = document.querySelectorAll(".ping, .jitter");
  const ping = document.querySelector("#ping");
  const jitter = document.querySelector("#jitter");
  const shareResults = document.querySelector("#share-results");
  const copyLink = document.querySelector("#copy-link");
  const resultsImage = document.querySelector("#results");

  const chinese = document.documentElement.lang.startsWith("zh");
  const buttonTexts = {
    [INITIALIZING]: chinese ? "准备中…" : "Loading...",
    [READY]: chinese ? "开始测速" : "Let's start",
    [RUNNING]: chinese ? "停止测速" : "Abort",
    [FINISHED]: chinese ? "再次测速" : "Restart",
  };

  // Show copy link button only if navigator.clipboard is available
  copyLink.classList.toggle("hidden", !navigator.clipboard);

  function renderUI() {
    // Make the main button reflect the current state
    const buttonText = testState.initializationError
      ? (chinese ? "节点暂不可用" : "Server unavailable")
      : buttonTexts[testState.state];
    if (startButton.textContent !== buttonText) startButton.textContent = buttonText;
    const initializing = testState.state === INITIALIZING;
    startButton.classList.toggle("disabled", initializing);
    if (startButton.disabled !== initializing) startButton.disabled = initializing;
    startButton.classList.toggle("active", testState.state === RUNNING);
    const phase = String(testState.testData?.testState ?? -1);
    if (startButton.dataset.phase !== phase) startButton.dataset.phase = phase;

    // Disable the server selector while test is running
    serverSelector.classList.toggle("disabled", testState.state === RUNNING);

    // Show selected server
    if (testState.selectedServerDirty) {
      const server = testState.speedtest.getSelectedServer();
      selectedServer.textContent = server.name;
      if (server.sponsorName) {
        if (server.sponsorURL) {
          sponsor.textContent = "Sponsor: ";
          const link = document.createElement("a");
          link.textContent = server.sponsorName;
          try {
            const url = new URL(server.sponsorURL, window.location.href);
            if (url.protocol === "https:" || url.protocol === "http:") link.href = url.href;
          } catch {
            // Invalid sponsor URLs are shown as plain text.
          }
          sponsor.appendChild(link);
        } else {
          sponsor.textContent = `Sponsor: ${server.sponsorName}`;
        }
      } else {
        sponsor.textContent = "";
      }
      testState.selectedServerDirty = false;
    }

    // Activate the gauges when test running or finished
    gauges.forEach((e) =>
      e.classList.toggle(
        "enabled",
        testState.state === RUNNING || testState.state === FINISHED
      )
    );

    if (
      testState.state === RUNNING &&
      testState.initialGaugeScrollPending &&
      !testState.initialGaugeScrollScheduled
    ) {
      testState.initialGaugeScrollScheduled = true;
      requestAnimationFrame(() => {
        if (testState.state === RUNNING) {
          scrollInitialDownloadGaugeIntoView();
        }
        testState.initialGaugeScrollPending = false;
        testState.initialGaugeScrollScheduled = false;
      });
    }

    // Show ping and jitter if data is available
    pingAndJitter.forEach((e) =>
      e.classList.toggle(
        "hidden",
        !(
          testState.testData &&
          testState.testData.pingStatus &&
          testState.testData.jitterStatus
        )
      )
    );

    // Show share button after test if server supports it
    shareResults.classList.toggle(
      "hidden",
      !(
        testState.state === FINISHED &&
        testState.telemetryEnabled &&
        testState.testData.testId
      )
    );

    if (testState.testDataDirty) {
      // Both arcs follow the measured speed on the same 0–10 Gbps log scale.
      dialViews.forEach(({ arc, progress, key }) => {
        const speed = testState.testData[key + "Status"];
        const fraction = Number(testState.testData[key + "Progress"]);
        const progressValue = testState.testData.testState !== 5 && Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
        arc.style.setProperty("--speed-fill", mbpsToRotation(speed) / 1.8);
        progress.style.setProperty("--test-progress", progressValue);
      });

      // Set numeric values
      downloadText.textContent = numberToText(testState.testData.dlStatus);
      uploadText.textContent = numberToText(testState.testData.ulStatus);
      ping.textContent = numberToText(testState.testData.pingStatus);
      jitter.textContent = numberToText(testState.testData.jitterStatus);

      // Set user's IP and provider
      if (testState.testData.clientIp) {
        // Clear previous content
        privacyWarning.innerHTML = '';

        const connectedThrough = document.createElement('span');
        connectedThrough.textContent = chinese ? "当前网络：" : "You are connected through:";
  
        const ipAddress = document.createTextNode(testState.testData.clientIp);

        privacyWarning.appendChild(connectedThrough);
        privacyWarning.appendChild(document.createElement('br'));
        privacyWarning.appendChild(ipAddress);
  
        privacyWarning.classList.remove("hidden");
      }

      // Set image for sharing results
      if (testState.testData.testId) {
        resultsImage.src =
          window.location.href.substring(
            0,
            window.location.href.lastIndexOf("/")
          ) +
          "/results/?id=" +
          testState.testData.testId +
          // Ask for the design this frontend matches; the classic frontend
          // links the same URL and gets the classic image without asking.
          "&style=modern";
      }

      testState.testDataDirty = false;
    }

    dialViews.forEach(({ element, key, phase, label }) => {
      const data = testState.testData;
      const measuring = testState.state === RUNNING && data?.testState === phase;
      const hasReading = data && data[key + "Status"] != null && data[key + "Status"] !== "" && Number.isFinite(Number(data[key + "Status"]));
      const complete = hasReading && (Number(data[key + "Progress"]) >= 1 || testState.state === FINISHED);
      element.classList.toggle("measuring", measuring);
      const text = data?.testState === 5 ? "已停止" : data?.[key + "Status"] === "Fail" ? "未完成" :
        measuring ? "测量中" : complete ? "已完成" : "等待测速";
      if (label && label.textContent !== text) label.textContent = text;
    });

    requestAnimationFrame(renderUI);
  }

  renderUI();
}

/**
 * Convert a speed in Mbits per second to a rotation for the gauge
 * @param {string} speed Speed in Mbits
 * @returns {number} Rotation for the gauge in degrees
 */
function mbpsToRotation(speed) {
  speed = Number(speed);
  if (!Number.isFinite(speed) || speed <= 0) return 0;

  const minSpeed = 0;
  const maxSpeed = 10000; // 10 Gbps maxes out the gauge
  const minRotation = 0;
  const maxRotation = 180;

  // Can't do log10 of values less than one, +1 all to keep it fair
  const logMinSpeed = Math.log10(minSpeed + 1);
  const logMaxSpeed = Math.log10(maxSpeed + 1);
  const logSpeed = Math.log10(speed + 1);

  const power = (logSpeed - logMinSpeed) / (logMaxSpeed - logMinSpeed);
  const rotation = power * maxRotation;

  // Make sure we stay within bounds at all times
  return Math.max(Math.min(rotation, maxRotation), minRotation);
}

/**
 * Convert a number to a user friendly version
 * @param {string} value Speed, ping or jitter
 * @returns {string} A text version with proper decimals
 */
function numberToText(value) {
  if (value === "Fail") return "失败";
  if (value === "" || value == null) return "0.00";
  value = Number(value);
  if (!Number.isFinite(value)) return "0.00";
  if (value < 10) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return value.toFixed(0);
}
