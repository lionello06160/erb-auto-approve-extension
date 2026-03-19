(() => {
  "use strict";

  if (window.__ERB_AUTO_APPROVE_INITIALIZED__) {
    return;
  }
  window.__ERB_AUTO_APPROVE_INITIALIZED__ = true;

  const POLL_INTERVAL = 2000;
  const STORAGE_KEYS = {
    enabled: "erbAutoApproveEnabled",
    lastApprovedAt: "erbAutoApproveLastApprovedAt",
    debug: "erbAutoApproveDebug"
  };
  const BADGE_ID = "erb-auto-approve-badge";
  const RX_APPROVE_ALL = /^approve\s*all$/i;
  const RX_APPROVE = /^approve$/i;
  const CLICK_COOLDOWN_MS = 1500;
  const RESCAN_EVENTS = ["focus", "pageshow", "online", "resume"];
  const clickedAt = new WeakMap();
  const AUTO_CONFIRM_SELECTORS = [
    "#dlgAccomWarnconfirm"
  ];
  const DIALOG_SELECTORS = [
    ".Dialog",
    "[role='dialog']",
    ".ui-dialog",
    ".popup"
  ];
  const APPROVE_ALL_SELECTORS = [
    "#mtaApproveAll"
  ];
  const SAFE_DIALOG_ACTION_PATTERNS = [
    /^confirm$/i,
    /^ok$/i,
    /^approve$/i,
    /^yes$/i,
    /^continue$/i,
    /^submit$/i,
    /^start$/i
  ];
  const BLOCKED_DIALOG_ACTION_PATTERNS = [
    /cancel/i,
    /close/i,
    /logout/i,
    /delete/i,
    /remove/i,
    /deny/i,
    /pause/i,
    /complete all/i,
    /return/i
  ];
  const AUTO_CHECK_LABEL_PATTERNS = [
    /do not display/i,
    /do not show/i,
    /don't show/i,
    /remember/i
  ];

  let badge = null;
  let enabled = true;
  let debugEnabled = false;
  let scanQueued = false;
  let lastScanSummary = "";
  let pollTimerId = null;

  const log = (type, message, details) => {
    if (!debugEnabled) return;

    const prefix = `[ERB Auto-Approve:${type}]`;
    if (details === undefined) {
      console.info(prefix, message);
      return;
    }

    console.info(prefix, message, details);
  };

  const describeNode = (el) => {
    if (!el) return "(none)";

    const tag = el.tagName?.toLowerCase() || "node";
    const id = el.id ? `#${el.id}` : "";
    const classes = typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().replace(/\s+/g, ".")}`
      : "";
    const text = getButtonText(el);
    return `${tag}${id}${classes}${text ? ` "${text}"` : ""}`;
  };

  const storageGet = (keys) => new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });

  const storageSet = (values) => new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });

  const isTopWindow = () => window.top === window;

  const formatTimestamp = (isoString) => {
    if (!isoString) return "-";

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  };

  const getButtonText = (el) => (el?.textContent || el?.value || "").replace(/\s+/g, " ").trim();

  const getLabelText = (input) => {
    if (!(input instanceof HTMLElement)) return "";

    if (input.labels?.length) {
      return Array.from(input.labels).map((label) => label.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    }

    const id = input.getAttribute("id");
    if (!id) return "";

    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    return (label?.textContent || "").replace(/\s+/g, " ").trim();
  };

  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (!el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const isDisabled = (el) => {
    if (!el) return true;
    if ("disabled" in el && el.disabled) return true;
    return el.getAttribute("aria-disabled") === "true";
  };

  const isDialogVisible = (el) => {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const getVisibleDialogs = (root = document) => {
    const seen = new Set();
    const dialogs = [];

    for (const selector of DIALOG_SELECTORS) {
      root.querySelectorAll(selector).forEach((el) => {
        if (!seen.has(el) && isDialogVisible(el)) {
          seen.add(el);
          dialogs.push(el);
        }
      });
    }

    return dialogs;
  };

  const isRosterContext = (el) => {
    const table = el.closest("table");
    if (table?.innerText?.match(/\bActions\b/i)) {
      return true;
    }

    const row = el.closest("tr");
    return Boolean(row?.innerText?.match(/\bApprove\b/i));
  };

  const isSafeTarget = (el) => {
    if (!el || !isVisible(el) || isDisabled(el) || !isRosterContext(el)) {
      return false;
    }

    const href = el.getAttribute?.("href") || "";
    if (href && !href.startsWith("#") && !href.toLowerCase().startsWith("javascript:")) {
      if (/login|logout|delete|remove/i.test(href)) {
        return false;
      }
    }

    return true;
  };

  const getBlockedReason = (el) => {
    if (!el) return "missing-target";
    if (!isVisible(el)) return "hidden-or-detached";
    if (isDisabled(el)) return "disabled";

    const href = el.getAttribute?.("href") || "";
    const text = getButtonText(el);

    if (BLOCKED_DIALOG_ACTION_PATTERNS.some((pattern) => pattern.test(text) || pattern.test(href))) {
      return "blocked-dialog-action";
    }

    if (!isRosterContext(el) && !isSafeDialogActionTarget(el) && !isApproveAllTarget(el)) {
      return "outside-approved-context";
    }

    if (href && !href.startsWith("#") && !href.toLowerCase().startsWith("javascript:") && /login|logout|delete|remove/i.test(href)) {
      return "dangerous-link";
    }

    return "not-whitelisted";
  };

  const isApproveAllTarget = (el) => {
    if (!el || !isVisible(el) || isDisabled(el)) {
      return false;
    }

    return APPROVE_ALL_SELECTORS.some((selector) => el.matches(selector)) || RX_APPROVE_ALL.test(getButtonText(el));
  };

  const isAutoConfirmTarget = (el) => {
    if (!el || !isVisible(el) || isDisabled(el)) {
      return false;
    }

    return AUTO_CONFIRM_SELECTORS.some((selector) => el.matches(selector));
  };

  const isSafeDialogActionTarget = (el) => {
    if (!el || !isVisible(el) || isDisabled(el)) {
      return false;
    }

    if (isAutoConfirmTarget(el)) {
      return true;
    }

    const text = getButtonText(el);
    const href = el.getAttribute?.("href") || "";
    if (BLOCKED_DIALOG_ACTION_PATTERNS.some((pattern) => pattern.test(text) || pattern.test(href))) {
      return false;
    }

    if (SAFE_DIALOG_ACTION_PATTERNS.some((pattern) => pattern.test(text))) {
      return true;
    }

    const id = el.getAttribute("id") || "";
    return /confirm|approve|ok|yes|continue|submit|start/i.test(id);
  };

  const findByExactText = (root, regex) => {
    const nodes = root.querySelectorAll("a, button, input[type='button'], input[type='submit'], div[role='button']");
    return Array.from(nodes).find((node) => regex.test(getButtonText(node)));
  };

  const findApproveAllButton = (root = document) => {
    for (const selector of APPROVE_ALL_SELECTORS) {
      const el = root.querySelector(selector);
      if (el) {
        return el;
      }
    }

    return findByExactText(root, RX_APPROVE_ALL);
  };

  const findAutoConfirmButton = (root = document) => {
    for (const selector of AUTO_CONFIRM_SELECTORS) {
      const el = root.querySelector(selector);
      if (isDialogVisible(el) && !isDisabled(el)) {
        return el;
      }
    }
    return null;
  };

  const autoCheckDialogs = (root = document) => {
    let changed = false;

    for (const dialog of getVisibleDialogs(root)) {
      log("dialog", "Visible dialog detected", describeNode(dialog));
      const checkboxes = dialog.querySelectorAll("input[type='checkbox']");
      checkboxes.forEach((checkbox) => {
        if (checkbox.checked || isDisabled(checkbox) || !isVisible(checkbox)) {
          return;
        }

        const labelText = getLabelText(checkbox);
        if (!AUTO_CHECK_LABEL_PATTERNS.some((pattern) => pattern.test(labelText))) {
          return;
        }

        checkbox.click();
        changed = true;
        log("dialog", "Checked dialog option", {
          checkbox: describeNode(checkbox),
          label: labelText
        });
      });
    }

    return changed;
  };

  const findDialogActionButton = (root = document) => {
    const explicitButton = findAutoConfirmButton(root);
    if (explicitButton) {
      log("found", "Using explicit dialog action", describeNode(explicitButton));
      return explicitButton;
    }

    for (const dialog of getVisibleDialogs(root)) {
      const nodes = dialog.querySelectorAll("button, a, input[type='button'], input[type='submit'], div[role='button']");
      const candidate = Array.from(nodes).find((node) => isSafeDialogActionTarget(node));
      if (candidate) {
        log("found", "Using generic dialog action", describeNode(candidate));
        return candidate;
      }
    }

    return null;
  };

  const renderBadge = async () => {
    if (!isTopWindow() || !document.body) {
      return null;
    }

    if (!badge?.isConnected) {
      badge = document.getElementById(BADGE_ID) || document.createElement("div");
      badge.id = BADGE_ID;
      Object.assign(badge.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        padding: "7px 10px",
        background: "#1e90ff",
        color: "#fff",
        font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        borderRadius: "6px",
        zIndex: "999999",
        boxShadow: "0 2px 6px rgba(0,0,0,.2)",
        userSelect: "none",
        opacity: "0.92"
      });

      if (!badge.isConnected) {
        document.body.appendChild(badge);
      }
    }

    const stored = await storageGet([STORAGE_KEYS.lastApprovedAt, STORAGE_KEYS.enabled]);
    const lastApprovedAt = formatTimestamp(stored[STORAGE_KEYS.lastApprovedAt]);
    const isEnabled = stored[STORAGE_KEYS.enabled] !== false;
    badge.textContent = isEnabled ? `Approved at ${lastApprovedAt}` : `Auto-approve off | Last ${lastApprovedAt}`;
    badge.style.background = isEnabled ? "#1e90ff" : "#6b7280";
    return badge;
  };

  const updateLastApprovedAt = async () => {
    const now = new Date().toISOString();
    await storageSet({ [STORAGE_KEYS.lastApprovedAt]: now });
    await renderBadge();
  };

  const tryClick = async (el) => {
    if (!enabled || !el) {
      if (!enabled) {
        log("skip", "Extension disabled; click skipped");
      }
      return false;
    }

    const lastClickedAt = clickedAt.get(el) || 0;
    if (Date.now() - lastClickedAt < CLICK_COOLDOWN_MS) {
      log("skip", "Target skipped due to cooldown", describeNode(el));
      return false;
    }

    let actionKind = "";
    if (isAutoConfirmTarget(el)) {
      actionKind = "dialog-confirm";
    } else if (isSafeDialogActionTarget(el)) {
      actionKind = "dialog-action";
    } else if (isApproveAllTarget(el)) {
      actionKind = "approve-all";
    } else if (isSafeTarget(el)) {
      actionKind = "approve";
    } else {
      log("skip", `Target blocked: ${getBlockedReason(el)}`, describeNode(el));
      return false;
    }

    clickedAt.set(el, Date.now());
    el.click();
    log("click", `Clicked ${actionKind}`, describeNode(el));
    await updateLastApprovedAt();
    return true;
  };

  const attempt = async (root = document) => {
    if (!enabled) {
      log("scan", "Attempt skipped because extension is disabled");
      return;
    }

    const dialogs = getVisibleDialogs(root);
    const dialogButton = findDialogActionButton(root);
    const approveAll = findApproveAllButton(root);
    const approve = findByExactText(root, RX_APPROVE);
    const summary = [
      `dialogs=${dialogs.length}`,
      `dialogAction=${describeNode(dialogButton)}`,
      `approveAll=${describeNode(approveAll)}`,
      `approve=${describeNode(approve)}`
    ].join(" | ");
    if (summary !== lastScanSummary) {
      log("scan", summary, {
        dialogs: dialogs.map(describeNode)
      });
      lastScanSummary = summary;
    }

    if (autoCheckDialogs(root)) {
      queueAttempt("dialog-checkbox");
      return;
    }

    if (await tryClick(dialogButton)) {
      return;
    }

    if (await tryClick(approveAll)) {
      return;
    }

    await tryClick(approve);
  };

  const queueAttempt = (reason = "unspecified") => {
    if (scanQueued) {
      return;
    }

    scanQueued = true;
    log("state", `Queueing scan (${reason})`);
    window.setTimeout(async () => {
      scanQueued = false;
      log("state", `Running queued scan (${reason})`);
      await attempt(document);
    }, 100);
  };

  const bindLifecycleEvents = () => {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        queueAttempt("visibilitychange-visible");
      }
    });

    RESCAN_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, () => {
        queueAttempt(`window-${eventName}`);
      });
    });
  };

  const observe = () => {
    if (!document.body) {
      return;
    }

    const observer = new MutationObserver(() => {
      log("state", "DOM mutation observed");
      queueAttempt("mutation");
      if (isTopWindow() && !badge?.isConnected) {
        void renderBadge();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  };

  const handleStorageChange = (changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[STORAGE_KEYS.enabled]) {
      enabled = changes[STORAGE_KEYS.enabled].newValue !== false;
      log("state", `Enabled state changed: ${enabled ? "on" : "off"}`);
      queueAttempt("storage-enabled");
    }

    if (changes[STORAGE_KEYS.debug]) {
      const previous = debugEnabled;
      debugEnabled = changes[STORAGE_KEYS.debug].newValue === true;
      if (debugEnabled) {
        log("state", "Debug logging enabled");
      } else if (previous) {
        console.info("[ERB Auto-Approve:state]", "Debug logging disabled");
      }
    }

    if (isTopWindow() && (changes[STORAGE_KEYS.enabled] || changes[STORAGE_KEYS.lastApprovedAt])) {
      void renderBadge();
    }
  };

  const handleRuntimeMessage = (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "erb-scan-now") {
      log("state", `Received external scan request from ${message.source || "unknown"}`);
      queueAttempt(`message-${message.source || "external"}`);
    }
  };

  const startPolling = () => {
    if (pollTimerId !== null) {
      window.clearInterval(pollTimerId);
    }

    pollTimerId = window.setInterval(() => {
      void attempt(document);
    }, POLL_INTERVAL);
  };

  const init = async () => {
    const stored = await storageGet([STORAGE_KEYS.enabled, STORAGE_KEYS.debug]);
    enabled = stored[STORAGE_KEYS.enabled] !== false;
    debugEnabled = stored[STORAGE_KEYS.debug] === true;
    log("state", "Initialized", {
      enabled,
      debugEnabled,
      url: window.location.href,
      top: isTopWindow()
    });

    await renderBadge();
    observe();
    bindLifecycleEvents();
    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    startPolling();
    await attempt(document);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void init();
    }, { once: true });
  } else {
    void init();
  }
})();
