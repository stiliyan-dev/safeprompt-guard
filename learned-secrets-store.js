/*
  What this file does:
  Provides pure helpers for the local learned-secret database used by the background worker and test harness.

  Why it exists:
  The extension needs one consistent place for exact-match learned secret storage, dedupe, previews, editing, and import/export normalization.

  How to extend it:
  Add richer metadata, sync strategies, or alternate export shapes here without changing the page detector flow.
*/

(function attachSafePromptLearnedStore(global) {
  const VALID_TYPES = Object.freeze(["password", "token", "api_key", "secret", "internal_reference"]);

  function normalizeEntries(entries) {
    return sortEntries(
      (Array.isArray(entries) ? entries : [])
        .map(normalizeEntry)
        .filter(Boolean)
    );
  }

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const value = typeof entry.value === "string" ? entry.value : "";
    const type = normalizeType(entry.type);
    if (!value || !type) {
      return null;
    }

    const createdAt = normalizeTimestamp(entry.createdAt);
    const updatedAt = normalizeTimestamp(entry.updatedAt || entry.createdAt);

    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : buildId(),
      value,
      type,
      createdAt,
      updatedAt
    };
  }

  function normalizeType(value) {
    const next = String(value || "").trim().toLowerCase();
    return VALID_TYPES.includes(next) ? next : null;
  }

  function upsertEntry(entries, payload) {
    const value = typeof payload?.value === "string" ? payload.value : "";
    const type = normalizeType(payload?.type);
    if (!value || !type) {
      throw new Error("Learned secret value and type are required.");
    }

    const list = normalizeEntries(entries);
    const now = normalizeTimestamp(payload?.updatedAt || payload?.createdAt);
    const existingIndex = list.findIndex((entry) => entry.value === value);

    if (existingIndex >= 0) {
      const existing = list[existingIndex];
      const updatedEntry = {
        ...existing,
        type,
        updatedAt: now
      };
      const nextEntries = list.slice();
      nextEntries.splice(existingIndex, 1, updatedEntry);
      return {
        added: false,
        updated: true,
        merged: false,
        entry: updatedEntry,
        entries: normalizeEntries(nextEntries)
      };
    }

    const entry = {
      id: typeof payload?.id === "string" && payload.id ? payload.id : buildId(),
      value,
      type,
      createdAt: now,
      updatedAt: now
    };

    return {
      added: true,
      updated: false,
      merged: false,
      entry,
      entries: normalizeEntries([...list, entry])
    };
  }

  function updateEntry(entries, payload) {
    const entryId = String(payload?.id || "");
    if (!entryId) {
      throw new Error("Learned secret id is required.");
    }

    const value = typeof payload?.value === "string" ? payload.value : "";
    const type = normalizeType(payload?.type);
    if (!value || !type) {
      throw new Error("Learned secret value and type are required.");
    }

    const list = normalizeEntries(entries);
    const currentIndex = list.findIndex((entry) => entry.id === entryId);
    if (currentIndex < 0) {
      throw new Error("The saved local DB item could not be found.");
    }

    const now = normalizeTimestamp(payload?.updatedAt);
    const duplicateIndex = list.findIndex((entry) => entry.value === value && entry.id !== entryId);
    if (duplicateIndex >= 0) {
      const duplicate = list[duplicateIndex];
      const mergedEntry = {
        ...duplicate,
        type,
        updatedAt: now
      };
      const nextEntries = list.filter((entry) => entry.id !== entryId && entry.id !== duplicate.id);
      nextEntries.push(mergedEntry);
      return {
        updated: true,
        merged: true,
        removedId: entryId,
        entry: mergedEntry,
        entries: normalizeEntries(nextEntries)
      };
    }

    const nextEntries = list.slice();
    nextEntries.splice(currentIndex, 1, {
      ...list[currentIndex],
      value,
      type,
      updatedAt: now
    });

    return {
      updated: true,
      merged: false,
      entry: nextEntries[currentIndex],
      entries: normalizeEntries(nextEntries)
    };
  }

  function removeEntry(entries, id) {
    const entryId = String(id || "");
    const list = normalizeEntries(entries);
    const nextEntries = list.filter((entry) => entry.id !== entryId);
    return {
      removed: nextEntries.length !== list.length,
      entries: normalizeEntries(nextEntries)
    };
  }

  function removeEntries(entries, ids) {
    const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "")).filter(Boolean));
    const list = normalizeEntries(entries);
    const nextEntries = list.filter((entry) => !idSet.has(entry.id));
    return {
      removedCount: list.length - nextEntries.length,
      entries: normalizeEntries(nextEntries)
    };
  }

  function importEntries(entries, incomingEntries, options) {
    const mode = String(options?.mode || "merge").toLowerCase() === "replace" ? "replace" : "merge";
    const existing = normalizeEntries(entries);
    const rows = Array.isArray(incomingEntries) ? incomingEntries : [];
    const incomingMap = new Map();
    let skippedRows = 0;
    let duplicateValues = 0;

    rows.forEach((row) => {
      const normalized = normalizeEntry(row);
      if (!normalized) {
        skippedRows += 1;
        return;
      }
      if (incomingMap.has(normalized.value)) {
        duplicateValues += 1;
      }
      incomingMap.set(normalized.value, normalized);
    });

    const validEntries = [...incomingMap.values()];
    if (mode === "replace") {
      return {
        mode,
        totalRows: rows.length,
        skippedRows,
        duplicateValues,
        added: validEntries.length,
        updated: 0,
        entries: normalizeEntries(validEntries)
      };
    }

    let nextEntries = existing.slice();
    let added = 0;
    let updated = 0;

    validEntries.forEach((entry) => {
      const matchIndex = nextEntries.findIndex((current) => current.value === entry.value);
      if (matchIndex >= 0) {
        const current = nextEntries[matchIndex];
        nextEntries.splice(matchIndex, 1, {
          ...current,
          type: entry.type,
          updatedAt: normalizeTimestamp(entry.updatedAt || entry.createdAt)
        });
        updated += 1;
      } else {
        nextEntries.push(entry);
        added += 1;
      }
    });

    return {
      mode,
      totalRows: rows.length,
      skippedRows,
      duplicateValues,
      added,
      updated,
      entries: normalizeEntries(nextEntries)
    };
  }

  function clearEntries() {
    return [];
  }

  function toDisplayEntries(entries) {
    return normalizeEntries(entries).map((entry) => ({
      id: entry.id,
      type: entry.type,
      typeLabel: typeLabel(entry.type),
      preview: maskPreview(entry.value),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    }));
  }

  function typeLabel(type) {
    switch (normalizeType(type)) {
      case "password":
        return "Password";
      case "token":
        return "Token";
      case "api_key":
        return "API key";
      case "internal_reference":
        return "Internal reference";
      default:
        return "Secret";
    }
  }

  function maskPreview(value) {
    const text = collapseWhitespace(value);
    if (!text) {
      return "[hidden]";
    }
    if (text.length <= 6) {
      return `${text.slice(0, 2)}...`;
    }
    if (text.length <= 12) {
      return `${text.slice(0, 3)}...${text.slice(-2)}`;
    }
    return `${text.slice(0, 4)}...${text.slice(-3)}`;
  }

  function collapseWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sortEntries(entries) {
    return [...entries].sort((left, right) => {
      const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
      const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return String(right.id).localeCompare(String(left.id));
    });
  }

  function normalizeTimestamp(value) {
    const next = typeof value === "string" && value ? value : new Date().toISOString();
    return Number.isNaN(Date.parse(next)) ? new Date().toISOString() : new Date(next).toISOString();
  }

  function buildId() {
    return `learned_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  global.SafePromptLearnedStore = {
    VALID_TYPES,
    normalizeEntries,
    normalizeEntry,
    normalizeType,
    upsertEntry,
    updateEntry,
    removeEntry,
    removeEntries,
    importEntries,
    clearEntries,
    toDisplayEntries,
    typeLabel,
    maskPreview
  };
})(globalThis);
