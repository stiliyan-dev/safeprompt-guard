/*
  What this file does:
  Syncs the popup with stored state from the background worker and manages the local learned-secret list.

  Why it exists:
  The popup is the quickest way to verify that the POC is active, review the latest warning, and manage saved learned items.

  How to extend it:
  Add export/import, per-rule toggles, or richer learned-item metadata when needed.
*/

const enabledToggle = document.getElementById("enabled");
const totalDetections = document.getElementById("totalDetections");
const lastDetection = document.getElementById("lastDetection");
const learnedCount = document.getElementById("learnedCount");
const learnedList = document.getElementById("learnedList");
const addLearnedManual = document.getElementById("addLearnedManual");
const openLearnedDb = document.getElementById("openLearnedDb");
const clearLearned = document.getElementById("clearLearned");
const manualLearnedForm = document.getElementById("manualLearnedForm");
const manualLearnedValue = document.getElementById("manualLearnedValue");
const manualLearnedType = document.getElementById("manualLearnedType");
const manualUseSelected = document.getElementById("manualUseSelected");
const manualCancel = document.getElementById("manualCancel");
const manualSave = document.getElementById("manualSave");
const manualFormStatus = document.getElementById("manualFormStatus");
const buildMeta = document.getElementById("buildMeta");
const pageStatusNote = document.getElementById("pageStatusNote");

document.addEventListener("DOMContentLoaded", initializePopup);
enabledToggle.addEventListener("change", saveState);
clearLearned.addEventListener("click", clearLearnedSecrets);
addLearnedManual.addEventListener("click", openManualLearnedForm);
openLearnedDb.addEventListener("click", openLearnedDbPage);
manualUseSelected.addEventListener("click", useSelectedFromActiveTab);
manualCancel.addEventListener("click", closeManualLearnedForm);
manualSave.addEventListener("click", saveManualLearnedValue);
learnedList.addEventListener("click", handleLearnedListClick);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (changes.enabled || changes.totalDetections || changes.lastDetection || changes.learnedSecrets) {
    loadState();
  }
});

async function loadState() {
  const state =
    (await chrome.runtime.sendMessage({ type: "safe-prompt-request-state" }).catch(() => null)) || {
      enabled: true,
      totalDetections: 0,
      lastDetection: null,
      learnedSecretsView: []
    };

  const manifest = chrome.runtime.getManifest();
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const activeTab = Array.isArray(tabs) ? tabs[0] : null;
  const activeHost = activeTab?.url ? (() => { try { return new URL(activeTab.url).hostname.replace(/^www\./, ""); } catch { return null; } })() : null;
  buildMeta.textContent = `Version ${manifest.version}${activeHost ? ` | ${activeHost}` : ""}`;

  enabledToggle.checked = Boolean(state.enabled);
  totalDetections.textContent = String(state.totalDetections || 0);
  renderLearnedSecrets(state.learnedSecretsView || []);

  if (!state.lastDetection || !Array.isArray(state.lastDetection.findings)) {
    lastDetection.textContent = "No risky prompt detected yet.";
    return;
  }

  const findingsHtml = state.lastDetection.findings
    .map(
      (finding) => {
        const sev = (finding.severity || "MEDIUM").toUpperCase();
        const sevClass = sev === "HIGH" ? "high" : sev === "MEDIUM" ? "medium" : "low";
        return `
          <div class="finding">
            <div class="finding__header">
              <span class="finding__badge finding__badge--${sevClass}">${escapeHtml(sev)}</span>
              <strong class="finding__type">${escapeHtml(finding.type)}</strong>
            </div>
            <div class="finding__preview">${escapeHtml(finding.preview)}</div>
            <div class="finding__reason subtle">${escapeHtml(finding.reason || "")}</div>
          </div>
        `;
      }
    )
    .join("");

  lastDetection.innerHTML = `
    <div class="detectionMeta">
      <span class="severity">${escapeHtml(state.lastDetection.highestSeverity || "HIGH")}</span>
      <span class="detectionSite">${escapeHtml(state.lastDetection.site || "")}</span>
      <span class="detectionTime">${new Date(state.lastDetection.detectedAt).toLocaleString()}</span>
    </div>
    <div class="detectionSummary">${escapeHtml(state.lastDetection.summary || "Possible secret detected")}</div>
    <div class="findingsList">${findingsHtml}</div>
  `;
}

async function initializePopup() {
  await loadState();
  await refreshPageStatus();
}

async function saveState() {
  await chrome.runtime.sendMessage({
    type: "safe-prompt-toggle",
    enabled: enabledToggle.checked
  });
}

async function clearLearnedSecrets() {
  const confirmed = confirm("Clear all saved local DB items?");
  if (!confirmed) {
    return;
  }
  await chrome.runtime.sendMessage({ type: "safe-prompt-learned-clear" });
  loadState();
}

function openLearnedDbPage() {
  const url = chrome.runtime.getURL("db.html");
  chrome.tabs.create({ url }).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}

async function openManualLearnedForm() {
  manualLearnedForm.hidden = false;
  setManualFormStatus("");
  manualLearnedValue.value = "";
  manualLearnedType.value = "password";
  await useSelectedFromActiveTab({ silentWhenMissing: true });
  manualLearnedValue.focus();
}

function closeManualLearnedForm() {
  manualLearnedForm.hidden = true;
  manualLearnedValue.value = "";
  manualLearnedType.value = "password";
  setManualFormStatus("");
}

async function useSelectedFromActiveTab(options = {}) {
  setManualFormStatus("");
  const selection = await requestActiveSelectionCandidate();
  if (!selection?.value) {
    if (!options.silentWhenMissing) {
      setManualFormStatus("No selected text found in the active prompt.");
    }
    return;
  }

  manualLearnedValue.value = selection.value;
  setManualFormStatus("Loaded the current selection from the active prompt.");
}

async function saveManualLearnedValue() {
  const value = manualLearnedValue.value.trim();
  if (!value) {
    setManualFormStatus("Type or paste a value first.");
    manualLearnedValue.focus();
    return;
  }

  setManualFormBusy(true);
  setManualFormStatus("");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "safe-prompt-learned-add",
      value,
      learnedType: manualLearnedType.value
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not save local DB item.");
    }

    setManualFormStatus(response.updated ? "Updated in local DB." : "Saved to local DB.");
    closeManualLearnedForm();
    await loadState();
  } catch (error) {
    setManualFormStatus(String(error?.message || "Could not save local DB item."));
  } finally {
    setManualFormBusy(false);
  }
}

async function requestActiveSelectionCandidate() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const tab = Array.isArray(tabs) ? tabs[0] : null;
  if (!tab?.id) {
    return null;
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "safe-prompt-request-selection-candidate" }).catch(() => null);
  return response?.ok ? response.selection || null : null;
}

async function refreshPageStatus() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const tab = Array.isArray(tabs) ? tabs[0] : null;
  if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|(?:www\.)?perplexity\.ai)\//.test(String(tab.url || ""))) {
    setPageStatusNote("");
    return;
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "safe-prompt-request-runtime-info" }).catch(() => null);
  if (!response?.ok) {
    setPageStatusNote("Refresh this AI page after reloading the extension. An older page script can still show stale buttons like Replace and keep detections out of the popup.");
    return;
  }

  const hasManualAction = Array.isArray(response.warningActions) && response.warningActions.includes("manual-open");
  if (!hasManualAction) {
    setPageStatusNote("This page is using an older warning UI. Refresh the tab to load the latest Add manually flow.");
    return;
  }

  setPageStatusNote("");
}

function setManualFormStatus(message) {
  manualFormStatus.textContent = message || "";
}

function setPageStatusNote(message) {
  if (!message) {
    pageStatusNote.hidden = true;
    pageStatusNote.textContent = "";
    return;
  }
  pageStatusNote.hidden = false;
  pageStatusNote.textContent = message;
}

function setManualFormBusy(disabled) {
  [manualLearnedValue, manualLearnedType, manualUseSelected, manualCancel, manualSave].forEach((node) => {
    node.disabled = disabled;
  });
}

async function handleLearnedListClick(event) {
  const button = event.target.closest("button[data-remove-id]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  await chrome.runtime.sendMessage({
    type: "safe-prompt-learned-remove",
    id: button.dataset.removeId
  });
  loadState();
}

function renderLearnedSecrets(entries) {
  const list = Array.isArray(entries) ? entries : [];
  learnedCount.textContent = `${list.length} saved item${list.length === 1 ? "" : "s"}`;
  clearLearned.disabled = list.length === 0;

  if (!list.length) {
    learnedList.innerHTML = `<div class="subtle">No saved local items yet.</div>`;
    return;
  }

  learnedList.innerHTML = list
    .map(
      (entry) => `
        <div class="learnedItem">
          <div class="learnedItemHeader">
            <span class="pill">${escapeHtml(entry.typeLabel || entry.type || "Secret")}</span>
            <button class="inlineDanger" type="button" data-remove-id="${escapeHtml(entry.id)}">Delete</button>
          </div>
          <div style="margin-top: 6px;">${escapeHtml(entry.preview || "[hidden]")}</div>
          <div class="subtle" style="margin-top: 4px;">Updated ${formatDate(entry.updatedAt)}</div>
        </div>
      `
    )
    .join("");
}

function formatDate(value) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
