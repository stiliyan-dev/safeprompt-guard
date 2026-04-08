/*
  What this file does:
  Runs the full Local DB admin console, including search, filtering, add/edit, bulk delete, and import/export.

  Why it exists:
  The popup is intentionally compact, so richer learned-value management lives on this desktop-first page.

  How to extend it:
  Add audit history, tagging, sync sources, or saved filter presets if the Local DB keeps growing.
*/

const PREFS_KEY = "safe-prompt-db-preferences";
const TYPE_LABELS = {
  password: "Password",
  token: "Token",
  api_key: "API key",
  secret: "Secret",
  internal_reference: "Internal reference"
};

const countNode = document.getElementById("count");
const resultCountNode = document.getElementById("resultCount");
const selectionSummaryNode = document.getElementById("selectionSummary");
const statusSummaryNode = document.getElementById("statusSummary");
const tableBody = document.getElementById("tableBody");
const selectAll = document.getElementById("selectAll");
const emptyState = document.getElementById("emptyState");
const addRow = document.getElementById("addRow");
const emptyAdd = document.getElementById("emptyAdd");
const importRows = document.getElementById("importRows");
const exportJson = document.getElementById("exportJson");
const exportCsv = document.getElementById("exportCsv");
const deleteSelected = document.getElementById("deleteSelected");
const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const sortOrder = document.getElementById("sortOrder");
const overlay = document.getElementById("overlay");
const drawer = document.getElementById("drawer");
const drawerEyebrow = document.getElementById("drawerEyebrow");
const drawerTitle = document.getElementById("drawerTitle");
const drawerHint = document.getElementById("drawerHint");
const drawerClose = document.getElementById("drawerClose");
const editorSection = document.getElementById("editorSection");
const editorType = document.getElementById("editorType");
const editorValue = document.getElementById("editorValue");
const editorCancel = document.getElementById("editorCancel");
const editorSave = document.getElementById("editorSave");
const importSection = document.getElementById("importSection");
const importFile = document.getElementById("importFile");
const importCancel = document.getElementById("importCancel");
const importApply = document.getElementById("importApply");
const importPreviewBody = document.getElementById("importPreviewBody");
const toast = document.getElementById("toast");

const state = {
  entries: [],
  selectedIds: new Set(),
  search: "",
  type: "all",
  sort: "newest",
  drawerMode: "closed",
  editingId: "",
  drawerBusy: false,
  importRows: [],
  importPreview: null,
  importFormat: "",
  importFileName: "",
  toastTimer: 0
};

document.addEventListener("DOMContentLoaded", init);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.learnedSecrets) {
    loadEntries();
  }
});

function init() {
  loadPreferences();
  bindEvents();
  loadEntries();
}

function bindEvents() {
  addRow.addEventListener("click", () => openEditorDrawer("add"));
  emptyAdd.addEventListener("click", () => openEditorDrawer("add"));
  importRows.addEventListener("click", openImportDrawer);
  exportJson.addEventListener("click", () => exportCurrentRows("json"));
  exportCsv.addEventListener("click", () => exportCurrentRows("csv"));
  deleteSelected.addEventListener("click", deleteSelectedRows);

  searchInput.addEventListener("input", () => {
    state.search = searchInput.value || "";
    render();
  });

  typeFilter.addEventListener("change", () => {
    state.type = typeFilter.value;
    persistPreferences();
    render();
  });

  sortOrder.addEventListener("change", () => {
    state.sort = sortOrder.value;
    persistPreferences();
    render();
  });

  selectAll.addEventListener("change", toggleSelectAllVisible);
  tableBody.addEventListener("click", handleTableClick);
  tableBody.addEventListener("change", handleTableChange);

  overlay.addEventListener("click", closeDrawer);
  drawerClose.addEventListener("click", closeDrawer);
  editorCancel.addEventListener("click", closeDrawer);
  editorSave.addEventListener("click", saveEditorEntry);
  importCancel.addEventListener("click", closeDrawer);
  importApply.addEventListener("click", applyImport);
  importFile.addEventListener("change", handleImportFileChange);
  document.querySelectorAll("input[name='importMode']").forEach((node) => {
    node.addEventListener("change", recomputeImportPreview);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.drawerMode !== "closed" && !state.drawerBusy) {
      closeDrawer();
    }
  });
}

async function loadEntries() {
  const response = await chrome.runtime.sendMessage({ type: "safe-prompt-request-learned-secrets-full" }).catch(() => null);
  state.entries = Array.isArray(response?.learnedSecrets) ? response.learnedSecrets : [];
  syncSelectionWithEntries();
  render();
}

function render() {
  const filteredEntries = getFilteredEntries();
  const visibleIds = new Set(filteredEntries.map((entry) => entry.id));

  countNode.textContent = String(state.entries.length);
  resultCountNode.textContent = String(filteredEntries.length);
  selectionSummaryNode.textContent = `${state.selectedIds.size} selected`;
  statusSummaryNode.textContent = buildStatusSummary(filteredEntries.length);
  deleteSelected.disabled = state.selectedIds.size === 0;
  exportJson.disabled = filteredEntries.length === 0;
  exportCsv.disabled = filteredEntries.length === 0;

  renderTable(filteredEntries);
  emptyState.hidden = filteredEntries.length > 0;
  selectAll.checked = filteredEntries.length > 0 && filteredEntries.every((entry) => state.selectedIds.has(entry.id));
  selectAll.indeterminate = !selectAll.checked && filteredEntries.some((entry) => state.selectedIds.has(entry.id));
  selectAll.disabled = filteredEntries.length === 0;

  if (state.drawerMode === "import") {
    updateImportControls();
  }

  if (state.drawerMode === "closed") {
    overlay.hidden = true;
    drawer.hidden = true;
  } else {
    overlay.hidden = false;
    drawer.hidden = false;
  }

  for (const selectedId of [...state.selectedIds]) {
    if (!visibleIds.has(selectedId) && !state.entries.some((entry) => entry.id === selectedId)) {
      state.selectedIds.delete(selectedId);
    }
  }
}

function renderTable(entries) {
  if (!entries.length) {
    tableBody.innerHTML = "";
    return;
  }

  tableBody.innerHTML = entries
    .map(
      (entry) => `
        <tr>
          <td class="dbTable__checkbox">
            <input type="checkbox" data-id="${escapeHtml(entry.id)}" ${state.selectedIds.has(entry.id) ? "checked" : ""} />
          </td>
          <td><span class="typePill">${escapeHtml(labelForType(entry.type))}</span></td>
          <td class="valueCell">${escapeHtml(entry.value || "")}</td>
          <td>${escapeHtml(formatDate(entry.createdAt))}</td>
          <td>${escapeHtml(formatDate(entry.updatedAt))}</td>
          <td class="dbTable__actions">
            <div class="tableActions">
              <button class="inlineButton" type="button" data-action="copy" data-id="${escapeHtml(entry.id)}">Copy</button>
              <button class="inlineButton" type="button" data-action="edit" data-id="${escapeHtml(entry.id)}">Edit</button>
              <button class="inlineButton inlineButton--danger" type="button" data-action="delete" data-id="${escapeHtml(entry.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function handleTableChange(event) {
  const checkbox = event.target.closest("input[type='checkbox'][data-id]");
  if (!(checkbox instanceof HTMLInputElement)) {
    return;
  }

  if (checkbox.checked) {
    state.selectedIds.add(checkbox.dataset.id);
  } else {
    state.selectedIds.delete(checkbox.dataset.id);
  }
  render();
}

async function handleTableClick(event) {
  const button = event.target.closest("button[data-action][data-id]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const entry = state.entries.find((item) => item.id === button.dataset.id);
  if (!entry) {
    return;
  }

  const action = button.dataset.action;
  if (action === "copy") {
    await copyValue(entry.value);
    showToast("Copied raw value to the clipboard.", "success");
    return;
  }

  if (action === "edit") {
    openEditorDrawer("edit", entry);
    return;
  }

  if (action === "delete") {
    const confirmed = confirm(`Delete the saved ${labelForType(entry.type).toLowerCase()} value from the local DB?`);
    if (!confirmed) {
      return;
    }
    await chrome.runtime.sendMessage({ type: "safe-prompt-learned-remove", id: entry.id });
    state.selectedIds.delete(entry.id);
    showToast("Deleted the saved value.", "success");
    loadEntries();
  }
}

function toggleSelectAllVisible() {
  const filteredEntries = getFilteredEntries();
  if (selectAll.checked) {
    filteredEntries.forEach((entry) => state.selectedIds.add(entry.id));
  } else {
    filteredEntries.forEach((entry) => state.selectedIds.delete(entry.id));
  }
  render();
}

async function deleteSelectedRows() {
  if (!state.selectedIds.size) {
    return;
  }

  const confirmed = confirm(`Delete ${state.selectedIds.size} selected local DB item${state.selectedIds.size === 1 ? "" : "s"}?`);
  if (!confirmed) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "safe-prompt-learned-remove-many",
    ids: [...state.selectedIds]
  });

  if (!response?.ok) {
    showToast(response?.error || "Could not delete the selected items.", "error");
    return;
  }

  state.selectedIds.clear();
  state.entries = Array.isArray(response.learnedSecretsFull) ? response.learnedSecretsFull : [];
  render();
  showToast(`Deleted ${response.removedCount || 0} selected item${response.removedCount === 1 ? "" : "s"}.`, "success");
}

function openEditorDrawer(mode, entry) {
  state.drawerMode = mode;
  state.drawerBusy = false;
  state.editingId = entry?.id || "";
  editorType.value = entry?.type || "password";
  editorValue.value = entry?.value || "";
  drawerEyebrow.textContent = mode === "edit" ? "Edit" : "Add";
  drawerTitle.textContent = mode === "edit" ? "Edit learned value" : "Add learned value";
  drawerHint.textContent =
    mode === "edit"
      ? "Update the exact raw value or type stored in the Local DB."
      : "Create a new exact-match learned value for future prompt detection.";
  editorSection.hidden = false;
  importSection.hidden = true;
  overlay.hidden = false;
  drawer.hidden = false;
  render();
  window.setTimeout(() => editorValue.focus(), 0);
}

function openImportDrawer() {
  state.drawerMode = "import";
  state.drawerBusy = false;
  state.importRows = [];
  state.importPreview = null;
  state.importFileName = "";
  state.importFormat = "";
  importFile.value = "";
  document.querySelector("input[name='importMode'][value='merge']").checked = true;
  drawerEyebrow.textContent = "Import";
  drawerTitle.textContent = "Import learned values";
  drawerHint.textContent = "Bring in JSON or CSV rows, preview the result, then merge or replace the Local DB.";
  editorSection.hidden = true;
  importSection.hidden = false;
  overlay.hidden = false;
  drawer.hidden = false;
  updateImportPreviewBody("Choose a JSON or CSV file to preview the import.");
  updateImportControls();
  render();
}

function closeDrawer(force = false) {
  if (state.drawerBusy && !force) {
    return;
  }
  state.drawerMode = "closed";
  state.editingId = "";
  state.importRows = [];
  state.importPreview = null;
  state.importFileName = "";
  state.importFormat = "";
  overlay.hidden = true;
  drawer.hidden = true;
  render();
}

async function saveEditorEntry() {
  const mode = state.drawerMode;
  const value = editorValue.value.trim();
  const learnedType = editorType.value;
  if (!value) {
    showToast("A raw value is required before saving.", "error");
    editorValue.focus();
    return;
  }

  state.drawerBusy = true;
  updateEditorControls();

  try {
    const message =
      state.drawerMode === "edit"
        ? {
            type: "safe-prompt-learned-update",
            id: state.editingId,
            value,
            learnedType
          }
        : {
            type: "safe-prompt-learned-add",
            value,
            learnedType
          };

    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      throw new Error(response?.error || "Could not save the Local DB item.");
    }

    state.entries = Array.isArray(response.learnedSecretsFull) ? response.learnedSecretsFull : state.entries;
    state.drawerBusy = false;
    closeDrawer(true);
    render();
    showToast(
      mode === "edit"
        ? response.merged
          ? "Updated the value and merged an exact duplicate."
          : "Updated the saved value."
        : response.updated
          ? "Updated the existing exact-match value."
          : "Added a new Local DB entry.",
      "success"
    );
  } catch (error) {
    showToast(String(error?.message || "Could not save the Local DB item."), "error");
  } finally {
    state.drawerBusy = false;
    updateEditorControls();
  }
}

function updateEditorControls() {
  [editorType, editorValue, editorCancel, editorSave, drawerClose].forEach((node) => {
    node.disabled = state.drawerBusy;
  });
}

async function handleImportFileChange() {
  const file = importFile.files?.[0];
  if (!file) {
    state.importRows = [];
    state.importPreview = null;
    state.importFileName = "";
    state.importFormat = "";
    updateImportPreviewBody("Choose a JSON or CSV file to preview the import.");
    updateImportControls();
    return;
  }

  try {
    const text = await file.text();
    const parsed = parseImportText(text, file.name);
    state.importRows = parsed.rows;
    state.importFileName = file.name;
    state.importFormat = parsed.format;
    recomputeImportPreview();
  } catch (error) {
    state.importRows = [];
    state.importPreview = null;
    state.importFileName = file.name;
    state.importFormat = "";
    updateImportPreviewBody(`Could not parse ${escapeHtml(file.name)}. ${escapeHtml(String(error?.message || error))}`);
    updateImportControls();
  }
}

function recomputeImportPreview() {
  if (!state.importRows.length) {
    updateImportControls();
    return;
  }

  const mode = currentImportMode();
  const result = SafePromptLearnedStore.importEntries(state.entries, state.importRows, { mode });
  state.importPreview = {
    ...result,
    format: state.importFormat,
    fileName: state.importFileName,
    validRows: Math.max(0, result.totalRows - result.skippedRows)
  };
  renderImportPreview();
  updateImportControls();
}

function renderImportPreview() {
  if (!state.importPreview) {
    updateImportPreviewBody("Choose a JSON or CSV file to preview the import.");
    return;
  }

  const preview = state.importPreview;
  updateImportPreviewBody(`
    <div><strong>${escapeHtml(preview.fileName || "Import file")}</strong> - ${escapeHtml(String(preview.format || "").toUpperCase())} - ${escapeHtml(preview.mode)}</div>
    <div class="importPreview__grid">
      ${buildImportStat("Rows parsed", preview.totalRows)}
      ${buildImportStat("Valid rows", preview.validRows)}
      ${buildImportStat("Skipped", preview.skippedRows)}
      ${buildImportStat("Duplicate values", preview.duplicateValues)}
      ${buildImportStat(preview.mode === "replace" ? "Rows kept" : "Would add", preview.mode === "replace" ? preview.added : preview.added)}
      ${buildImportStat(preview.mode === "replace" ? "Would replace" : "Would update", preview.mode === "replace" ? state.entries.length : preview.updated)}
    </div>
  `);
}

function buildImportStat(label, value) {
  return `<div class="importPreview__stat"><strong>${escapeHtml(String(value))}</strong><div>${escapeHtml(label)}</div></div>`;
}

function updateImportPreviewBody(html) {
  importPreviewBody.innerHTML = html;
}

function updateImportControls() {
  const ready = Boolean(state.importPreview && state.importRows.length);
  importApply.disabled = !ready || state.drawerBusy;
  importCancel.disabled = state.drawerBusy;
  importFile.disabled = state.drawerBusy;
  document.querySelectorAll("input[name='importMode']").forEach((node) => {
    node.disabled = state.drawerBusy;
  });
  drawerClose.disabled = state.drawerBusy;
}

async function applyImport() {
  if (!state.importRows.length) {
    return;
  }

  const mode = currentImportMode();
  if (mode === "replace") {
    const confirmed = confirm("Replace all current Local DB rows with the imported file?");
    if (!confirmed) {
      return;
    }
  }

  state.drawerBusy = true;
  updateImportControls();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "safe-prompt-learned-import",
      entries: state.importRows,
      mode
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not import Local DB items.");
    }

    state.entries = Array.isArray(response.learnedSecretsFull) ? response.learnedSecretsFull : state.entries;
    state.selectedIds.clear();
    state.drawerBusy = false;
    closeDrawer(true);
    render();
    showToast(
      mode === "replace"
        ? `Replaced the Local DB with ${response.added || 0} imported row${response.added === 1 ? "" : "s"}.`
        : `Import complete: ${response.added || 0} added, ${response.updated || 0} updated, ${response.skippedRows || 0} skipped.`,
      "success"
    );
  } catch (error) {
    showToast(String(error?.message || "Could not import Local DB items."), "error");
  } finally {
    state.drawerBusy = false;
    updateImportControls();
  }
}

async function exportCurrentRows(format) {
  const filteredEntries = getFilteredEntries();
  if (!filteredEntries.length) {
    return;
  }

  const extension = format === "csv" ? "csv" : "json";
  const fileName = `safe-prompt-guard-local-db-${timestampForFile()}.${extension}`;
  const content =
    extension === "csv"
      ? serializeCsv(filteredEntries)
      : JSON.stringify(
          filteredEntries.map((entry) => ({
            id: entry.id,
            value: entry.value,
            type: entry.type,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt
          })),
          null,
          2
        );

  downloadTextFile(fileName, content, extension === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8");
  showToast(`Exported ${filteredEntries.length} filtered row${filteredEntries.length === 1 ? "" : "s"} as ${extension.toUpperCase()}.`, "success");
}

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function getFilteredEntries() {
  const search = state.search.trim().toLowerCase();
  const filtered = state.entries.filter((entry) => {
    if (state.type !== "all" && entry.type !== state.type) {
      return false;
    }

    if (!search) {
      return true;
    }

    return `${entry.value} ${entry.type} ${labelForType(entry.type)}`.toLowerCase().includes(search);
  });

  return filtered.sort((left, right) => compareEntries(left, right, state.sort));
}

function compareEntries(left, right, mode) {
  if (mode === "oldest") {
    return (Date.parse(left.updatedAt || left.createdAt || 0) || 0) - (Date.parse(right.updatedAt || right.createdAt || 0) || 0);
  }

  if (mode === "type") {
    const typeCompare = labelForType(left.type).localeCompare(labelForType(right.type));
    if (typeCompare !== 0) {
      return typeCompare;
    }
  }

  return (Date.parse(right.updatedAt || right.createdAt || 0) || 0) - (Date.parse(left.updatedAt || left.createdAt || 0) || 0);
}

function currentImportMode() {
  const checked = document.querySelector("input[name='importMode']:checked");
  return checked instanceof HTMLInputElement && checked.value === "replace" ? "replace" : "merge";
}

function parseImportText(text, fileName) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("The selected file is empty.");
  }

  const lowerName = String(fileName || "").toLowerCase();
  if (lowerName.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return {
      format: "json",
      rows: parseJsonImport(trimmed)
    };
  }

  return {
    format: "csv",
    rows: parseCsvImport(trimmed)
  };
}

function parseJsonImport(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.learnedSecrets)) {
    return data.learnedSecrets;
  }
  if (Array.isArray(data?.entries)) {
    return data.entries;
  }
  throw new Error("JSON import expects an array, an entries array, or a learnedSecrets array.");
}

function parseCsvImport(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("CSV import needs a header row and at least one data row.");
  }

  const headers = rows[0].map((value) => String(value || "").trim());
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      if (header) {
        item[header] = row[index] ?? "";
      }
    });
    return item;
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function serializeCsv(entries) {
  const header = ["id", "value", "type", "createdAt", "updatedAt"];
  const rows = entries.map((entry) => [
    entry.id,
    entry.value,
    entry.type,
    entry.createdAt,
    entry.updatedAt
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function syncSelectionWithEntries() {
  const knownIds = new Set(state.entries.map((entry) => entry.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => knownIds.has(id)));
}

function buildStatusSummary(filteredCount) {
  const filterLabel = state.type === "all" ? "all types" : labelForType(state.type);
  return `${filteredCount} visible - ${filterLabel} - ${state.sort}`;
}

function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    state.type = typeof stored.type === "string" ? stored.type : "all";
    state.sort = typeof stored.sort === "string" ? stored.sort : "newest";
  } catch (error) {
    state.type = "all";
    state.sort = "newest";
  }

  typeFilter.value = state.type;
  sortOrder.value = state.sort;
}

function persistPreferences() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      type: state.type,
      sort: state.sort
    })
  );
}

function labelForType(type) {
  return TYPE_LABELS[type] || "Secret";
}

function timestampForFile() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
}

async function copyValue(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = value;
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function showToast(message, tone) {
  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
  }
  toast.textContent = message;
  toast.className = `toast toast--${tone === "error" ? "error" : "success"}`;
  toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    state.toastTimer = 0;
  }, 3200);
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
