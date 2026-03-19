const ALARM_NAME = "erb-auto-approve-scan";
const ALARM_PERIOD_MINUTES = 0.5;
const STORAGE_KEY_ENABLED = "erbAutoApproveEnabled";
const MATCH_PATTERNS = ["https://*.programworkshop.com/*"];

const ensureAlarm = async () => {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing) return;

  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
};

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const stored = await chrome.storage.local.get([STORAGE_KEY_ENABLED]);
  if (stored[STORAGE_KEY_ENABLED] === false) return;

  const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "erb-scan-now",
        source: "background-alarm"
      });
    } catch (_) {
      // Ignore tabs or frames without an active content script listener.
    }
  }
});
