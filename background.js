/*
  What this file does:
  Stores shared extension state, updates the badge, manages the local learned-secret DB, and keeps the latest warning summary available to the popup.

  Why it exists:
  The content script should stay focused on page interaction while the background worker owns durable local state and lightweight diagnostics.

  How to extend it:
  Add per-site policy storage, sync-backed settings, or richer learned-secret metadata if the extension grows beyond this POC.
*/

importScripts("learned-secrets-store.js");

const learnedStore = globalThis.SafePromptLearnedStore;

const DEFAULT_STATE = {
  enabled: true,
  debug: false,
  totalDetections: 0,
  lastDetection: null,
  learnedSecrets: []
};

const tabWarnings = new Map();
let debugEnabled = false;

initializeRuntimeState().catch((error) => {
  console.error("[SafePrompt Guard][bg] initialization failed", error);
});

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getStoredState();
  await chrome.storage.local.set(state);
  debugEnabled = Boolean(state.debug);
  await chrome.action.setBadgeText({ text: "" });
  debugLog("service worker installed");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes.debug) {
    debugEnabled = Boolean(changes.debug.newValue);
    debugLog("debug mode changed", { debug: debugEnabled });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabWarnings.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url && changeInfo.status !== "loading") {
    return;
  }
  tabWarnings.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  debugLog("tab warning state cleared", { tabId, status: changeInfo.status || "", urlChanged: Boolean(changeInfo.url) });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "safe-prompt-page-state") {
    handlePageState(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[SafePrompt Guard][bg] page state handling failed", error);
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
    return true;
  }

  if (message.type === "safe-prompt-toggle") {
    chrome.storage.local
      .set({ enabled: Boolean(message.enabled) })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[SafePrompt Guard][bg] toggle failed", error);
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
    return true;
  }

  if (message.type === "safe-prompt-request-state") {
    getStoredState()
      .then((state) => sendResponse(buildPublicState(state)))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error), ...buildPublicState(DEFAULT_STATE) }));
    return true;
  }

  if (message.type === "safe-prompt-request-learned-secrets") {
    getStoredState()
      .then((state) => sendResponse({ ok: true, learnedSecrets: normalizeLearnedSecrets(state.learnedSecrets) }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error), learnedSecrets: [] }));
    return true;
  }

  if (message.type === "safe-prompt-request-learned-secrets-full") {
    getStoredState()
      .then((state) => sendResponse({ ok: true, learnedSecrets: buildFullLearnedSecrets(state.learnedSecrets) }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error), learnedSecrets: [] }));
    return true;
  }

  if (message.type === "safe-prompt-learned-add") {
    handleLearnedAdd(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "safe-prompt-learned-remove") {
    handleLearnedRemove(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "safe-prompt-learned-update") {
    handleLearnedUpdate(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "safe-prompt-learned-remove-many") {
    handleLearnedRemoveMany(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "safe-prompt-learned-import") {
    handleLearnedImport(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "safe-prompt-learned-clear") {
    handleLearnedClear()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  return false;
});

async function initializeRuntimeState() {
  const state = await getStoredState();
  debugEnabled = Boolean(state.debug);
  const normalizedLearnedSecrets = normalizeLearnedSecrets(state.learnedSecrets);
  if (JSON.stringify(normalizedLearnedSecrets) !== JSON.stringify(state.learnedSecrets || [])) {
    await chrome.storage.local.set({ learnedSecrets: normalizedLearnedSecrets });
  }
}

async function getStoredState() {
  const state = await chrome.storage.local.get(DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...state,
    learnedSecrets: normalizeLearnedSecrets(state.learnedSecrets)
  };
}

function normalizeLearnedSecrets(entries) {
  return learnedStore ? learnedStore.normalizeEntries(entries) : [];
}

function buildPublicState(state) {
  const learnedSecrets = normalizeLearnedSecrets(state.learnedSecrets);
  return {
    ok: true,
    enabled: Boolean(state.enabled),
    debug: Boolean(state.debug),
    totalDetections: Number(state.totalDetections || 0),
    lastDetection: state.lastDetection || null,
    learnedSecretCount: learnedSecrets.length,
    learnedSecretsView: learnedStore ? learnedStore.toDisplayEntries(learnedSecrets) : []
  };
}

function buildFullLearnedSecrets(entries) {
  return normalizeLearnedSecrets(entries).map((entry) => ({
    id: entry.id,
    value: entry.value,
    type: entry.type,
    typeLabel: learnedStore ? learnedStore.typeLabel(entry.type) : String(entry.type || "Secret"),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }));
}

async function handleLearnedAdd(message) {
  const state = await getStoredState();
  const result = learnedStore.upsertEntry(state.learnedSecrets, {
    value: typeof message.value === "string" ? message.value : "",
    type: message.learnedType || message.type
  });

  await chrome.storage.local.set({ learnedSecrets: result.entries });
  debugLog("learned secret saved", {
    type: result.entry.type,
    added: result.added,
    updated: result.updated
  });

  return {
    ok: true,
    added: result.added,
    updated: result.updated,
    learnedSecrets: result.entries,
    learnedSecretsView: learnedStore.toDisplayEntries(result.entries),
    learnedSecretsFull: buildFullLearnedSecrets(result.entries)
  };
}

async function handleLearnedRemove(message) {
  const state = await getStoredState();
  const result = learnedStore.removeEntry(state.learnedSecrets, message.id);
  await chrome.storage.local.set({ learnedSecrets: result.entries });
  debugLog("learned secret removed", { id: message.id, removed: result.removed });
  return {
    ok: true,
    removed: result.removed,
    learnedSecrets: result.entries,
    learnedSecretsView: learnedStore.toDisplayEntries(result.entries),
    learnedSecretsFull: buildFullLearnedSecrets(result.entries)
  };
}

async function handleLearnedClear() {
  const cleared = learnedStore.clearEntries();
  await chrome.storage.local.set({ learnedSecrets: cleared });
  debugLog("learned secrets cleared");
  return {
    ok: true,
    learnedSecrets: cleared,
    learnedSecretsView: [],
    learnedSecretsFull: []
  };
}

async function handleLearnedUpdate(message) {
  const state = await getStoredState();
  const result = learnedStore.updateEntry(state.learnedSecrets, {
    id: message.id,
    value: typeof message.value === "string" ? message.value : "",
    type: message.learnedType || message.type
  });

  await chrome.storage.local.set({ learnedSecrets: result.entries });
  debugLog("learned secret updated", {
    id: message.id,
    merged: result.merged,
    type: result.entry.type
  });

  return {
    ok: true,
    updated: true,
    merged: result.merged,
    learnedSecrets: result.entries,
    learnedSecretsView: learnedStore.toDisplayEntries(result.entries),
    learnedSecretsFull: buildFullLearnedSecrets(result.entries)
  };
}

async function handleLearnedRemoveMany(message) {
  const state = await getStoredState();
  const result = learnedStore.removeEntries(state.learnedSecrets, message.ids);
  await chrome.storage.local.set({ learnedSecrets: result.entries });
  debugLog("learned secrets removed in bulk", { removedCount: result.removedCount });
  return {
    ok: true,
    removedCount: result.removedCount,
    learnedSecrets: result.entries,
    learnedSecretsView: learnedStore.toDisplayEntries(result.entries),
    learnedSecretsFull: buildFullLearnedSecrets(result.entries)
  };
}

async function handleLearnedImport(message) {
  const state = await getStoredState();
  const result = learnedStore.importEntries(state.learnedSecrets, message.entries, {
    mode: message.mode
  });
  await chrome.storage.local.set({ learnedSecrets: result.entries });
  debugLog("learned secrets imported", {
    mode: result.mode,
    added: result.added,
    updated: result.updated,
    skippedRows: result.skippedRows
  });
  return {
    ok: true,
    mode: result.mode,
    totalRows: result.totalRows,
    skippedRows: result.skippedRows,
    duplicateValues: result.duplicateValues,
    added: result.added,
    updated: result.updated,
    learnedSecrets: result.entries,
    learnedSecretsView: learnedStore.toDisplayEntries(result.entries),
    learnedSecretsFull: buildFullLearnedSecrets(result.entries)
  };
}

async function handlePageState(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return;
  }

  const state = await getStoredState();
  const enabled = Boolean(state.enabled);
  const findings = Array.isArray(message.findings) ? message.findings : [];
  const signature = String(message.signature || "");
  const hasFindings = enabled && findings.length > 0;
  const previousSignature = tabWarnings.get(tabId)?.signature || "";
  const highestSeverity = normalizeSeverity(message.highestSeverity);

  debugLog("page state received", {
    tabId,
    hasFindings,
    findingsCount: findings.length,
    highestSeverity
  });

  if (hasFindings) {
    tabWarnings.set(tabId, { signature });
  } else {
    tabWarnings.delete(tabId);
  }

  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: !enabled ? "#475569" : highestSeverity === "MEDIUM" ? "#d97706" : "#b91c1c"
  });
  await chrome.action.setBadgeText({
    tabId,
    text: hasFindings ? "!" : enabled ? "" : "OFF"
  });

  if (hasFindings && signature !== previousSignature) {
    await chrome.storage.local.set({
      totalDetections: Number(state.totalDetections || 0) + 1,
      lastDetection: {
        site: safeHostname(sender.tab?.url),
        detectedAt: new Date().toISOString(),
        highestSeverity,
        summary: String(message.summary || "Possible secret detected"),
        findings: findings.map((finding) => ({
          type: String(finding.type || "Secret"),
          severity: normalizeSeverity(finding.severity),
          reason: String(finding.reason || "Sensitive content"),
          preview: String(finding.preview || ""),
          mask: String(finding.mask || finding.replacement || "")
        }))
      }
    });
  }
}

function normalizeSeverity(value) {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" ? value : "HIGH";
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "unknown";
  }
}

function debugLog(message, details) {
  if (!debugEnabled) {
    return;
  }
  if (details === undefined) {
    console.log("[SafePrompt Guard][bg]", message);
    return;
  }
  console.log("[SafePrompt Guard][bg]", message, details);
}
