/*
  What this file does:
  Intercepts send attempts on supported AI sites, runs local detection, and shows one compact warning or recovery notice.

  Why it exists:
  The send flow is the most failure-prone part of the extension, so this version favors simple state transitions and explicit recovery over live scanning on every keystroke.

  How to extend it:
  Add site-specific composer or send-button adapters if a supported site needs a more precise integration.
*/

(function safePromptGuardContent() {
  if (globalThis.__safePromptGuardContentInitialized) {
    return;
  }
  globalThis.__safePromptGuardContentInitialized = true;

  const detector = globalThis.SafePromptDetector;
  if (!detector) {
    return;
  }

  const STYLE_ID = "safe-prompt-guard-styles";
  const WARNING_ID = "safe-prompt-guard-warning";
  const NOTICE_ID = "safe-prompt-guard-notice";
  const SELECTION_BUBBLE_ID = "safe-prompt-guard-selection";
  const MANUAL_TRIGGER_ID = "safe-prompt-guard-manual-trigger";
  const INIT_TIMEOUT_MS = 2000;
  const FLOW_TIMEOUT_MS = 90000;
  const NOTICE_TIMEOUT_MS = 4000;
  const SCAN_DEBOUNCE_MS = 220;
  const MUTATION_DEBOUNCE_MS = 300;
  const SELECTION_DEBOUNCE_MS = 60;
  const BYPASS_WINDOW_MS = 3000;
  const SELECTION_MIN_LENGTH = 3;
  const SELECTION_MAX_LENGTH = 256;
  const LEARNED_TYPE_OPTIONS = [
    { value: "password", label: "Password" },
    { value: "token", label: "Token" },
    { value: "api_key", label: "API key" },
    { value: "secret", label: "Secret" },
    { value: "internal_reference", label: "Internal ref" }
  ];
  const COMPOSER_SELECTORS = [
    "#prompt-textarea",
    "textarea#prompt-textarea",
    "form textarea",
    "main textarea",
    "textarea",
    "[data-testid*='composer'] textarea",
    "[data-testid*='prompt'] textarea",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='plaintext-only'][role='textbox']",
    "[role='textbox'][contenteditable='true']",
    "div.ProseMirror",
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']"
  ];
  const PRIORITY_SEND_BUTTON_SELECTORS = [
    "button[data-testid='send-button']",
    "button[data-testid*='send']",
    "button[aria-label*='Send']",
    "button[aria-label*='send']",
    "button[title*='Send']",
    "button[title*='send']"
  ];
  const BUTTON_SELECTORS = ["button", "[role='button']"];
  const SEND_KEYWORDS = ["send", "submit", "message", "prompt", "ask"];
  const COMPOSER_BLOCK_TAGS = new Set([
    "ARTICLE",
    "BLOCKQUOTE",
    "DIV",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "MAIN",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TR",
    "UL"
  ]);
  const composerIds = new WeakMap();
  let nextComposerId = 1;

  const state = {
    enabled: true,
    debug: false,
    lastFocusedComposer: null,
    currentComposer: null,
    currentComposerSnapshot: null,
    currentFindings: [],
    currentActionable: [],
    currentAction: null,
    currentAnchor: null,
    popupVisible: false,
    actionBusy: false,
    suppressInput: false,
    bypassComposer: null,
    bypassUntil: 0,
    flowTimeoutId: 0,
    noticeTimeoutId: 0,
    scanDebounceId: 0,
    mutationDebounceId: 0,
    flashTimeoutId: 0,
    observer: null,
    editorFound: false,
    activeFindingIndex: -1,
    warningPosition: null,
    warningDrag: null,
    lastReportedSignature: "__init__",
    selectionCandidate: null,
    selectionPanelCandidate: null,
    selectionDebounceId: 0,
    selectionBusy: false,
    selectionLearnedType: LEARNED_TYPE_OPTIONS[0].value,
    selectionPanelOpen: false,
    manualEntryOpen: false,
    manualEntryValue: "",
    manualEntryBusy: false,
    manualEntryType: LEARNED_TYPE_OPTIONS[0].value
  };

  init().catch((error) => {
    handleUnexpectedError("init failed", error);
  });

  async function init() {
    injectStyles();
    await withTimeout(Promise.resolve().then(() => detector.initialize?.()), INIT_TIMEOUT_MS, "detector initialization timed out").catch((error) => {
      handleUnexpectedError("detector initialize", error);
    });

    const config = await chrome.storage.local.get({ enabled: true, debug: false });
    state.enabled = Boolean(config.enabled);
    state.debug = Boolean(config.debug);
    try {
      const learnedResponse = await chrome.runtime.sendMessage({ type: "safe-prompt-request-learned-secrets" });
      if (learnedResponse?.ok) {
        detector.setLearnedSecrets(learnedResponse.learnedSecrets || []);
      }
    } catch (error) {
      handleUnexpectedError("learned secret preload failed", error);
    }

    log("content script loaded", { host: location.hostname });
    log("supported site detected", { host: location.hostname });

    document.addEventListener("focusin", safely("focusin", handleFocusIn), true);
    document.addEventListener("input", safely("input", handleInput), true);
    document.addEventListener("paste", safely("paste", handlePaste), true);
    document.addEventListener("keydown", safely("keydown", handleKeyDown), true);
    document.addEventListener("click", safely("click", handleClick), true);
    document.addEventListener("change", safely("change", handleChange), true);
    document.addEventListener("mouseup", safely("mouseup", handleMouseUp), true);
    document.addEventListener("selectionchange", safely("selectionchange", handleSelectionChange), true);
    document.addEventListener("submit", safely("submit", handleSubmit), true);
    document.addEventListener("scroll", safely("scroll", repositionFloatingUi), true);
    window.addEventListener("resize", safely("resize", repositionFloatingUi));
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    observeComposerRemounts();
    refreshEditorState("init");

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }
      if (changes.enabled) {
        state.enabled = Boolean(changes.enabled.newValue);
        log("enabled state changed", { enabled: state.enabled });
        if (!state.enabled) {
          resetFlow("disabled", { clearReport: true });
          removeNotice();
        }
      }
      if (changes.debug) {
        state.debug = Boolean(changes.debug.newValue);
        log("debug mode changed", { debug: state.debug });
      }
      if (changes.learnedSecrets) {
        detector.setLearnedSecrets(changes.learnedSecrets.newValue || []);
        log("learned secrets reloaded", { count: detector.getLearnedSecrets?.().length || 0 });
        if (isComposerUsable(state.currentComposer)) {
          scheduleInlineScan(state.currentComposer, "learned-storage-change");
        } else if (isComposerUsable(state.lastFocusedComposer)) {
          scheduleInlineScan(state.lastFocusedComposer, "learned-storage-change");
        }
      }
    });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("styles.css");
    document.documentElement.appendChild(link);
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (message?.type === "safe-prompt-request-selection-candidate") {
      sendResponse({
        ok: true,
        selection: buildSelectionCandidatePayload()
      });
      return true;
    }

    if (message?.type === "safe-prompt-request-runtime-info") {
      sendResponse({
        ok: true,
        version: chrome.runtime.getManifest().version,
        warningActions: ["cancel", "mask-all", "manual-open", "send"],
        popupVisible: Boolean(state.popupVisible),
        findingsCount: Array.isArray(state.currentActionable) ? state.currentActionable.length : 0
      });
      return true;
    }

    return false;
  }

  function handleFocusIn(event) {
    const composer = findComposer(event.target);
    if (!composer) {
      return;
    }
    state.lastFocusedComposer = composer;
    state.editorFound = true;
    scheduleSelectionCandidateUpdate();
    log("editor found", { tag: composer.tagName.toLowerCase(), host: location.hostname });
  }

  function handleInput(event) {
    if (
      (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) &&
      event.target.closest(`#${WARNING_ID}`) &&
      event.target.dataset.action === "manual-value"
    ) {
      state.manualEntryValue = event.target.value;
      return;
    }

    if (state.suppressInput) {
      return;
    }

    const composer = findComposer(event.target);
    if (!composer) {
      return;
    }

    state.lastFocusedComposer = composer;
    state.editorFound = true;
    scheduleSelectionCandidateUpdate();
    log("input change detected", { length: readComposerText(composer).length });
    scheduleInlineScan(composer, "input");
  }

  function handlePaste(event) {
    if (!state.enabled) {
      return;
    }

    const composer = findComposer(event.target);
    if (!composer) {
      return;
    }

    state.lastFocusedComposer = composer;
    state.editorFound = true;
    scheduleSelectionCandidateUpdate();
    log("paste detected", { tag: composer.tagName.toLowerCase() });
    window.setTimeout(() => {
      scheduleInlineScan(composer, "paste");
    }, 0);
  }

  function handleMouseUp(event) {
    scheduleSelectionCandidateUpdate();
  }

  function handleSelectionChange() {
    scheduleSelectionCandidateUpdate();
  }

  function handleChange(event) {
    if (!(event.target instanceof HTMLSelectElement)) {
      return;
    }
    if (event.target.closest(`#${WARNING_ID}`) && event.target.dataset.action === "manual-type") {
      state.manualEntryType = event.target.value;
      return;
    }
    if (event.target.closest(`#${SELECTION_BUBBLE_ID}`) && event.target.dataset.action === "learned-type") {
      state.selectionLearnedType = event.target.value;
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      if (state.manualEntryOpen) {
        closeManualEntryForm();
      } else {
        hideSelectionBubble();
      }
    }

    if (!state.enabled || event.key !== "Enter" || event.shiftKey) {
      return;
    }

    const composer = findComposer(event.target);
    if (!isComposerUsable(composer)) {
      return;
    }

    if (shouldBypass(composer)) {
      log("send bypass released", { source: "keyboard" });
      clearBypass();
      return;
    }

    if (state.popupVisible || state.actionBusy) {
      state.currentAction = { kind: "keyboard" };
      state.currentAnchor = findSendButton(composer) || composer;
      log("send intercepted", { source: "keyboard", reason: "warning-visible" });
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const actionable = interceptSendAttempt(composer, { kind: "keyboard" }, composer, "keyboard");
    if (!actionable.length) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const selectionBubble = document.getElementById(SELECTION_BUBBLE_ID);
    if (selectionBubble?.contains(event.target)) {
      handleSelectionBubbleAction(event.target);
      return;
    }

    if (selectionBubble && !state.selectionBusy) {
      hideSelectionBubble();
    }

    const warning = document.getElementById(WARNING_ID);
    if (warning?.contains(event.target)) {
      handleWarningAction(event.target);
      return;
    }

    const notice = document.getElementById(NOTICE_ID);
    if (notice?.contains(event.target)) {
      if (event.target.closest("button[data-action='dismiss-notice']")) {
        removeNotice();
      }
      return;
    }

    if (!state.enabled) {
      return;
    }

    const button = event.target.closest(BUTTON_SELECTORS.join(", "));
    if (!(button instanceof HTMLElement) || !isLikelySendButton(button)) {
      return;
    }

    const composer = getCurrentComposer(button);
    if (!isComposerUsable(composer)) {
      showNotice("Composer not ready. Try again.", "warning", button);
      return;
    }

    if (shouldBypass(composer)) {
      log("send bypass released", { source: "click" });
      clearBypass();
      return;
    }

    if (state.popupVisible || state.actionBusy) {
      state.currentAction = { kind: "button", button };
      state.currentAnchor = button;
      log("send intercepted", { source: "click", reason: "warning-visible" });
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const actionable = interceptSendAttempt(composer, { kind: "button", button }, button, "click");
    if (!actionable.length) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleSubmit(event) {
    if (!state.enabled) {
      return;
    }

    const form = event.target instanceof HTMLFormElement ? event.target : event.target?.closest?.("form");
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    const formComposer = form.querySelector(COMPOSER_SELECTORS.join(", "));
    const composer =
      (formComposer instanceof HTMLElement && isComposerUsable(formComposer) ? formComposer : null) ||
      findBestComposer(form) ||
      state.lastFocusedComposer ||
      findBestComposer();
    if (!isComposerUsable(composer)) {
      return;
    }

    if (shouldBypass(composer)) {
      log("send bypass released", { source: "submit" });
      clearBypass();
      return;
    }

    if (state.popupVisible || state.actionBusy) {
      state.currentAction = { kind: "submit", form };
      state.currentAnchor = findSendButton(composer) || composer;
      log("send intercepted", { source: "submit", reason: "warning-visible" });
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const actionable = interceptSendAttempt(composer, { kind: "submit", form }, findSendButton(composer) || composer, "submit");
    if (!actionable.length) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function observeComposerRemounts() {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(() => {
      if (state.mutationDebounceId) {
        window.clearTimeout(state.mutationDebounceId);
      }
      state.mutationDebounceId = window.setTimeout(() => {
        refreshEditorState("mutation");
      }, MUTATION_DEBOUNCE_MS);
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function refreshEditorState(reason) {
    const composer = findBestComposer();
    const editorFound = isComposerUsable(composer);

    if (editorFound) {
      state.lastFocusedComposer = composer;
      const sendButton = findSendButton(composer);
      log("editor found", {
        reason,
        tag: composer.tagName.toLowerCase(),
        contentEditable: composer.getAttribute("contenteditable"),
        sendButtonFound: Boolean(sendButton)
      });
      if (sendButton) {
        log("send button found", {
          reason,
          text: collapseWhitespace(sendButton.innerText || sendButton.getAttribute("aria-label") || sendButton.getAttribute("title") || "")
        });
      }
    } else {
      state.selectionCandidate = null;
    }

    state.editorFound = editorFound;
    syncManualAddUi();
  }

  function scheduleInlineScan(composer, reason) {
    if (!state.enabled || !isComposerUsable(composer)) {
      return;
    }

    if (state.scanDebounceId) {
      window.clearTimeout(state.scanDebounceId);
    }
    state.scanDebounceId = window.setTimeout(() => {
      state.scanDebounceId = 0;
      performInlineScan(composer, reason);
    }, SCAN_DEBOUNCE_MS);
  }

  function performInlineScan(composer, reason) {
    if (!state.enabled || !isComposerUsable(composer)) {
      return;
    }
    const detection = runDetection(composer, reason);
    state.findingsCount = detection.actionable.length;

    if (!detection.actionable.length) {
      if (state.popupVisible && state.currentAction == null && composer === state.currentComposer) {
        resetFlow("inline clear", { preserveComposer: true, clearReport: true });
      } else {
        reportPageState([]);
      }
      return;
    }

    state.currentComposer = composer;
    state.currentComposerSnapshot = detection.snapshot;
    state.currentFindings = detection.findings;
    state.currentActionable = detection.actionable;
    state.activeFindingIndex = detection.actionable.length ? 0 : -1;
    state.currentAction = null;
    state.currentAnchor = findSendButton(composer) || composer;
    state.popupVisible = true;
    state.actionBusy = false;

    try {
      renderWarning(detection.actionable);
      reportPageState(detection.actionable);
    } catch (error) {
      handleUnexpectedError("inline warning render failed", error);
      console.warn("[SafePrompt Guard] inline findings fallback", detection.actionable);
    }
  }

  function interceptSendAttempt(composer, action, anchor, source) {
    const detection = runDetection(composer, source);
    if (!detection.actionable.length) {
      resetFlow("no findings", { preserveComposer: true, clearReport: true });
      return [];
    }

    state.currentComposer = composer;
    state.currentComposerSnapshot = detection.snapshot;
    state.currentFindings = detection.findings;
    state.currentActionable = detection.actionable;
    state.activeFindingIndex = detection.actionable.length ? 0 : -1;
    state.currentAction = action;
    state.currentAnchor = anchor || findSendButton(composer) || composer;
    state.popupVisible = true;
    state.actionBusy = false;

    try {
      renderWarning(detection.actionable);
    } catch (error) {
      handleUnexpectedError("warning render failed", error);
      console.warn("[SafePrompt Guard] findings fallback", detection.actionable);
      throw error;
    }
    armFlowTimeout();
    reportPageState(detection.actionable);

    log("send attempt intercepted", { source, findingsCount: detection.actionable.length });
    return detection.actionable;
  }

  function runDetection(composer, source) {
    const snapshot = createComposerSnapshot(composer, { includeBoundaries: true });
    const text = snapshot.text;
    log("detector started", { source, characters: text.length });

    let findings = [];
    try {
      findings = normalizeFindings(detector.detectSensitiveData(text));
    } catch (error) {
      handleUnexpectedError("detector failed", error);
      resetFlow("detector error", { preserveComposer: true, clearReport: true });
      showNotice("Check failed. Try send again.", "error", composer);
      return { findings: [], actionable: [], snapshot };
    }

    let actionable = [];
    try {
      actionable = normalizeFindings(detector.getActionableFindings(findings));
    } catch (error) {
      handleUnexpectedError("actionable findings failed", error);
      actionable = findings.filter((finding) => finding.severity === "HIGH" || finding.severity === "MEDIUM");
    }

    log("findings returned", {
      source,
      findingsCount: actionable.length,
      findings: actionable.map((finding) => ({
        type: finding.type,
        severity: finding.severity,
        preview: finding.preview || finding.match
      }))
    });
    log("detector completed", { source, findingsCount: actionable.length });
    return { findings, actionable, snapshot };
  }

  function renderWarning(actionable) {
    let warning = document.getElementById(WARNING_ID);
    if (!warning) {
      warning = document.createElement("section");
      warning.id = WARNING_ID;
      warning.className = "spg-warning";
      document.body.appendChild(warning);
    }

    const header = document.createElement("div");
    header.className = "spg-warning__header";
    header.addEventListener("pointerdown", startWarningDrag);

    const title = buildElement("div", "spg-warning__title", "Sensitive content detected");
    const dragHint = buildElement("div", "spg-warning__hint", "Drag to move");
    header.replaceChildren(title, dragHint);
    const summary = buildElement("div", "spg-warning__summary", safeCompactSummary(actionable));
    const details = document.createElement("div");
    details.className = "spg-warning__details";
    details.setAttribute("role", "list");

    const publicFindings = safePublicFindings(actionable);
    publicFindings.forEach((finding, index) => {
      details.appendChild(buildFindingItem(finding, index, index === state.activeFindingIndex));
    });

    const actions = document.createElement("div");
    actions.className = "spg-warning__actions";

    const primaryRow = document.createElement("div");
    primaryRow.className = "spg-warning__actions-primary";
    primaryRow.appendChild(buildButton("Mask all", "mask-all"));

    const secondaryRow = document.createElement("div");
    secondaryRow.className = "spg-warning__actions-secondary";
    secondaryRow.appendChild(buildButton("Cancel", "cancel"));
    secondaryRow.appendChild(buildButton("Add manually", "manual-open"));
    secondaryRow.appendChild(buildButton("Send anyway", "send"));

    actions.replaceChildren(primaryRow, secondaryRow);

    warning.replaceChildren(header, summary, details, actions);
    if (state.manualEntryOpen) {
      warning.appendChild(buildManualEntryForm());
    }
    if (state.warningPosition) {
      applyWarningPosition(warning, state.warningPosition.left, state.warningPosition.top);
    } else {
      placeFloatingBox(warning, state.currentAnchor || state.currentComposer);
    }
    updateFindingRowSelection();
    log("warning UI rendered", { findingsCount: actionable.length });
  }

  function handleWarningAction(target) {
    const button = target.closest("button[data-action]");
    if (button instanceof HTMLButtonElement) {
      const action = button.dataset.action;
      if (state.manualEntryBusy && action !== "manual-cancel") {
        return;
      }
      if (state.actionBusy && button.dataset.action !== "mask-one") {
        return;
      }
      log("popup action clicked", { action });

      if (action === "mask-one") {
        const index = Number(button.dataset.findingIndex);
        state.actionBusy = true;
        setActionButtonsDisabled(true);
        applySanitization("mask", {
          findings: [state.currentActionable[index]].filter(Boolean),
          remainingNotice: "Masked one finding. Remaining findings still need review.",
          clearedNotice: "Masked one finding. No remaining findings."
        });
        return;
      }

      if (action === "manual-open") {
        openManualEntryForm();
        return;
      }

      if (action === "manual-cancel") {
        closeManualEntryForm();
        return;
      }

      if (action === "manual-use-selected") {
        useSelectedForManualEntry();
        return;
      }

      if (action === "manual-add") {
        saveManualEntryFromWarning();
        return;
      }

      if (action === "cancel") {
        resetFlow("cancel", { preserveComposer: true, clearReport: true });
        return;
      }

      state.actionBusy = true;
      setActionButtonsDisabled(true);

      if (action === "mask-all") {
        applySanitization("mask", {
          findings: state.currentActionable,
          remainingNotice: "Masked all findings.",
          clearedNotice: "Masked all findings. Text is clean."
        });
        return;
      }

      releaseSend();
      return;
    }

    const findingRow = target.closest("[data-finding-index]");
    if (findingRow instanceof HTMLElement) {
      const index = Number(findingRow.dataset.findingIndex);
      focusFinding(index);
      return;
    }
  }

  function applySanitization(mode, options = {}) {
    const composer = state.currentComposer;
    const findings = Array.isArray(options.findings) && options.findings.length ? options.findings : state.currentFindings;

    if (!isComposerUsable(composer)) {
      showNotice("Composer moved. Try again.", "warning", state.currentAnchor);
      resetFlow(`${mode} invalid composer`, { clearReport: true });
      return;
    }

    const currentText = readComposerText(composer);
    let nextText = currentText;

    try {
      nextText = mode === "replace" ? detector.replaceSensitiveText(currentText, findings) : detector.maskSensitiveText(currentText, findings);
    } catch (error) {
      handleUnexpectedError(`${mode} failed`, error);
      showNotice(`${capitalize(mode)} failed. Use Cancel or Send anyway.`, "error", state.currentAnchor);
      state.actionBusy = false;
      setActionButtonsDisabled(false);
      return;
    }

    if (nextText === currentText) {
      showNotice("Nothing changed. Review and retry.", "warning", state.currentAnchor);
      state.actionBusy = false;
      setActionButtonsDisabled(false);
      return;
    }

    try {
      suppressInputEvents(() => {
        writeComposerText(composer, nextText);
      });
    } catch (error) {
      handleUnexpectedError(`${mode} write failed`, error);
      showNotice(`${capitalize(mode)} failed. Use Cancel or Send anyway.`, "error", state.currentAnchor);
      state.actionBusy = false;
      setActionButtonsDisabled(false);
      return;
    }

    if (findings.length === 1) {
      flashMaskedPosition(composer, findings[0], nextText);
    }

    refreshAfterSanitization(mode, composer, options);
    log(`${mode} applied`, { characters: nextText.length, findingsTouched: findings.length });
  }

  function releaseSend() {
    const composer = state.currentComposer;
    const action = state.currentAction;

    if (!isComposerUsable(composer)) {
      showNotice("Composer moved. Try again.", "warning", state.currentAnchor);
      resetFlow("send invalid composer", { clearReport: true });
      return;
    }

    allowOneSend(composer);
    resetFlow("send anyway", { preserveComposer: true, clearReport: true });
    if (action?.kind === "button" && action.button instanceof HTMLElement && action.button.isConnected) {
      action.button.focus?.();
    } else {
      composer.focus?.();
    }
    showNotice("Send unlocked. Press send again.", "info", state.currentAnchor || composer);
    log("send released", { mode: "next-real-send" });
  }

  function resetFlow(reason, options = {}) {
    clearFlowTimeout();
    hideWarning();
    stopWarningDrag();
    state.popupVisible = false;
    state.actionBusy = false;
    state.manualEntryOpen = false;
    state.manualEntryBusy = false;
    state.manualEntryValue = "";
    state.manualEntryType = state.selectionLearnedType;
    state.currentComposerSnapshot = null;
    state.currentFindings = [];
    state.currentActionable = [];
    state.activeFindingIndex = -1;
    state.currentAction = null;
    state.currentAnchor = null;
    state.selectionCandidate = null;
    if (state.flashTimeoutId) {
      window.clearTimeout(state.flashTimeoutId);
      state.flashTimeoutId = 0;
    }
    if (!options.preserveComposer) {
      state.currentComposer = null;
    }
    if (options.clearReport !== false) {
      reportPageState([]);
    }
    log("state reset", { reason });
  }

  function armFlowTimeout() {
    clearFlowTimeout();
    state.flowTimeoutId = window.setTimeout(() => {
      log("timeout fallback triggered");
      const anchor = state.currentAnchor || state.currentComposer;
      resetFlow("timeout", { preserveComposer: true, clearReport: true });
      showNotice("Guard reset. Try send again.", "warning", anchor);
    }, FLOW_TIMEOUT_MS);
  }

  function clearFlowTimeout() {
    if (state.flowTimeoutId) {
      window.clearTimeout(state.flowTimeoutId);
      state.flowTimeoutId = 0;
    }
  }

  function showNotice(message, tone, anchor) {
    removeNotice();

    const notice = document.createElement("section");
    notice.id = NOTICE_ID;
    notice.className = `spg-notice spg-notice--${tone || "info"}`;

    const text = buildElement("div", "spg-notice__text", message);
    const dismiss = buildButton("x", "dismiss-notice");
    dismiss.className = "spg-notice__dismiss";
    dismiss.setAttribute("aria-label", "Dismiss notice");

    notice.replaceChildren(text, dismiss);
    document.body.appendChild(notice);
    placeFloatingBox(notice, anchor || state.lastFocusedComposer || document.body);

    state.noticeTimeoutId = window.setTimeout(removeNotice, NOTICE_TIMEOUT_MS);
  }

  function removeNotice() {
    if (state.noticeTimeoutId) {
      window.clearTimeout(state.noticeTimeoutId);
      state.noticeTimeoutId = 0;
    }
    document.getElementById(NOTICE_ID)?.remove();
  }

  function setActionButtonsDisabled(disabled) {
    document.querySelectorAll(`#${WARNING_ID} button[data-action]`).forEach((button) => {
      button.disabled = disabled;
    });
  }

  function buildButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `spg-button spg-button--${action}`;
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function buildFindingItem(finding, index, isActive) {
    const item = document.createElement("div");
    item.className = `spg-warning__item${isActive ? " is-active" : ""}`;
    item.dataset.findingIndex = String(index);
    item.setAttribute("title", "Click to select this finding");

    const badge = document.createElement("span");
    badge.className = `spg-severity-badge spg-severity-badge--${(finding.severity || "medium").toLowerCase()}`;
    badge.textContent = (finding.severity || "MEDIUM").toUpperCase();

    const info = document.createElement("div");
    info.className = "spg-warning__itemInfo";
    const title = buildElement("div", "spg-warning__itemTitle", `${finding.type}: ${finding.preview}`);
    const meta = buildElement("div", "spg-warning__itemMeta", `→ ${finding.mask || finding.replacement || "[MASKED]"}`);
    info.replaceChildren(title, meta);

    const maskBtn = document.createElement("button");
    maskBtn.type = "button";
    maskBtn.className = "spg-button spg-button--mask-one";
    maskBtn.dataset.action = "mask-one";
    maskBtn.dataset.findingIndex = String(index);
    maskBtn.textContent = "Mask";

    item.replaceChildren(badge, info, maskBtn);
    return item;
  }

  function buildElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function buildTypeSelect(selectedType) {
    const select = document.createElement("select");
    select.className = "spg-selection__select";
    select.dataset.action = "learned-type";
    LEARNED_TYPE_OPTIONS.forEach((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      if (option.value === selectedType) {
        node.selected = true;
      }
      select.appendChild(node);
    });
    return select;
  }

  function buildManualEntryForm() {
    const form = document.createElement("div");
    form.className = "spg-manualEntry";

    const title = buildElement("div", "spg-manualEntry__title", "Add to local DB");
    const hint = buildElement(
      "div",
      "spg-manualEntry__hint",
      state.selectionCandidate ? "Use current selection or type a value." : "Type or paste a value, or use a prompt selection."
    );
    const input = document.createElement("textarea");
    input.className = "spg-manualEntry__input";
    input.dataset.action = "manual-value";
    input.rows = 3;
    input.placeholder = "Type or paste a value";
    input.value = state.manualEntryValue;

    const select = buildTypeSelect(state.manualEntryType || state.selectionLearnedType);
    select.className = "spg-manualEntry__select";
    select.dataset.action = "manual-type";

    const actions = document.createElement("div");
    actions.className = "spg-manualEntry__actions";
    actions.appendChild(buildButton("Use selected", "manual-use-selected"));
    actions.appendChild(buildButton("Cancel", "manual-cancel"));
    actions.appendChild(buildButton("Add", "manual-add"));

    form.replaceChildren(title, hint, input, select, actions);

    if (state.manualEntryBusy) {
      form.querySelectorAll("button, textarea, select").forEach((node) => {
        if (node instanceof HTMLButtonElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
          node.disabled = true;
        }
      });
    }

    return form;
  }

  function openManualEntryForm() {
    const candidate = getCurrentSelectionCandidate();
    state.manualEntryOpen = true;
    state.manualEntryBusy = false;
    state.manualEntryValue = candidate?.value || "";
    state.manualEntryType = state.selectionLearnedType || LEARNED_TYPE_OPTIONS[0].value;
    renderWarning(state.currentActionable);
  }

  function closeManualEntryForm() {
    state.manualEntryOpen = false;
    state.manualEntryBusy = false;
    state.manualEntryValue = "";
    renderWarning(state.currentActionable);
  }

  function useSelectedForManualEntry() {
    const candidate = getCurrentSelectionCandidate();
    if (!candidate) {
      showNotice("Select text in the prompt first.", "info", state.currentAnchor || state.currentComposer || state.lastFocusedComposer);
      return;
    }

    state.selectionCandidate = candidate;
    state.manualEntryValue = candidate.value;
    renderWarning(state.currentActionable);
  }

  async function saveManualEntryFromWarning() {
    if (state.manualEntryBusy) {
      return;
    }

    const value = normalizeManualEntryValue(state.manualEntryValue);
    if (!value) {
      showNotice("Type or paste a value first.", "warning", state.currentAnchor || state.currentComposer || state.lastFocusedComposer);
      return;
    }

    state.manualEntryBusy = true;
    renderWarning(state.currentActionable);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "safe-prompt-learned-add",
        value,
        learnedType: state.manualEntryType || state.selectionLearnedType
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not save local DB item.");
      }

      detector.setLearnedSecrets(response.learnedSecrets || []);
      state.selectionLearnedType = state.manualEntryType || state.selectionLearnedType;
      state.manualEntryOpen = false;
      state.manualEntryBusy = false;
      state.manualEntryValue = "";
      showNotice(response.updated ? "Updated in local DB." : "Saved to local DB.", "success", state.currentAnchor || state.currentComposer);
      refreshWarningDetection("manual-add");
    } catch (error) {
      handleUnexpectedError("manual add failed", error);
      state.manualEntryBusy = false;
      renderWarning(state.currentActionable);
      showNotice("Could not save to local DB.", "error", state.currentAnchor || state.currentComposer || state.lastFocusedComposer);
    }
  }

  function refreshWarningDetection(source) {
    const composer = state.currentComposer;
    if (!isComposerUsable(composer)) {
      return;
    }

    const detection = runDetection(composer, `${source}-refresh`);
    if (!detection.actionable.length) {
      resetFlow(`${source} refresh`, { preserveComposer: true, clearReport: true });
      return;
    }

    state.currentComposerSnapshot = detection.snapshot;
    state.currentFindings = detection.findings;
    state.currentActionable = detection.actionable;
    state.activeFindingIndex = Math.max(0, Math.min(state.activeFindingIndex, detection.actionable.length - 1));
    state.popupVisible = true;
    state.actionBusy = false;
    renderWarning(detection.actionable);
    reportPageState(detection.actionable);
    if (state.currentAction) {
      armFlowTimeout();
    }
    setActionButtonsDisabled(false);
  }

  function normalizeManualEntryValue(value) {
    const normalized = normalizeComposerText(String(value || ""));
    return normalized.trim();
  }

  function getCurrentSelectionCandidate() {
    return state.selectionCandidate || readCurrentSelectionCandidate();
  }

  function buildSelectionCandidatePayload() {
    const candidate = getCurrentSelectionCandidate();
    return candidate
      ? {
          value: candidate.value
        }
      : null;
  }

  function scheduleSelectionCandidateUpdate() {
    if (state.selectionDebounceId) {
      window.clearTimeout(state.selectionDebounceId);
    }

    state.selectionDebounceId = window.setTimeout(() => {
      state.selectionDebounceId = 0;
      updateSelectionCandidate();
    }, SELECTION_DEBOUNCE_MS);
  }

  function updateSelectionCandidate() {
    state.selectionCandidate = readCurrentSelectionCandidate();
  }

  function readCurrentSelectionCandidate() {
    return readTextareaSelectionCandidate() || readEditableSelectionCandidate();
  }

  function readTextareaSelectionCandidate() {
    const composer =
      (document.activeElement instanceof HTMLElement && findComposer(document.activeElement)) ||
      (isComposerUsable(state.lastFocusedComposer) ? state.lastFocusedComposer : null);

    if (!(composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) || document.activeElement !== composer) {
      return null;
    }

    const start = Number.isInteger(composer.selectionStart) ? composer.selectionStart : 0;
    const end = Number.isInteger(composer.selectionEnd) ? composer.selectionEnd : 0;
    if (end <= start) {
      return null;
    }

    return normalizeSelectionCandidate({
      composer,
      value: composer.value.slice(start, end),
      rect: null
    });
  }

  function readEditableSelectionCandidate() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const container =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const composer = findComposer(container);
    if (!isComposerUsable(composer) || !container || !composer.contains(container)) {
      return null;
    }

    return normalizeSelectionCandidate({
      composer,
      value: selection.toString(),
      rect: firstVisibleRect(range)
    });
  }

  function normalizeSelectionCandidate(candidate) {
    const value = normalizeComposerText(candidate?.value || "");
    if (!value.trim() || value.length < SELECTION_MIN_LENGTH || value.length > SELECTION_MAX_LENGTH) {
      return null;
    }

    return {
      composer: candidate.composer,
      value,
      rect: candidate.rect || null
    };
  }

  function renderSelectionBubble(candidate) {
    let bubble = document.getElementById(SELECTION_BUBBLE_ID);
    if (!bubble) {
      bubble = document.createElement("section");
      bubble.id = SELECTION_BUBBLE_ID;
      bubble.className = "spg-selection";
      document.body.appendChild(bubble);
    }

    const title = buildElement("div", "spg-selection__title", "Add to local DB");
    const preview = buildElement("div", "spg-selection__preview", maskSelectionPreview(candidate.value));
    const select = buildTypeSelect(state.selectionLearnedType);
    const actions = document.createElement("div");
    actions.className = "spg-selection__actions";
    actions.appendChild(buildButton("Cancel", "cancel-learned"));
    actions.appendChild(buildButton("Add", "add-learned"));

    bubble.replaceChildren(title, preview, select, actions);
    placeSelectionBubble(bubble, candidate);
  }

  function placeSelectionBubble(element, candidate) {
    const composer = isComposerUsable(candidate?.composer)
      ? candidate.composer
      : isComposerUsable(state.lastFocusedComposer)
        ? state.lastFocusedComposer
        : findBestComposer();
    if (!isComposerUsable(composer)) {
      placeFloatingBox(element, document.body);
      return;
    }

    const width = element.offsetWidth || 268;
    const height = element.offsetHeight || 146;
    const rect = composer.getBoundingClientRect();
    const preferredTop = rect.bottom + 10;
    const fallbackTop = rect.top - height - 10;
    let top =
      preferredTop + height <= window.innerHeight - 12
        ? preferredTop
        : Math.max(12, Math.min(window.innerHeight - height - 12, fallbackTop));
    let left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    const warning = document.getElementById(WARNING_ID);

    if (warning instanceof HTMLElement) {
      const warningRect = warning.getBoundingClientRect();
      const candidateRect = { left, top, right: left + width, bottom: top + height };
      if (rectsOverlap(candidateRect, warningRect)) {
        left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
        top =
          fallbackTop >= 12
            ? fallbackTop
            : Math.min(window.innerHeight - height - 12, Math.max(12, preferredTop));
      }
    }

    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
  }

  function handleSelectionBubbleAction(target) {
    const select = target.closest("select[data-action='learned-type']");
    if (select instanceof HTMLSelectElement) {
      state.selectionLearnedType = select.value;
      return;
    }

    const button = target.closest("button[data-action]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.action;
    if (action === "cancel-learned") {
      hideSelectionBubble();
      return;
    }

    if (action === "add-learned") {
      saveSelectionCandidate();
    }
  }

  async function saveSelectionCandidate() {
    if (state.selectionBusy || !state.selectionPanelCandidate) {
      return;
    }

    const candidate = state.selectionPanelCandidate;
    if (!isComposerUsable(candidate.composer)) {
      hideSelectionBubble();
      showNotice("Selection moved. Try again.", "warning", state.currentAnchor || state.lastFocusedComposer);
      return;
    }

    state.selectionBusy = true;
    setSelectionButtonsDisabled(true);

    try {
      const selectedType =
        document.querySelector(`#${SELECTION_BUBBLE_ID} select[data-action='learned-type']`) instanceof HTMLSelectElement
          ? document.querySelector(`#${SELECTION_BUBBLE_ID} select[data-action='learned-type']`).value
          : state.selectionLearnedType;
      state.selectionLearnedType = selectedType;
      const response = await chrome.runtime.sendMessage({
        type: "safe-prompt-learned-add",
        value: candidate.value,
        learnedType: selectedType
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not save local DB item.");
      }

      detector.setLearnedSecrets(response.learnedSecrets || []);
      hideSelectionBubble();
      showNotice(response.updated ? "Updated in local DB." : "Saved to local DB.", "success", candidate.composer);
      scheduleInlineScan(candidate.composer, "learned-add");
    } catch (error) {
      handleUnexpectedError("learned save failed", error);
      showNotice("Could not save to local DB.", "error", candidate.composer);
      setSelectionButtonsDisabled(false);
      state.selectionBusy = false;
      return;
    }

    state.selectionBusy = false;
  }

  function setSelectionButtonsDisabled(disabled) {
    document.querySelectorAll(`#${SELECTION_BUBBLE_ID} button, #${SELECTION_BUBBLE_ID} select`).forEach((node) => {
      if (node instanceof HTMLButtonElement || node instanceof HTMLSelectElement) {
        node.disabled = disabled;
      }
    });
  }

  function hideSelectionBubble() {
    state.selectionBusy = false;
    state.selectionCandidate = null;
    state.selectionPanelOpen = false;
    state.selectionPanelCandidate = null;
    document.getElementById(SELECTION_BUBBLE_ID)?.remove();
  }

  function maskSelectionPreview(value) {
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

  function placeFloatingBox(element, anchor) {
    const width = element.offsetWidth || 288;
    const height = element.offsetHeight || 140;
    const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;

    if (!rect) {
      element.style.left = `${window.innerWidth - width - 16}px`;
      element.style.top = `${window.innerHeight - height - 16}px`;
      return;
    }

    const preferredTop = rect.top - height - 10;
    const fallbackTop = rect.bottom + 10;
    const top = preferredTop >= 12 ? preferredTop : Math.min(window.innerHeight - height - 12, Math.max(12, fallbackTop));
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));

    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
  }

  function applyWarningPosition(element, left, top) {
    const width = element.offsetWidth || 320;
    const height = element.offsetHeight || 180;
    const safeLeft = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const safeTop = Math.max(12, Math.min(top, window.innerHeight - height - 12));
    element.style.left = `${Math.round(safeLeft)}px`;
    element.style.top = `${Math.round(safeTop)}px`;
    state.warningPosition = { left: safeLeft, top: safeTop };
  }

  function startWarningDrag(event) {
    if (!(event.target instanceof Element) || event.target.closest("button")) {
      return;
    }

    const warning = document.getElementById(WARNING_ID);
    if (!(warning instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    const rect = warning.getBoundingClientRect();
    state.warningDrag = {
      pointerId: event.pointerId,
      originLeft: rect.left,
      originTop: rect.top,
      startX: event.clientX,
      startY: event.clientY
    };
    window.addEventListener("pointermove", handleWarningDragMove);
    window.addEventListener("pointerup", stopWarningDrag, true);
    window.addEventListener("pointercancel", stopWarningDrag, true);
  }

  function handleWarningDragMove(event) {
    if (!state.warningDrag || event.pointerId !== state.warningDrag.pointerId) {
      return;
    }

    const warning = document.getElementById(WARNING_ID);
    if (!(warning instanceof HTMLElement)) {
      stopWarningDrag();
      return;
    }

    const nextLeft = state.warningDrag.originLeft + (event.clientX - state.warningDrag.startX);
    const nextTop = state.warningDrag.originTop + (event.clientY - state.warningDrag.startY);
    applyWarningPosition(warning, nextLeft, nextTop);
  }

  function stopWarningDrag(event) {
    if (event && state.warningDrag && event.pointerId !== state.warningDrag.pointerId) {
      return;
    }

    state.warningDrag = null;
    window.removeEventListener("pointermove", handleWarningDragMove);
    window.removeEventListener("pointerup", stopWarningDrag, true);
    window.removeEventListener("pointercancel", stopWarningDrag, true);
  }

  function repositionFloatingUi() {
    const warning = document.getElementById(WARNING_ID);
    if (warning) {
      if (state.warningPosition) {
        applyWarningPosition(warning, state.warningPosition.left, state.warningPosition.top);
      } else if (state.currentAnchor) {
        placeFloatingBox(warning, state.currentAnchor);
      }
    }

    const notice = document.getElementById(NOTICE_ID);
    if (notice) {
      placeFloatingBox(notice, state.currentAnchor || state.currentComposer || state.lastFocusedComposer);
    }

    syncManualAddUi();
  }

  function hideWarning() {
    document.getElementById(WARNING_ID)?.remove();
  }

  function updateFindingRowSelection() {
    document.querySelectorAll(`#${WARNING_ID} [data-finding-index]`).forEach((row) => {
      if (!(row instanceof HTMLElement)) {
        return;
      }
      row.classList.toggle("is-active", Number(row.dataset.findingIndex) === state.activeFindingIndex);
    });
  }

  function findBestComposer(root = document) {
    for (const selector of COMPOSER_SELECTORS) {
      const candidate = root.querySelector?.(selector);
      if (candidate instanceof HTMLElement && isComposerUsable(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function findComposer(target) {
    if (!(target instanceof Element)) {
      return findBestComposer();
    }
    const selector = COMPOSER_SELECTORS.join(", ");
    const composer = target.matches(selector) ? target : target.closest(selector);
    if (composer instanceof HTMLElement && isComposerUsable(composer)) {
      return composer;
    }
    return findBestComposer();
  }

  function getCurrentComposer(button) {
    if (isComposerUsable(state.lastFocusedComposer)) {
      return state.lastFocusedComposer;
    }
    const scopedComposer = button.closest("form, main, section, article, div")?.querySelector(COMPOSER_SELECTORS.join(", "));
    if (scopedComposer instanceof HTMLElement && isComposerUsable(scopedComposer)) {
      return scopedComposer;
    }
    return findBestComposer();
  }

  function findSendButton(composer) {
    if (!isComposerUsable(composer)) {
      return null;
    }
    const scope = composer.closest("form, main, section, article, div") || document.body;
    const button =
      findPrioritySendButton(scope) ||
      [...scope.querySelectorAll(BUTTON_SELECTORS.join(", "))].find((candidate) => candidate instanceof HTMLElement && isLikelySendButton(candidate)) ||
      findPrioritySendButton(document) ||
      [...document.querySelectorAll(BUTTON_SELECTORS.join(", "))].find((candidate) => candidate instanceof HTMLElement && isLikelySendButton(candidate)) ||
      null;
    if (button) {
      log("send button found", {
        text: collapseWhitespace(button.innerText || button.getAttribute("aria-label") || button.getAttribute("title") || "")
      });
    }
    return button;
  }

  function findPrioritySendButton(root) {
    for (const selector of PRIORITY_SEND_BUTTON_SELECTORS) {
      const candidate = root.querySelector?.(selector);
      if (candidate instanceof HTMLElement && isLikelySendButton(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function isLikelySendButton(button) {
    if (
      !(button instanceof HTMLElement) ||
      button.closest(`#${WARNING_ID}`) ||
      button.closest(`#${NOTICE_ID}`) ||
      button.closest(`#${SELECTION_BUBBLE_ID}`) ||
      button.closest(`#${MANUAL_TRIGGER_ID}`)
    ) {
      return false;
    }
    const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("title"), button.getAttribute("data-testid"), button.getAttribute("type")].filter(Boolean).join(" ").toLowerCase();
    return SEND_KEYWORDS.some((keyword) => text.includes(keyword));
  }

  function readComposerText(composer) {
    return createComposerSnapshot(composer).text;
  }

  function focusFinding(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.currentActionable.length) {
      return;
    }

    state.activeFindingIndex = index;
    updateFindingRowSelection();

    const composer = resolveComposerForFinding();
    const finding = state.currentActionable[index];
    const didHighlight = highlightFindingInComposer(composer, finding, state.currentComposerSnapshot);

    log("finding highlight requested", {
      index,
      success: didHighlight,
      type: finding?.type || "unknown",
      composerVersion: state.currentComposerSnapshot?.composerVersion || null
    });

    if (!didHighlight) {
      log("finding highlight fallback", {
        finding,
        composerTag: composer?.tagName || "unknown",
        composerVersion: state.currentComposerSnapshot?.composerVersion || null
      });
    }
  }

  function resolveComposerForFinding() {
    if (isComposerUsable(state.currentComposer)) {
      return state.currentComposer;
    }

    if (isComposerUsable(state.lastFocusedComposer)) {
      state.currentComposer = state.lastFocusedComposer;
      return state.lastFocusedComposer;
    }

    const composer = findBestComposer();
    if (isComposerUsable(composer)) {
      state.currentComposer = composer;
      return composer;
    }

    return null;
  }

  function highlightFindingInComposer(composer, finding, storedSnapshot) {
    if (!isComposerUsable(composer) || !finding) {
      return false;
    }

    const needsBoundaries = !(composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement);
    const liveSnapshot = createComposerSnapshot(composer, { includeBoundaries: needsBoundaries });
    const snapshotMatches =
      storedSnapshot &&
      storedSnapshot.composerId === liveSnapshot.composerId &&
      storedSnapshot.composerVersion === liveSnapshot.composerVersion;

    if (storedSnapshot && !snapshotMatches) {
      log("finding highlight snapshot drift", {
        storedVersion: storedSnapshot.composerVersion,
        liveVersion: liveSnapshot.composerVersion,
        findingType: finding.type || "unknown"
      });
    }

    const resolvedRange = resolveFindingRangeInText(liveSnapshot.text, finding);
    if (!resolvedRange) {
      composer.focus?.();
      composer.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return false;
    }
    const { start, end } = resolvedRange;

    composer.focus?.();
    composer.scrollIntoView?.({ block: "nearest", inline: "nearest" });

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const value = liveSnapshot.text;
      const safeStart = Math.max(0, Math.min(start, value.length));
      const safeEnd = Math.max(safeStart, Math.min(end, value.length));
      composer.setSelectionRange(safeStart, safeEnd, "forward");
      ensureSelectionVisible(composer, safeStart);
      return true;
    }

    return selectEditableRange(composer, start, end, liveSnapshot);
  }

  function resolveFindingRangeInText(text, finding) {
    const value = String(text || "");
    if (!value) {
      return null;
    }

    const expectedStart = Number(finding.start);
    const expectedEnd = Number(finding.end);
    const matchText = String(finding.match || "");

    if (Number.isInteger(expectedStart) && Number.isInteger(expectedEnd) && expectedEnd > expectedStart) {
      const clampedStart = Math.max(0, Math.min(expectedStart, value.length));
      const clampedEnd = Math.max(clampedStart, Math.min(expectedEnd, value.length));
      if (!matchText || value.slice(clampedStart, clampedEnd) === matchText) {
        return { start: clampedStart, end: clampedEnd };
      }
    }

    if (!matchText) {
      return Number.isInteger(expectedStart) && Number.isInteger(expectedEnd) && expectedEnd > expectedStart
        ? {
            start: Math.max(0, Math.min(expectedStart, value.length)),
            end: Math.max(0, Math.min(expectedEnd, value.length))
          }
        : null;
    }

    const exactMatches = findAllMatchStarts(value, matchText);
    if (exactMatches.length) {
      return rangeFromNearestMatch(exactMatches, matchText.length, Number.isInteger(expectedStart) ? expectedStart : 0);
    }

    const insensitiveMatches = findAllMatchStarts(value.toLowerCase(), matchText.toLowerCase());
    if (insensitiveMatches.length) {
      return rangeFromNearestMatch(insensitiveMatches, matchText.length, Number.isInteger(expectedStart) ? expectedStart : 0);
    }

    return null;
  }

  function createComposerSnapshot(composer, options = {}) {
    const includeBoundaries = Boolean(options.includeBoundaries);

    if (!isComposerUsable(composer)) {
      return {
        text: "",
        textSource: "missing",
        boundaries: [],
        composerId: null,
        composerVersion: "missing"
      };
    }

    const composerId = getComposerId(composer);

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const text = normalizeComposerText(composer.value || "");
      return {
        text,
        textSource: "value",
        boundaries: [],
        composerId,
        composerVersion: createComposerVersion(composerId, text, 0)
      };
    }

    const builder = {
      text: "",
      boundaries: [],
      includeBoundaries
    };

    appendComposerSnapshotNode(composer, builder, composer);

    return {
      text: builder.text,
      textSource: "contenteditable",
      boundaries: builder.boundaries,
      composerId,
      composerVersion: createComposerVersion(composerId, builder.text, builder.boundaries.length)
    };
  }

  function getComposerId(composer) {
    let composerId = composerIds.get(composer);
    if (!composerId) {
      composerId = nextComposerId;
      nextComposerId += 1;
      composerIds.set(composer, composerId);
    }
    return composerId;
  }

  function createComposerVersion(composerId, text, boundaryCount) {
    return `${composerId}:${text.length}:${boundaryCount}:${hashText(text)}`;
  }

  function hashText(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
  }

  function appendComposerSnapshotNode(node, builder, root) {
    if (node.nodeType === Node.TEXT_NODE) {
      appendComposerSnapshotTextNode(node, builder);
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node !== root && shouldSkipComposerSnapshotNode(node)) {
      return;
    }

    if (node.tagName === "BR") {
      appendComposerSnapshotSeparator(builder, "\n");
      return;
    }

    const isBlock = node !== root && isBlockLikeComposerNode(node);
    const previousLength = builder.text.length;

    node.childNodes.forEach((child) => {
      appendComposerSnapshotNode(child, builder, root);
    });

    if (isBlock && builder.text.length > previousLength) {
      appendComposerSnapshotSeparator(builder, "\n");
    }
  }

  function appendComposerSnapshotTextNode(node, builder) {
    const { text, rawOffsets } = normalizeTextWithOffsets(node.textContent || "");
    if (!text) {
      return;
    }

    const start = builder.text.length;
    builder.text += text;

    if (builder.includeBoundaries) {
      builder.boundaries.push({
        start,
        end: builder.text.length,
        node,
        rawOffsets
      });
    }
  }

  function appendComposerSnapshotSeparator(builder, separator) {
    if (!separator) {
      return;
    }

    if (separator === "\n") {
      if (!builder.text.length || builder.text.endsWith("\n")) {
        return;
      }
      builder.text += "\n";
      return;
    }

    builder.text += separator;
  }

  function normalizeTextWithOffsets(value) {
    let text = "";
    const rawOffsets = [0];

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];

      if (char === "\r") {
        if (value[index + 1] === "\n") {
          index += 1;
        }
        text += "\n";
        rawOffsets.push(index + 1);
        continue;
      }

      text += char === "\u00a0" ? " " : char;
      rawOffsets.push(index + 1);
    }

    return {
      text,
      rawOffsets
    };
  }

  function shouldSkipComposerSnapshotNode(node) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") {
      return true;
    }

    return (
      node.id === WARNING_ID ||
      node.id === NOTICE_ID ||
      node.id === SELECTION_BUBBLE_ID ||
      node.id === MANUAL_TRIGGER_ID ||
      node.tagName === "SCRIPT" ||
      node.tagName === "STYLE"
    );
  }

  function isBlockLikeComposerNode(node) {
    return COMPOSER_BLOCK_TAGS.has(node.tagName);
  }

  function findAllMatchStarts(text, needle) {
    const starts = [];
    if (!needle) {
      return starts;
    }

    let fromIndex = 0;
    while (fromIndex <= text.length) {
      const nextIndex = text.indexOf(needle, fromIndex);
      if (nextIndex === -1) {
        break;
      }
      starts.push(nextIndex);
      fromIndex = nextIndex + Math.max(needle.length, 1);
    }
    return starts;
  }

  function rangeFromNearestMatch(starts, length, expectedStart) {
    let nearestStart = starts[0];
    let nearestDistance = Math.abs(starts[0] - expectedStart);

    for (let index = 1; index < starts.length; index += 1) {
      const distance = Math.abs(starts[index] - expectedStart);
      if (distance < nearestDistance) {
        nearestStart = starts[index];
        nearestDistance = distance;
      }
    }

    return {
      start: nearestStart,
      end: nearestStart + length
    };
  }

  function ensureSelectionVisible(composer, start) {
    if (!(composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement)) {
      return;
    }

    const before = readComposerText(composer).slice(0, start);
    const lineIndex = before.split(/\r?\n/).length - 1;
    const lineHeight = Number.parseFloat(window.getComputedStyle(composer).lineHeight) || 20;
    composer.scrollTop = Math.max(0, lineIndex * lineHeight - composer.clientHeight / 3);
  }

  function selectEditableRange(root, start, end, snapshot) {
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    const activeSnapshot =
      snapshot?.textSource === "contenteditable" && Array.isArray(snapshot.boundaries) && snapshot.boundaries.length
        ? snapshot
        : createComposerSnapshot(root, { includeBoundaries: true });

    const startBoundary = resolveSnapshotBoundary(activeSnapshot, start, "start");
    const endBoundary = resolveSnapshotBoundary(activeSnapshot, end, "end");
    if (!startBoundary || !endBoundary) {
      return false;
    }

    let range = null;
    try {
      range = document.createRange();
      range.setStart(startBoundary.node, startBoundary.offset);
      range.setEnd(endBoundary.node, endBoundary.offset);
    } catch (error) {
      log("editable range selection failed", {
        message: error instanceof Error ? error.message : String(error),
        start,
        end
      });
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);

    const anchorElement = range.startContainer.parentElement;
    scrollRangeIntoView(root, range, anchorElement);
    return true;
  }

  function resolveSnapshotBoundary(snapshot, targetOffset, affinity) {
    if (!snapshot?.boundaries?.length) {
      return null;
    }

    const safeOffset = Math.max(0, Math.min(targetOffset, snapshot.text.length));
    let previous = null;

    for (const boundary of snapshot.boundaries) {
      if (safeOffset < boundary.start) {
        return previous && affinity === "end"
          ? boundaryFromSnapshot(previous, previous.end)
          : boundaryFromSnapshot(boundary, boundary.start);
      }

      if (safeOffset <= boundary.end) {
        return boundaryFromSnapshot(boundary, safeOffset);
      }

      previous = boundary;
    }

    return previous ? boundaryFromSnapshot(previous, previous.end) : null;
  }

  function boundaryFromSnapshot(boundary, targetOffset) {
    const localOffset = Math.max(0, Math.min(targetOffset - boundary.start, boundary.rawOffsets.length - 1));
    return {
      node: boundary.node,
      offset: boundary.rawOffsets[localOffset] || 0
    };
  }

  function scrollRangeIntoView(root, range, anchorElement) {
    const selectionRect = firstVisibleRect(range);
    if (!selectionRect) {
      anchorElement?.scrollIntoView?.({ block: "center", inline: "nearest" });
      return;
    }

    const scrollContainer = findScrollableAncestor(anchorElement, root) || findScrollableAncestor(root.parentElement, document.body);
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const offsetTop = selectionRect.top - containerRect.top + scrollContainer.scrollTop;
      const targetScrollTop = Math.max(0, offsetTop - scrollContainer.clientHeight / 2 + selectionRect.height / 2);
      scrollContainer.scrollTop = targetScrollTop;
      anchorElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return;
    }

    anchorElement?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }

  function firstVisibleRect(range) {
    const rects = range.getClientRects();
    if (rects.length > 0) {
      return rects[0];
    }
    const fallback = range.getBoundingClientRect();
    return fallback && fallback.height >= 0 ? fallback : null;
  }

  function findScrollableAncestor(startElement, stopRoot) {
    let current = startElement instanceof Element ? startElement : null;
    while (current && current !== document.body) {
      if (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight + 8) {
          return current;
        }
      }
      if (current === stopRoot) {
        break;
      }
      current = current.parentElement;
    }
    return null;
  }

  function syncManualAddUi() {
    document.getElementById(MANUAL_TRIGGER_ID)?.remove();
  }

  function rectsOverlap(a, b) {
    if (!a || !b) {
      return false;
    }
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function flashMaskedPosition(composer, finding, maskedText) {
    if (!isComposerUsable(composer) || !finding) {
      return;
    }

    // Clear any previous flash timer
    if (state.flashTimeoutId) {
      window.clearTimeout(state.flashTimeoutId);
      state.flashTimeoutId = 0;
    }

    const maskValue = String(finding.mask || finding.replacement || "");
    if (!maskValue) {
      return;
    }

    const start = Number(finding.start);
    if (!Number.isInteger(start) || start < 0) {
      return;
    }

    const end = Math.min(start + maskValue.length, maskedText.length);

    composer.focus?.();

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      try {
        composer.setSelectionRange(start, end, "forward");
        ensureSelectionVisible(composer, start);
      } catch (_) {}
    } else {
      const snapshot = createComposerSnapshot(composer, { includeBoundaries: true });
      selectEditableRange(composer, start, end, snapshot);
    }

    // Clear the selection after 2s so the user isn't left with a stray selection
    state.flashTimeoutId = window.setTimeout(() => {
      state.flashTimeoutId = 0;
      try {
        if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
          composer.setSelectionRange(end, end);
        } else {
          const sel = window.getSelection();
          sel?.removeAllRanges();
        }
      } catch (_) {}
    }, 2000);
  }

  function refreshAfterSanitization(mode, composer, options = {}) {
    const detection = runDetection(composer, `${mode}-refresh`);
    const remaining = detection.actionable.length;

    if (!remaining) {
      resetFlow(`${mode} applied`, { preserveComposer: true, clearReport: true });
      showNotice(options.clearedNotice || successNoticeText(mode, 0), "success", composer);
      return;
    }

    state.currentComposer = composer;
    state.currentComposerSnapshot = detection.snapshot;
    state.currentFindings = detection.findings;
    state.currentActionable = detection.actionable;
    state.activeFindingIndex = Math.min(state.activeFindingIndex, remaining - 1);
    if (state.activeFindingIndex < 0) {
      state.activeFindingIndex = 0;
    }
    state.popupVisible = true;
    state.actionBusy = false;
    renderWarning(detection.actionable);
    reportPageState(detection.actionable);
    if (state.currentAction) {
      armFlowTimeout();
    }
    setActionButtonsDisabled(false);
    showNotice(options.remainingNotice || successNoticeText(mode, remaining), "info", state.currentAnchor || composer);
  }

  function writeComposerText(composer, nextText) {
    if (!isComposerUsable(composer)) {
      throw new Error("Composer is no longer available.");
    }
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(composer, nextText);
      } else {
        composer.value = nextText;
      }
    } else if (composer instanceof HTMLElement) {
      composer.innerText = nextText;
    }

    composer.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, data: nextText, inputType: "insertText" }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function normalizeComposerText(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ");
  }

  function suppressInputEvents(fn) {
    state.suppressInput = true;
    try {
      fn();
    } finally {
      window.setTimeout(() => {
        state.suppressInput = false;
      }, 0);
    }
  }

  function allowOneSend(composer) {
    state.bypassComposer = composer;
    state.bypassUntil = Date.now() + BYPASS_WINDOW_MS;
  }

  function shouldBypass(composer) {
    return state.bypassComposer === composer && Date.now() < state.bypassUntil;
  }

  function clearBypass() {
    state.bypassComposer = null;
    state.bypassUntil = 0;
  }

  function reportPageState(findings) {
    const signature = safeSignature(findings);
    if (signature === state.lastReportedSignature) {
      return;
    }

    let publicFindings = [];
    try {
      publicFindings = findings.length ? detector.toPublicFindings(findings) : [];
    } catch (error) {
      handleUnexpectedError("public finding build failed", error);
      publicFindings = normalizeFindings(findings);
    }

    state.lastReportedSignature = signature;
    chrome.runtime
      .sendMessage({
        type: "safe-prompt-page-state",
        signature,
        highestSeverity: findings.length ? detector.getHighestSeverity(findings) : "NONE",
        summary: findings.length ? safeCompactSummary(findings) : "",
        findings: publicFindings
      })
      .catch(() => {});
  }

  function normalizeFindings(findings) {
    if (!Array.isArray(findings)) {
      return [];
    }
    return findings
      .filter((finding) => finding && typeof finding === "object" && typeof finding.type === "string" && typeof finding.severity === "string")
      .map((finding) => ({
        ...finding,
        type: String(finding.type),
        severity: normalizeSeverity(finding.severity),
        reason: String(finding.reason || "Sensitive content"),
        preview: String(finding.preview || ""),
        replacement: String(finding.replacement || ""),
        mask: String(finding.mask || "")
      }));
  }

  function normalizeSeverity(value) {
    return value === "LOW" || value === "MEDIUM" || value === "HIGH" ? value : "HIGH";
  }

  function safeDisplayItems(findings) {
    try {
      return detector.getDisplayItems(findings);
    } catch (error) {
      handleUnexpectedError("display item build failed", error);
      return normalizeFindings(findings).slice(0, 2).map((finding) => ({
        label: finding.type,
        preview: finding.preview || "hidden",
        replacement: finding.replacement || "[REDACTED]",
        mask: finding.mask || "[MASKED]"
      }));
    }
  }

  function safePublicFindings(findings) {
    try {
      return detector.toPublicFindings(findings);
    } catch (error) {
      handleUnexpectedError("public finding detail build failed", error);
      return safeDisplayItems(findings).map((item) => ({
        type: item.label || "Secret",
        preview: item.preview || "hidden",
        replacement: item.replacement || "[REDACTED]",
        mask: item.mask || item.replacement || "[MASKED]"
      }));
    }
  }

  function successNoticeText(mode, remaining) {
    return remaining > 0 ? `Masked. ${remaining} finding${remaining === 1 ? "" : "s"} remaining.` : "Masked. No remaining findings.";
  }

  function safeCompactSummary(findings) {
    try {
      return detector.buildCompactSummary(findings) || "Possible secret detected";
    } catch (error) {
      handleUnexpectedError("summary build failed", error);
      return "Possible secret detected";
    }
  }

  function safeSignature(findings) {
    try {
      return detector.buildSignature(findings);
    } catch (error) {
      handleUnexpectedError("signature build failed", error);
      return JSON.stringify(normalizeFindings(findings).map((finding) => [finding.type, finding.severity, finding.reason]));
    }
  }

  function isComposerUsable(composer) {
    return composer instanceof HTMLElement && composer.isConnected;
  }

  function safely(name, handler) {
    return (event) => {
      try {
        handler(event);
      } catch (error) {
        handleUnexpectedError(`${name} handler failed`, error);
        resetFlow(`${name} error`, { preserveComposer: true, clearReport: true });
        showNotice("Guard reset after an error.", "error", state.currentAnchor || state.currentComposer || state.lastFocusedComposer);
      }
    };
  }

  function handleUnexpectedError(label, error) {
    log("unexpected error caught", { label, message: error instanceof Error ? error.message : String(error) });
    console.error("[SafePrompt Guard]", label, error);
  }

  function log(message, details) {
    if (!state.debug) {
      return;
    }
    if (details === undefined) {
      console.log("[SafePrompt Guard]", message);
      return;
    }
    console.log("[SafePrompt Guard]", message, details);
  }

  function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(label)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }

  function collapseWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function capitalize(value) {
    return value ? value[0].toUpperCase() + value.slice(1) : value;
  }
})();
