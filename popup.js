const STORAGE_KEYS = {
  enabled: "erbAutoApproveEnabled",
  lastApprovedAt: "erbAutoApproveLastApprovedAt",
  debug: "erbAutoApproveDebug"
};

const enabledToggle = document.getElementById("enabledToggle");
const toggleLabel = document.getElementById("toggleLabel");
const debugToggle = document.getElementById("debugToggle");
const debugLabel = document.getElementById("debugLabel");
const lastApprovedAt = document.getElementById("lastApprovedAt");
const refreshButton = document.getElementById("refreshButton");
const clearButton = document.getElementById("clearButton");
const status = document.getElementById("status");

const formatTimestamp = (isoString) => {
  if (!isoString) return "-";

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";

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

const setStatus = (message) => {
  status.textContent = message;
};

const render = async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.enabled, STORAGE_KEYS.lastApprovedAt, STORAGE_KEYS.debug]);
  const isEnabled = stored[STORAGE_KEYS.enabled] !== false;
  const isDebugEnabled = stored[STORAGE_KEYS.debug] === true;

  enabledToggle.checked = isEnabled;
  toggleLabel.textContent = isEnabled ? "Enabled on matching pages" : "Disabled on matching pages";
  debugToggle.checked = isDebugEnabled;
  debugLabel.textContent = isDebugEnabled ? "Verbose console logging enabled" : "Verbose console logging disabled";
  lastApprovedAt.textContent = formatTimestamp(stored[STORAGE_KEYS.lastApprovedAt]);
};

enabledToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ [STORAGE_KEYS.enabled]: enabledToggle.checked });
  setStatus(enabledToggle.checked ? "Auto-approve enabled." : "Auto-approve disabled.");
  await render();
});

debugToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ [STORAGE_KEYS.debug]: debugToggle.checked });
  setStatus(debugToggle.checked ? "Debug logging enabled." : "Debug logging disabled.");
  await render();
});

refreshButton.addEventListener("click", async () => {
  await render();
  setStatus("Status refreshed.");
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.lastApprovedAt);
  await render();
  setStatus("Last approval time cleared.");
});

chrome.storage.onChanged.addListener(() => {
  void render();
});

void render();
