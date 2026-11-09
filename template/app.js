(() => {
  "use strict";

  // Voice-part colours live in the stylesheet, as --part-1 upward, so the dark
  // theme can lift them off its own ground. These are only the fallbacks the
  // var() calls carry, and they match the light theme's values.
  const PALETTE = Object.freeze([
    "#ac345e",
    "#855418",
    "#086b7c",
    "#64499b",
    "#4f8265",
    "#925b91",
    "#a75e3b",
    "#3d7898",
  ]);
  const partPaint = (index) => `var(--part-${(index % PALETTE.length) + 1}, ${PALETTE[index % PALETTE.length]})`;
  const TEMPO_VALUES = Object.freeze(Array.from({ length: 26 }, (_, index) => 25 + index * 5));
  const VERTICAL_VALUES = Object.freeze([50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]);
  const STANDARD_HORIZONTAL_VALUES = Object.freeze([5, 10, 15, 20, 25, 35, 50, 65, 80, 100, 120, 140, 160, 180, 200,
    220, 240, 260, 280, 300, 320, 340, 360, 380, 400]);
  const HORIZONTAL_VALUES = Object.freeze(Array.from({ length: 80 }, (_, index) => (index + 1) * 5));
  const PITCH_BAR_UNIT_WIDTH = 16;
  const VOLUME_VALUES = Object.freeze(Array.from({ length: 41 }, (_, index) => index * 5));
  const PAN_VALUES = Object.freeze(Array.from({ length: 41 }, (_, index) => index * 5 - 100));
  const METRONOME_VALUES = Object.freeze(Array.from({ length: 21 }, (_, index) => index * 10));
  const PITCH_CONFIDENCE_THRESHOLD = 0.7;
  const SCHEDULER_INTERVAL_MS = 40;
  const SCHEDULER_HORIZON_SECONDS = 0.34;
  const SCHEDULER_LEAD_SECONDS = 0.028;
  const PITCH_BAR_HYPHEN_LEEWAY = 2;
  // Fractions of a bar note's height, by metric weight: downbeat, middle of the
  // bar, plain beat. The tallest stays clear of a reattack line, which cuts the
  // whole height and means something else entirely.
  const BEAT_TICK_HEIGHTS = Object.freeze([0.7, 0.55, 0.4]);
  const MIXER_SOLO_HOLD_MS = 500;
  const PITCH_AUDITION_HOLD_MS = 250;
  const KEYBOARD_NOTE_PREVIEW_SECONDS = 0.22;
  const PITCH_AUDITION_RELEASE_SECONDS = 0.12;
  const PITCH_CAPTURE_INTERVAL_MS = 10;
  const PITCH_CAPTURE_FALLBACK_INTERVAL_MS = 100;
  const PITCH_CAPTURE_BUFFER_SIZE = 4096;
  const PITCH_CAPTURE_MIN_FREQUENCY = 55;
  const PITCH_CAPTURE_MAX_FREQUENCY = 1200;
  const PITCH_TRACE_STORAGE_VERSION = 3;
  const PITCH_TRACE_BINS_PER_QUARTER = 64;
  const PITCH_TRACE_SAVE_DELAY_MS = 850;
  const PITCH_TRACE_MAX_DRAW_GAP_SECONDS = 0.25;
  const PITCH_TRACE_RENDER_JUMP_CENTS = 400;
  const PITCH_TRACE_GREEN_TOLERANCE_CENTS = 10;
  const PITCH_TRACE_RED_CENTS = 50;
  const STAFF_TRACE_CENTS_PER_STEP = 50;
  const LYRIC_FONT_SIZE = 14;
  const PORTABLE_STATE_VERSION = 1;
  const NOTATION_RENDER_TIMEOUT_MS = 6000;
  const FOLLOW_CHECK_INTERVAL_MS = 60;
  const FOLLOW_SCROLL_LEAD_BUFFER_MS = 80;
  const HORIZONTAL_READING_FRACTION = 0.4;
  const reducedFollowMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  let api = null;
  let engine = null;
  let sequence = null;
  let conductor = null;
  let conductorMode = false;
  let pitchBarUnitTicks = 960;
  let config = {};
  let referencePlayer = null;
  let buildMetadata = {};
  let portableState = null;
  let initialDocumentSource = "";
  let scoreTracks = [];
  let rangePreviews = [];
  const heldNotePreviews = new Map();
  let parts = [];
  let ready = false;
  let initialLoopRestored = false;
  let pendingLoopRevealTick = null;
  let loadFailed = false;
  let playing = false;
  let seeking = false;
  let chapterSeekMilliseconds = [];
  let renderTimer = 0;
  let notationRenderInFlight = false;
  let notationRenderQueued = false;
  let notationRenderTimeout = 0;
  let notationHasRendered = false;
  let notationRenderFailed = false;
  let scoreRenderSnapshot = null;
  let scoreRenderSnapshotTimer = 0;
  let scoreRenderStyleLock = null;
  let toastTimer = 0;
  let toastAction = null;
  let lastFollow = 0;
  let followedScoreLeft = null;
  let horizontalGestureUntil = 0;
  let followScrollFrame = 0;
  let cursorTrimFrame = 0;
  let cursorTrimBurstGeneration = 0;
  let cursorTrimObserver = null;
  let cursorTrimTargets = [];
  const cursorStaffGeometry = new WeakMap();
  let fullRestCenterGeneration = 0;
  let automaticScrollUntil = 0;
  let playbackDetached = false;
  let verticalFollowAnimationFrame = 0;
  let verticalFollowAnimationGeneration = 0;
  let predictiveFollowRange = null;
  let pinchActive = false;
  let pinchStartDistance = 0;
  let pinchStartScale = 100;
  let pinchTargetScale = 100;
  let pinchSurface = null;
  let scoreResizeObserver = null;
  let lastScoreShellWidth = 0;
  let flow = "wrap";
  let scoreView = "standard";
  let lyricsMode = "full";
  let fullScoreXml = "";
  let writtenDynamicForBeat = null;
  let pendingNotationReload = null;
  let loopStartMeasure = null;
  let loopEnabled = true;
  let loopEndMeasure = null;
  let loopStartTick = null;
  let loopEndTick = null;
  let pendingLoopLink;
  let linkedPracticeState = null;
  let practicePartIndex = null;
  let partDivisi = [];
  let mixerParts = [];
  const practiceMixerIndex = () => {
    if (!Number.isInteger(practicePartIndex)) return null;
    return mixerParts.findIndex(p => p.source === practicePartIndex && p.line === (practiceDivisi[practicePartIndex] ?? null));
  };
  let practicePartPager = null;
  let lastGuideChannel = null, relativeMix = null, relativeGuide = null;
  let practiceDivisi = [];
  let practiceDivisiPager = null;
  let activePracticeMix = null;
  let practiceMixPartIndex = null;
  let practiceMixUndo = null;
  let editingAnnotation = null;
  let annotationDragActive = false;
  let selectedScoreTick = null;
  let selectedScorePartIndex = null;
  let keyboardAudition = null;
  let scoreScrub = null;
  const pitchAuditions = new Map();
  let sectionGuideGeneration = 0;
  let preferenceKey = "choir-practice-trainer:v1";
  let settingsPanelPreferenceKey = "choir-practice:settings-open:v1";
  const settingsSectionsKey = window.MeleteConductor?.requested()
    ? "choir-practice:conductor-mobile-sections:v1" : "choir-practice:mobile-sections:v1";
  const desktopSectionsKey = settingsSectionsKey.replace("mobile-sections", "desktop-sections");
  const settingsSections = new Map();
  let settingsSectionsMedia = null;
  let mobileSectionOpen = {practice: true};
  let desktopSectionOpen = {};
  let annotationKey = "choir-practice-trainer:notes:v3";
  let legacyAnnotationKeys = [];
  let legacyPreferenceKeys = [];
  let legacySettingsPanelKeys = [];
  let legacyPitchTraceKeys = [];
  let pitchTraceKey = "choir-practice-trainer:pitch-trace:v2";
  let pitchTraceBaseKey = "";
  // One contour per divisi line, so the upper and the lower line of the same
  // passage can both be kept instead of the second take erasing the first.
  // Lane 0 is the top line, and the only lane an undivided part ever uses.
  const pitchTraceLanes = new Map();
  let pitchTraceCount = 0;
  let pitchTraceLoaded = false;
  let pitchTraceSaveTimer = 0;
  let pitchTracePaintFrame = 0;
  const pitchTraceDirty = new Map();
  let pitchCaptureState = "off";
  let microphoneRequest = null;
  let microphoneDeviceId = "";
  let microphoneStreamDeviceId = "";
  let retainRecordingInput = false;
  let microphoneCheck = null;
  let timingOutputDevice = "", timingCache = {key:null, seconds:null};
  let takeState = "off";
  let takeCountIn = null;
  let takeCountHideTimer = 0;
  let takeRequestGeneration = 0;
  let takeCapture = null;
  let takeJournal = null;
  // Audio capture is armed only in this session. Sing can also be used on its own.
  let recordAudio=false, captureIsAudio=false, practiceWriter=null, preparingCapture=null;
  let practiceTraceIdentity="", practiceTraceRecord=null, practiceTraceRow=null, practiceTraceRef=null, practiceTraceTicket=0;
  const takeStore = new window.MeleteRecording.TakeStore();
  let recordingTimeRequest = null;
  let recordingDayTimer = 0;
  let takeLibrary = new Map();
  let takeLibraryRequest = null;
  let takeLibraryReady = false;
  let takePersistence = false;
  let takePersistenceRequested = false;
  let takeChannel = null;
  let takeVisibleCount = 25;
  let takeSort = window.MeleteTakePitch.takeSort();
  try { takeSort = window.MeleteTakePitch.takeSort(JSON.parse(localStorage.getItem("melete:take-sort"))); } catch {}
  let takeActionBusy = false;
  let takeDeleteTimer = 0;
  let takeOtherBytes = 0;
  let takePreviewId = null;
  let takePreviewGeneration = 0;
  let takeRefreshTimer = 0;
  let takeReview = null;
  let inspectedTakeId = null; // An explicit review, independent of the track armed for overdub.
  let pendingCaptureTrace = null;
  const takeVisualReviews = new Map();
  const takeLayerLoads = new Map();
  let takeHearBatch = null;
  let takeOctaves = null;
  const takeOctavePagers = new WeakMap();
  let takeTimelineReview = null, takeTimeline = null;
  let compPanel = null;
  let takeReviewWorker = null;
  let takeStopPromise = null;
  let takeNotice = "";
  let takeScoring = null;
  const takeScoreFailures = new Map();
  let singEnabled = false;
  function wantsPitchCapture() {
    return singEnabled || recordAudio;
  }
  // A collection's hidden song stays inactive until melete:activate.
  let pitchCapturePageActive = !window.frameElement?.inert;
  let pitchCaptureNotice = "";
  let pitchCaptureStream = null;
  let pitchCaptureContext = null;
  let pitchCaptureSource = null;
  let pitchCaptureAnalyser = null;
  let pitchCaptureWorker = null;
  let pitchCaptureBuffer = null;
  let pitchCaptureTimer = 0;
  let pitchCaptureIntervalMs = PITCH_CAPTURE_INTERVAL_MS;
  let pitchCaptureCadenceMs = PITCH_CAPTURE_INTERVAL_MS;
  let pitchCapturePreviousAudioTime = null;
  let pitchCapturePreviousTick = null;
  let pitchCapturePreviousSeconds = null;
  let pitchCaptureWasSilent = true;
  let pitchLastAcceptedCents = null;
  let pitchPendingEvidence = null;
  let pitchCaptureMisses = 0;
  let pitchCaptureUnvoicedFrame = null;
  let pitchOctaveHistory = [];
  let barRenderFrame = 0;
  let barTraceResumeTimer = 0;
  let barSystems = [];
  let recordingBarRanges = null;
  let staffTraceSystems = [];
  let activeBarSystemIndex = -1;
  let barPlayheadMotion = null;
  let scoreKeyPitchClasses = { tonic: 7, dominant: 2, third: 11 };

  const visibleTracks = new Set();
  const visibleChannels = new Set();
  const audibleTracks = new Set();
  const annotations = new Map();
  let trackVolumes = [];
  let trackPans = [];
  const volumeControls = [];
  const panControls = [];
  let settingsHelpEnabled = false;
  let settingsTooltipTarget = null;
  let settingsTooltipTimer = 0;
  let partChooserKey = "";
  let partChooserThen = null;
  let pendingPartLink = null;
  let explicitPracticeChoice = false;

  const elements = {
    transport: document.querySelector(".transport"),
    playPause: document.getElementById("playPause"),
    seek: document.getElementById("seek"),
    timelineRail: document.getElementById("timelineRail"),
    timelineSegments: document.getElementById("timelineSegments"),
    takeTimeline: document.getElementById("takeTimeline"),
    takeTimelineDescription: document.getElementById("takeTimelineDescription"),
    loopBand: document.getElementById("loopBand"),
    currentTime: document.getElementById("currentTime"),
    totalTime: document.getElementById("totalTime"),
    scoreShell: document.getElementById("scoreShell"),
    score: document.getElementById("score"),
    barScore: document.getElementById("barScore"),
    scoreLoading: document.getElementById("scoreLoading"),
    scoreLoadingText: document.getElementById("scoreLoadingText"),
    playbackReturn: document.getElementById("playbackReturn"),
    mixer: document.getElementById("mixer"),
    practicePart: document.getElementById("practicePart"),
    tempo: document.getElementById("tempo"),
    metronome: document.getElementById("metronome"),
    verticalScale: document.getElementById("verticalScale"),
    horizontalScale: document.getElementById("horizontalScale"),
    flowToggle: document.getElementById("flowToggle"),
    scoreViewToggle: document.getElementById("scoreViewToggle"),
    pitchCapture: document.getElementById("pitchCapture"),
    settingsToggle: document.getElementById("settingsToggle"),
    settingsPanel: document.getElementById("settingsPanel"),
    settingsHelp: document.getElementById("settingsHelp"),
    settingsTooltip: document.getElementById("settingsTooltip"),
    shortcutTip: document.getElementById("shortcutTip"),
    shortcutTipMessage: document.getElementById("shortcutTipMessage"),
    shortcutTipDismiss: document.getElementById("shortcutTipDismiss"),
    loopStart: document.getElementById("loopStart"),
    loopToggle: document.getElementById("loopToggle"),
    loopEnd: document.getElementById("loopEnd"),
    loopControls: document.getElementById("loopControls"),
    fullscreen: document.getElementById("fullscreen"),
    noteMode: document.getElementById("noteMode"),
    download: document.getElementById("download"),
    demoVideo: document.getElementById("demoVideo"),
    printScore: document.getElementById("printScore"),
    downloadScore: document.getElementById("downloadScore"),
    toast: document.getElementById("toast"),
    toastMessage: document.getElementById("toastMessage"),
    toastUndo: document.getElementById("toastUndo"),
    partChooser: document.getElementById("partChooser"),
    partChooserOptions: document.getElementById("partChooserOptions"),
    partChooserNote: document.getElementById("partChooserNote"),
    partChooserTitle: document.getElementById("partChooserTitle"),
    partChooserDismiss: document.getElementById("partChooserDismiss"),
    scrubLabel: document.getElementById("scrubLabel"),
    takePanel: document.getElementById("takePanel"),
    takeMicrophone: document.getElementById("takeMicrophone"),
    checkMicrophone: document.getElementById("checkMicrophone"),
    takeStatus: document.getElementById("takeStatus"),
    takeCountIn: document.getElementById("takeCountIn"),
    takeStorage: document.getElementById("takeStorage"),
    takeList: document.getElementById("takeList"),
    takeColumns: document.getElementById("takeColumns"),
    exitTakeReview: document.getElementById("exitTakeReview"),
    takeMore: document.getElementById("takeMore"),
    retryTakeSave: document.getElementById("retryTakeSave"),
    takeDeletePrompt: document.getElementById("takeDeletePrompt"),
    takeDeleteMessage: document.getElementById("takeDeleteMessage"),
    takeActions: document.getElementById("takeActions"),
    takeLoose: document.getElementById("takeLoose"),
    takeLooseMessage: document.getElementById("takeLooseMessage"),
    deleteLooseTakes: document.getElementById("deleteLooseTakes"),
    takeUndo: document.getElementById("takeUndo"),
    takeUndoMessage: document.getElementById("takeUndoMessage"),
    undoTakeDelete: document.getElementById("undoTakeDelete"),
    confirmTakeDelete: document.getElementById("confirmTakeDelete"),
    cancelTakeDelete: document.getElementById("cancelTakeDelete"),
  };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function nearestAllowed(value, values) {
    return values.reduce(
      (best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
      values[0],
    );
  }

  function describeSettingsTooltip(target, enabled) {
    if (!target) return;
    const ids = (target.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== "settingsTooltip");
    if (enabled) ids.push("settingsTooltip");
    if (ids.length) target.setAttribute("aria-describedby", ids.join(" "));
    else target.removeAttribute("aria-describedby");
  }

  function hideSettingsTooltip() {
    window.clearTimeout(settingsTooltipTimer);
    settingsTooltipTimer = 0;
    describeSettingsTooltip(settingsTooltipTarget, false);
    settingsTooltipTarget = null;
    elements.settingsTooltip.classList.remove("is-visible");
    elements.settingsTooltip.setAttribute("aria-hidden", "true");
    elements.settingsTooltip.hidden = true;
  }

  function positionSettingsTooltip(target) {
    if (!target || elements.settingsTooltip.hidden) return;
    const targetBounds = target.getBoundingClientRect();
    const tooltipBounds = elements.settingsTooltip.getBoundingClientRect();
    const margin = 8;
    const centeredLeft = targetBounds.left + targetBounds.width / 2 - tooltipBounds.width / 2;
    const left = clamp(centeredLeft, margin, Math.max(margin, window.innerWidth - tooltipBounds.width - margin));
    const fitsBelow = targetBounds.bottom + margin + tooltipBounds.height <= window.innerHeight - margin;
    const top = fitsBelow
      ? targetBounds.bottom + margin
      : Math.max(margin, targetBounds.top - tooltipBounds.height - margin);
    elements.settingsTooltip.style.left = `${Math.round(left)}px`;
    elements.settingsTooltip.style.top = `${Math.round(top)}px`;
  }

  // A control's own line, then how to reset it. Row and section labels carry no
  // line of their own, so theirs names what it resets; anywhere else the
  // tooltip already sits on the thing, so it does not repeat the name.
  const SETTING_HELP_SELECTOR = "[data-help], [data-reset-scope]";

  function settingHelpMessage(target) {
    const own = target.dataset.help?.trim();
    const scope = target.dataset.resetScope;
    if (!scope) return own || "";
    const hold = target.dataset.resetHold === "true" ? " or hold" : "";
    return [own, `Right-click${hold} to reset${own ? "" : ` ${scope}`}.`].filter(Boolean).join(" ");
  }

  function showSettingsTooltip(target, { delay = 120 } = {}) {
    if (!settingsHelpEnabled || !(target instanceof Element)) return;
    const message = settingHelpMessage(target);
    if (!message) return;
    window.clearTimeout(settingsTooltipTimer);
    const reveal = () => {
      if (!settingsHelpEnabled || !target.isConnected) return;
      if (settingsTooltipTarget !== target) describeSettingsTooltip(settingsTooltipTarget, false);
      settingsTooltipTarget = target;
      elements.settingsTooltip.textContent = settingHelpMessage(target);
      elements.settingsTooltip.hidden = false;
      elements.settingsTooltip.setAttribute("aria-hidden", "false");
      describeSettingsTooltip(target, true);
      positionSettingsTooltip(target);
      requestAnimationFrame(() => elements.settingsTooltip.classList.add("is-visible"));
    };
    if (delay > 0) settingsTooltipTimer = window.setTimeout(reveal, delay);
    else reveal();
  }

  function setSettingsHelp(enabled, { persist = true } = {}) {
    hideShortcutTip();
    settingsHelpEnabled = Boolean(enabled);
    elements.settingsPanel.classList.toggle("is-help-mode", settingsHelpEnabled);
    elements.settingsHelp.setAttribute("aria-pressed", String(settingsHelpEnabled));
    elements.settingsHelp.setAttribute("aria-label", settingsHelpEnabled ? "Hide setting help" : "Show setting help");
    if (!settingsHelpEnabled) hideSettingsTooltip();
    if (persist) savePreferences();
  }

  function setupSettingsHelp() {
    setSettingsHelp(false, { persist: false });
    elements.settingsHelp.addEventListener("click", () => setSettingsHelp(!settingsHelpEnabled));
    elements.settingsPanel.addEventListener("pointerover", (event) => {
      if (!settingsHelpEnabled || event.pointerType === "touch") return;
      const target = event.target.closest?.(SETTING_HELP_SELECTOR);
      if (!target || target.contains(event.relatedTarget)) return;
      showSettingsTooltip(target);
    });
    elements.settingsPanel.addEventListener("pointerout", (event) => {
      if (!settingsHelpEnabled || event.pointerType === "touch") return;
      const target = event.target.closest?.(SETTING_HELP_SELECTOR);
      if (!target || target.contains(event.relatedTarget)) return;
      hideSettingsTooltip();
    });
    elements.settingsPanel.addEventListener("focusin", (event) => {
      if (settingsHelpEnabled) showSettingsTooltip(event.target.closest?.(SETTING_HELP_SELECTOR), { delay: 0 });
    });
    elements.settingsPanel.addEventListener("focusout", (event) => {
      if (settingsTooltipTarget?.contains(event.relatedTarget)) return;
      hideSettingsTooltip();
    });
    // Only a touch has to spend its tap on reading: with no hover there is no
    // other way to see a tooltip. A mouse or pen has already been shown one on
    // the way in, so its click is left to do its job and help mode stops
    // standing between the user and the control. A click that changes what the
    // control says refreshes the tooltip it is already showing.
    let inspectByTouch = false;
    const inspectSetting = (event) => {
      if (!settingsHelpEnabled || event.target.closest?.("#settingsHelp")) return;
      if (event.type === "pointerdown") inspectByTouch = event.pointerType === "touch";
      else if (!event.detail) inspectByTouch = false;
      const target = event.target.closest?.(SETTING_HELP_SELECTOR);
      if (!target || !elements.settingsPanel.contains(target)) return;
      if (!inspectByTouch) {
        if (event.type === "click" && target === settingsTooltipTarget) {
          requestAnimationFrame(() => showSettingsTooltip(target, { delay: 0 }));
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      showSettingsTooltip(target, { delay: 0 });
    };
    elements.settingsPanel.addEventListener("pointerdown", inspectSetting, true);
    elements.settingsPanel.addEventListener("click", inspectSetting, true);
    document.addEventListener("keydown", (event) => {
      if (settingsHelpEnabled && event.key === "Escape") setSettingsHelp(false);
    });
    window.addEventListener("resize", hideSettingsTooltip, { passive: true });
    window.addEventListener("scroll", hideSettingsTooltip, { passive: true });
  }

  // Track completed manual actions, never the stream of input events from a drag.
  class ShortcutHintTracker {
    constructor({ now = () => Date.now(), read = () => [], write = () => {} } = {}) {
      this.now = now;
      this.read = read;
      this.write = write;
      this.handled = new Set();
      this.sync();
      this.history = new Map();
      this.lastShown = -Infinity;
    }

    // One record serves every song, and a collection runs its songs side by
    // side, so re-read it before deciding or writing rather than trusting the
    // copy this page started with: a tip seen in one song stays seen in the
    // other, and neither page's write can drop what the other learned.
    sync() {
      try {
        const stored = this.read();
        if (Array.isArray(stored)) stored.forEach((id) => {
          if (["isolate", "reset-row", "vol-hold", "pan-hold"].includes(id)) this.handled.add(id);
        });
      } catch {}
    }

    clear() { this.history.clear(); }

    learn(id) {
      this.sync();
      this.handled.add(id);
      this.clear();
      try { this.write([...this.handled]); } catch {}
    }

    eligible(id) {
      this.sync();
      return !this.handled.has(id) && this.now() - this.lastShown >= 60000;
    }

    // The first finished Vol or Pan drag, or choosing a part, is when holding
    // that control is worth a mention; a hold already performed has taught it.
    hold(row, index, input = "mouse") {
      const id = `${row}-hold`;
      if (!["vol-hold", "pan-hold"].includes(id) || !this.eligible(id)) return null;
      return { id, row, part: index, input };
    }

    shown(id) {
      if (!this.eligible(id)) return false;
      this.lastShown = this.now();
      this.learn(id);
      return true;
    }

    toggle(row, index, before, after, input = "mouse") {
      const key = `toggle:${row}`;
      const now = this.now();
      const previous = this.history.get(key);
      let actions = previous && previous.state.every((value, i) => value === before[i])
        ? previous.actions.filter((action) => now - action.at <= 3000) : [];
      if (before.length < 3 || before.length !== after.length || !before[index] || after[index]
        || before.filter((value, i) => value !== after[i]).length !== 1) {
        this.history.delete(key);
        return null;
      }
      actions.push({ index, at: now });
      this.history.set(key, { actions, state: [...after] });
      if (!this.eligible("isolate") || new Set(actions.map((action) => action.index)).size < 2
        || after.filter(Boolean).length !== 1) return null;
      return { id: "isolate", row, part: after.indexOf(true), input };
    }

    adjust(row, index, before, after, defaultValue, input = "mouse") {
      const key = `adjust:${row}`;
      const now = this.now();
      const actions = (this.history.get(key) || [])
        .filter((action) => now - action.at <= 8000 && action.index !== index);
      if (before !== after && before !== defaultValue && after === defaultValue) {
        actions.push({ index, at: now });
      }
      this.history.set(key, actions);
      if (!this.eligible("reset-row") || actions.length < 2) return null;
      return { id: "reset-row", row, parts: actions.map((action) => action.index), input };
    }
  }

  const shortcutHints = new ShortcutHintTracker({
    read: () => JSON.parse(localStorage.getItem("choir-practice:shortcut-tips:v1") || "[]"),
    write: (handled) => localStorage.setItem("choir-practice:shortcut-tips:v1", JSON.stringify(handled)),
  });
  let shortcutTipTarget = null;
  let shortcutTipTimer = 0;
  let shortcutTipLifetime = 0;

  function hideShortcutTip() {
    const restoreFocus = elements.shortcutTip.contains(document.activeElement);
    window.clearTimeout(shortcutTipTimer);
    window.clearTimeout(shortcutTipLifetime);
    shortcutTipTarget?.classList.remove("is-shortcut-tip-target");
    if (shortcutTipTarget) {
      const descriptions = (shortcutTipTarget.getAttribute("aria-describedby") || "")
        .split(/\s+/u).filter((id) => id && id !== "shortcutTipMessage");
      if (descriptions.length) shortcutTipTarget.setAttribute("aria-describedby", descriptions.join(" "));
      else shortcutTipTarget.removeAttribute("aria-describedby");
    }
    elements.shortcutTip.hidden = true;
    elements.shortcutTip.classList.remove("is-visible");
    if (restoreFocus) shortcutTipTarget?.focus({ preventScroll: true });
    shortcutTipTarget = null;
  }

  function learnShortcut(id) {
    shortcutHints.learn(id);
    hideShortcutTip();
  }

  function shortcutTipContent(hint) {
    if (hint.id === "vol-hold" || hint.id === "pan-hold") {
      const volumes = hint.id === "vol-hold";
      const part = mixerParts[hint.part];
      const target = elements.mixer.querySelector(`[data-${volumes ? "volume" : "pan"}-index="${hint.part}"]`);
      if (!part || !target) return null;
      const keyboard = hint.input === "keyboard";
      const gesture = `${keyboard ? "Press Shift+Enter on" : "Press and hold"} ${part.name}’s ${volumes ? "volume" : "pan"}`;
      const again = keyboard ? "Repeat" : "Hold again";
      // The cycles in cyclePartVolumeMix and togglePartPanSeparation, in order
      // and in the words of the messages they show.
      return { target, message: volumes
        ? `${gesture} to emphasize ${part.name} (others 20%). ${again} to reduce ${part.name} to 20%; a third time sets all voices to 100%.`
        : `${gesture} to put ${part.name} right and the other parts left. ${again} to center all parts.` };
    }
    if (hint.id === "isolate") {
      const selector = hint.row === "see" ? "data-visible-index" : "data-audio-index";
      const target = elements.mixer.querySelector(`[${selector}="${hint.part}"]`);
      const selected = hint.row === "see" ? visibleTracks : audibleTracks;
      if (selected.size !== 1 || !selected.has(hint.part)) return null;
      const part = (hint.row === "see" ? parts : mixerParts)[hint.part];
      const gesture = hint.input === "keyboard" ? `Shift+Enter on ${part.short}` : `Press and hold ${part.short}`;
      return { target, message: `${gesture} in ${hint.row === "see" ? "See" : "Hear"} to ${hint.row === "see" ? "show" : "hear"} only ${part.name}.` };
    }
    const volumes = hint.row === "vol";
    const defaults = preferenceDefaults()[volumes ? "volumes" : "pans"];
    const values = volumes ? trackVolumes : trackPans;
    if (!hint.parts.every((index) => values[index] === defaults[index])) return null;
    const target = elements.mixer.querySelector(`[data-mixer-row="${hint.row}"]`);
    const name = volumes ? "Vol" : "Pan";
    const gesture = hint.input === "keyboard" ? `Focus the ${name} label and press Shift+F10`
      : `${hint.input === "touch" ? "Press and hold" : "Right-click"} the ${name} label`;
    const action = defaults.every((value) => value === (volumes ? 100 : 0))
      ? volumes ? "reset all part volumes to 100%" : "center all parts"
      : `reset all ${volumes ? "part volumes" : "pans"} to their defaults`;
    return { target, message: `${gesture} to ${action}.` };
  }

  // A tip waits for a drag, audition or scrub to end, for an Undo message to
  // go, and for the part chooser to be answered, rather than competing with them.
  const heldPointers = new Set();
  document.addEventListener("pointerdown", (event) => heldPointers.add(event.pointerId), true);
  document.addEventListener("pointerup", (event) => heldPointers.delete(event.pointerId), true);
  document.addEventListener("pointercancel", (event) => heldPointers.delete(event.pointerId), true);
  window.addEventListener("blur", () => heldPointers.clear());

  function shortcutTipMustWait() {
    return heldPointers.size > 0 || !elements.partChooser.hidden
      || (elements.toast.classList.contains("has-action") && elements.toast.classList.contains("is-visible"));
  }

  function queueShortcutTip(hint, waited = 0) {
    window.clearTimeout(shortcutTipTimer);
    if (!hint || !shortcutHints.eligible(hint.id)) return;
    shortcutTipTimer = window.setTimeout(() => {
      if (settingsHelpEnabled || document.hidden || !elements.shortcutTip.hidden) return;
      if (shortcutTipMustWait()) {
        if (waited < 12) queueShortcutTip(hint, waited + 1);
        return;
      }
      const content = shortcutTipContent(hint);
      const bounds = content?.target?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height || bounds.top < 0 || bounds.bottom > window.innerHeight
        || bounds.left < 0 || bounds.right > window.innerWidth) return;
      if (!shortcutHints.shown(hint.id)) return;
      shortcutTipTarget = content.target;
      elements.shortcutTipMessage.textContent = content.message;
      elements.shortcutTip.hidden = false;
      const box = elements.shortcutTip.getBoundingClientRect();
      elements.shortcutTip.style.left = `${clamp(bounds.left, 8, Math.max(8, window.innerWidth - box.width - 8))}px`;
      elements.shortcutTip.style.top = `${bounds.bottom + box.height + 8 < window.innerHeight
        ? bounds.bottom + 8 : Math.max(8, bounds.top - box.height - 8)}px`;
      shortcutTipTarget.classList.add("is-shortcut-tip-target");
      shortcutTipTarget.setAttribute("aria-describedby",
        [shortcutTipTarget.getAttribute("aria-describedby"), "shortcutTipMessage"].filter(Boolean).join(" "));
      elements.shortcutTip.classList.add("is-visible");
      shortcutTipLifetime = window.setTimeout(hideShortcutTip, 9000);
    }, 650);
  }

  elements.shortcutTipDismiss.addEventListener("click", hideShortcutTip);
  elements.shortcutTip.addEventListener("pointerenter", () => window.clearTimeout(shortcutTipLifetime));
  elements.shortcutTip.addEventListener("focusin", () => window.clearTimeout(shortcutTipLifetime));
  const resumeShortcutTipTimer = () => {
    if (!elements.shortcutTip.contains(document.activeElement)) {
      window.clearTimeout(shortcutTipLifetime);
      shortcutTipLifetime = window.setTimeout(hideShortcutTip, 9000);
    }
  };
  elements.shortcutTip.addEventListener("pointerleave", resumeShortcutTipTimer);
  elements.shortcutTip.addEventListener("focusout", resumeShortcutTipTimer);
  document.addEventListener("pointerdown", (event) => {
    if (!elements.shortcutTip.contains(event.target)) hideShortcutTip();
  }, true);
  function shortcutTipKeydown(event) {
    if (event.key === "Escape" && !elements.shortcutTip.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideShortcutTip();
    } else if (!elements.shortcutTip.contains(event.target)) hideShortcutTip();
  }
  document.addEventListener("keydown", shortcutTipKeydown, true);
  window.addEventListener("resize", hideShortcutTip, { passive: true });
  document.addEventListener("scroll", hideShortcutTip, { capture: true, passive: true });
  document.addEventListener("visibilitychange", hideShortcutTip);

  function formatTime(milliseconds) {
    const seconds = Math.round(Math.abs(milliseconds) / 1000);
    return `${milliseconds < 0 ? "-" : ""}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function parseEmbeddedJson(id, fallback = {}) {
    const source = document.getElementById(id)?.textContent?.trim();
    if (!source) return fallback;
    return JSON.parse(source);
  }

  function showToast(message, state = "", action = null) {
    window.clearTimeout(toastTimer);
    toastAction = typeof action === "function" ? action : null;
    elements.toastMessage.textContent = message;
    elements.toastUndo.hidden = !toastAction;
    elements.toast.classList.toggle("has-action", Boolean(toastAction));
    elements.toast.classList.toggle("is-error", state === "error");
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
      toastAction = null;
    }, state === "error" || toastAction ? 5200 : 2200);
  }

  elements.toastUndo.addEventListener("click", () => {
    const action = toastAction;
    toastAction = null;
    elements.toastUndo.hidden = true;
    elements.toast.classList.remove("has-action", "is-visible");
    if (action) action();
  });

  function setNotationLoadingMessage(message = "Engraving score…") {
    elements.scoreLoadingText.textContent = message;
  }

  function syncScoreLoadingVisibility() {
    const shouldShow = scoreView === "standard"
      && (loadFailed || (visibleTracks.size > 0 && !notationHasRendered && !notationRenderFailed));
    elements.scoreLoading.classList.toggle("is-hidden", !shouldShow);
  }

  function showLoadError(summary, detail = summary) {
    loadFailed = true;
    ready = false;
    playing = false;
    engine?.pause();
    elements.playPause.disabled = true;
    elements.playPause.classList.remove("is-playing");
    elements.seek.disabled = true;
    setNotationLoadingMessage(summary);
    syncScoreLoadingVisibility();
    showToast(detail, "error");
  }

  function updateTransportHeight() {
    const height = Math.ceil(elements.transport?.getBoundingClientRect().height || 46);
    document.documentElement.style.setProperty("--transport-height", `${height}px`);
  }

  function sensibleShortName(name, index) {
    const trimmed = String(name || "").trim();
    const known = trimmed.match(/^(soprano|alto|tenor|baritone|bass)(?:\s*(\d+))?/iu);
    if (known) {
      const initial = known[1][0].toUpperCase();
      return `${initial}${known[2] || ""}`;
    }
    const words = trimmed.split(/\s+/u).filter(Boolean);
    const initials = words.map((word) => word[0]).join("").toUpperCase();
    return initials.slice(0, 3) || `P${index + 1}`;
  }

  function normalizeParts(rawParts) {
    return (rawParts || []).map((part, index) => {
      const source = typeof part === "string" ? { name: part } : (part || {});
      const override = config.parts?.[index] || {};
      const name = String(override.name || source.name || `Part ${index + 1}`);
      return {
        index,
        id: String(source.id || override.id || `P${index + 1}`),
        name,
        short: String(override.short || source.short || sensibleShortName(name, index)),
        color: String(override.color || config.partColors?.[name] || source.color || partPaint(index)),
      };
    });
  }

  function prepareVoicePalette() {
    const lanes=window.MeleteVoicePalette.lanes(mixerParts,partDivisi,sequence.practiceRoles);
    const written=parts.map(()=>[]);
    for (const note of sequence.notes) if(note[2]>note[1]) written[note[0]].push(note);
    mixerParts.forEach((channel,i)=>{
      const {source}=channel, part=parts[source], lane=lanes[i];
      channel.barNotes=window.MeleteVoicePalette.barNotes(channel,lane,written[source]);
      const override=config.parts?.[source]?.color || config.partColors?.[part.name] || sequence.parts[source]?.color;
      if (!lane.paint || override) return;
      // Staff-level labels use the upper line on a condensed divisi staff.
      const variable=channel.line===null || channel.line===0 ? `--part-${source+1}` : `--channel-${i+1}`;
      document.documentElement.style.setProperty(variable,lane.paint);
      channel.color=`var(${variable})`;
      if (channel.line===null || channel.line===0) part.color=channel.color;
    });
  }

  function createDragNumber(button, options) {
    const valueLabel = document.createElement("span");
    valueLabel.className = "drag-number-value";
    button.replaceChildren(valueLabel);
    const values = options.values;
    const initialValue = Number(button.dataset.value);
    const defaultValue = () => typeof options.defaultValue === "function" ? options.defaultValue() : options.defaultValue;
    let value = nearestAllowed(Number.isFinite(initialValue) ? initialValue : defaultValue(), values);
    let pointerId = null;
    let startY = 0;
    let startIndex = 0;
    let dragValues = values;
    let startValue = value;
    let startX = 0;
    let moved = false;
    let pointerType = "mouse";
    let holdTimer = 0;
    let held = false;
    let suppressTouchContextUntil = 0;

    const clearHold = () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = 0;
    };
    const cancelPointer = () => {
      clearHold();
      const captured = pointerId;
      pointerId = null;
      if (captured !== null && button.hasPointerCapture(captured)) button.releasePointerCapture(captured);
    };

    function interactionValues() {
      const configured = typeof options.stepValues === "function" ? options.stepValues() : values;
      if (configured.includes(value)) return configured;
      return [...configured, value].sort((left, right) => left - right);
    }

    function update(next, emit = true) {
      const nextValue = nearestAllowed(Number(next), values);
      const changed = nextValue !== value;
      value = nextValue;
      button.dataset.value = String(value);
      valueLabel.textContent = options.format(value);
      button.setAttribute("aria-valuenow", String(value));
      button.setAttribute("aria-valuemin", String(values[0]));
      button.setAttribute("aria-valuemax", String(values.at(-1)));
      button.setAttribute("aria-valuetext", options.aria(value));
      if (changed && emit) button.dispatchEvent(new Event("input", { bubbles: true }));
      return value;
    }

    function advanceClick() {
      const stops = interactionValues();
      const step = typeof options.clickStep === "function" ? options.clickStep(value) : options.clickStep;
      const next = Number.isFinite(step) && step > 0 ? value + step
        : stops[Math.min(stops.length - 1, stops.indexOf(value) + 1)];
      update(options.wrapOnClick && value === values.at(-1) ? values[0] : next);
    }

    button.setAttribute("role", "spinbutton");
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      cancelPointer();
      pointerId = event.pointerId;
      pointerType = event.pointerType || "mouse";
      startX = event.clientX;
      startY = event.clientY;
      startValue = value;
      held = false;
      moved = false;
      dragValues = interactionValues();
      startIndex = dragValues.indexOf(value);
      button.setPointerCapture(pointerId);
      if (options.onHold) holdTimer = window.setTimeout(() => {
        holdTimer = 0;
        held = true;
        suppressTouchContextUntil = performance.now() + 800;
        options.onHold();
      }, 600);
      event.preventDefault();
    });
    button.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId || !button.hasPointerCapture(pointerId) || held) return;
      const delta = startY - event.clientY;
      const indexDelta = Math.round(delta / (options.pixelsPerStep || 8));
      if (indexDelta !== 0 || Math.hypot(event.clientX - startX, delta) > 4) moved = true;
      if (indexDelta !== 0 || Math.hypot(event.clientX - startX, delta) > 8) clearHold();
      // Horizontal displacement is deliberately ignored so a finger can move
      // aside to reveal the value without editing it. Zero vertical
      // displacement remains anchored to the original index, letting a drag
      // move away and return without skipping the starting value.
      update(dragValues[clamp(startIndex + indexDelta, 0, dragValues.length - 1)]);
    });
    const endPointer = (event) => {
      if (event.pointerId !== pointerId) return;
      cancelPointer();
      if (!held && !moved && event.type === "pointerup") advanceClick();
      if (!held && event.type === "pointerup" && startValue !== value) options.onManualChange?.(startValue, value, event.pointerType);
    };
    button.addEventListener("pointerup", endPointer);
    button.addEventListener("pointercancel", endPointer);
    button.addEventListener("lostpointercapture", cancelPointer);
    button.addEventListener("contextmenu", (event) => {
      if (options.onHold && (event.pointerType || pointerType) !== "mouse"
        && (pointerId !== null || performance.now() < suppressTouchContextUntil)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      cancelPointer();
    });
    button.addEventListener("dblclick", () => { if (options.resetOnDoubleClick !== false) update(defaultValue()); });
    button.addEventListener("click", event => {
      if (event.detail !== 0 || event.pointerType) return;
      const before = value;
      advanceClick();
      if (before !== value) options.onManualChange?.(before, value, "keyboard");
    });
    button.addEventListener("keydown", (event) => {
      if (options.onHold && event.shiftKey && event.key === "Enter") {
        cancelPointer();
        event.preventDefault();
        if (!event.repeat) options.onHold();
        return;
      }
      if (event.key === "Escape" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) cancelPointer();
      const before = value;
      const stepValues = interactionValues();
      const index = stepValues.indexOf(value);
      if (["ArrowUp", "ArrowRight"].includes(event.key)) update(stepValues[Math.min(stepValues.length - 1, index + 1)]);
      else if (["ArrowDown", "ArrowLeft"].includes(event.key)) update(stepValues[Math.max(0, index - 1)]);
      else if (event.key === "Home") update(stepValues[0]);
      else if (event.key === "End") update(stepValues.at(-1));
      else if (event.key === "0") update(defaultValue());
      else return;
      event.preventDefault();
      if (event.key !== "0" && before !== value) options.onManualChange?.(before, value, "keyboard");
    });
    update(value, false);
    return { value: () => value, setValue: update };
  }

  function createPanRing(button, options) {
    const initialValue = Number(button.dataset.value);
    const defaultValue = () => typeof options.defaultValue === "function" ? options.defaultValue() : options.defaultValue;
    let value = nearestAllowed(Number.isFinite(initialValue) ? initialValue : defaultValue(), PAN_VALUES);
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startIndex = 0;
    let startValue = value;
    let pointerType = "mouse";
    let holdTimer = 0;
    let feedbackTimer = 0;
    let held = false;
    let suppressContextUntil = 0;

    const clearHold = () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      if (feedbackTimer) window.clearTimeout(feedbackTimer);
      holdTimer = feedbackTimer = 0;
      button.classList.remove("is-holding");
    };
    const cancelPointer = () => {
      clearHold();
      const captured = pointerId;
      pointerId = null;
      if (captured !== null && button.hasPointerCapture(captured)) button.releasePointerCapture(captured);
    };

    function update(next, emit = true) {
      const nextValue = nearestAllowed(Number(next), PAN_VALUES);
      const changed = nextValue !== value;
      value = nextValue;
      const label = value === 0 ? "C" : `${Math.abs(value)}${value < 0 ? "L" : "R"}`;
      const angle = value * 1.35;
      button.dataset.value = String(value);
      button.style.setProperty("--pan-angle", `${angle}deg`);
      button.style.setProperty("--pan-arc-start", `${Math.min(0, angle)}deg`);
      button.style.setProperty("--pan-arc-sweep", `${Math.abs(angle)}deg`);
      button.setAttribute("aria-valuenow", String(value));
      button.setAttribute("aria-valuetext", value === -100
        ? "Hard left"
        : value === 100
          ? "Hard right"
          : value === 0
            ? "Center"
            : `${Math.abs(value)} percent ${value < 0 ? "left" : "right"}`);
      button.dataset.help = `${options.name} pan ${label}. Drag horizontally.`;
      if (changed && emit) button.dispatchEvent(new Event("input", { bubbles: true }));
    }

    button.setAttribute("role", "slider");
    button.setAttribute("aria-orientation", "horizontal");
    button.setAttribute("aria-valuemin", "-100");
    button.setAttribute("aria-valuemax", "100");
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      cancelPointer();
      pointerId = event.pointerId;
      pointerType = event.pointerType || "mouse";
      startX = event.clientX;
      startY = event.clientY;
      startValue = value;
      startIndex = PAN_VALUES.indexOf(value);
      held = false;
      button.setPointerCapture(pointerId);
      if (options.onHold) {
        feedbackTimer = window.setTimeout(() => button.classList.add("is-holding"), 250);
        holdTimer = window.setTimeout(() => {
          clearHold();
          held = true;
          suppressContextUntil = performance.now() + 800;
          options.onHold();
        }, 600);
      }
      event.preventDefault();
    });
    button.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId || !button.hasPointerCapture(pointerId) || held) return;
      const indexDelta = Math.round((event.clientX - startX) / 4);
      if (indexDelta !== 0 || Math.hypot(event.clientX - startX, event.clientY - startY) > 8) clearHold();
      update(PAN_VALUES[clamp(startIndex + indexDelta, 0, PAN_VALUES.length - 1)]);
    });
    const finish = (event) => {
      if (event.pointerId !== pointerId) return;
      cancelPointer();
      if (!held && event.type === "pointerup" && startValue !== value) options.onManualChange?.(startValue, value, event.pointerType);
    };
    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", finish);
    button.addEventListener("lostpointercapture", cancelPointer);
    button.addEventListener("click", (event) => {
      if (!held) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    button.addEventListener("contextmenu", (event) => {
      if (options.onHold && (event.pointerType || pointerType) !== "mouse"
        && (pointerId !== null || performance.now() < suppressContextUntil)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      cancelPointer();
    });
    button.addEventListener("dblclick", () => { if (!held) update(defaultValue()); });
    button.addEventListener("keydown", (event) => {
      if (options.onHold && event.shiftKey && event.key === "Enter") {
        cancelPointer();
        event.preventDefault();
        if (!event.repeat) options.onHold();
        return;
      }
      if (event.key === "Escape" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) cancelPointer();
      const before = value;
      const index = PAN_VALUES.indexOf(value);
      if (event.key === "ArrowRight") update(PAN_VALUES[Math.min(PAN_VALUES.length - 1, index + 1)]);
      else if (event.key === "ArrowLeft") update(PAN_VALUES[Math.max(0, index - 1)]);
      else if (event.key === "Home") update(PAN_VALUES[0]);
      else if (event.key === "End") update(PAN_VALUES.at(-1));
      else if (event.key === "0") update(defaultValue());
      else return;
      event.preventDefault();
      if (event.key !== "0" && before !== value) options.onManualChange?.(before, value, "keyboard");
    });
    if (options.onHold) {
      window.addEventListener("blur", cancelPointer);
      window.addEventListener("scroll", cancelPointer, true);
      window.addEventListener("pointerdown", (event) => {
        if (pointerId !== null && event.pointerId !== pointerId) cancelPointer();
      }, true);
    }
    update(value, false);
    return { value: () => value, setValue: update };
  }

  class InfinitePager {
    constructor(element, { options, value, placeholder = "", onTap = null }) {
      if (!element || !Array.isArray(options) || options.length < 2) {
        throw new TypeError("InfinitePager requires an element and at least two options");
      }
      this.element = element;
      this.element.title = "Tap to advance; drag to browse.";
      this.options = options;
      this.onTap = onTap;
      this.placeholder = placeholder;
      const initialIndex = this.indexForValue(value);
      this.unset = initialIndex === null;
      this.index = initialIndex ?? 0;
      this.layers = [];
      this.drag = null;
      this.pendingIndex = null;
      this.snapTimer = null;
      this.events = new AbortController();
      this.snapDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 100;

      this.element.replaceChildren();
      this.layers = Array.from({ length: 3 }, () => {
        const layer = document.createElement("span");
        layer.className = "practice-part-layer";
        layer.setAttribute("aria-hidden", "true");
        this.element.append(layer);
        return layer;
      });
      this.element.setAttribute("aria-valuemin", "0");
      this.element.setAttribute("aria-valuemax", String(this.options.length - 1));
      this.setTransition("none");
      if (this.unset) this.layoutUnset();
      else this.layout(this.index);
      this.syncAccessibility();
      this.bindEvents();
    }

    indexForValue(value) {
      const index = this.options.findIndex((option) => option.value === value);
      return index >= 0 ? index : null;
    }

    value() { return this.unset ? null : this.options[this.index].value; }

    setValue(value) {
      this.finishPendingAnimation(false);
      const nextIndex = this.indexForValue(value);
      if (nextIndex === null) {
        this.unset = true;
        this.index = 0;
        this.setTransition("none");
        this.layoutUnset();
        this.syncAccessibility();
        return;
      }
      if (this.unset || nextIndex !== this.index) this.commit(nextIndex, false);
    }

    height() { return this.element.clientHeight || 25; }

    wrappedIndex(index) {
      return ((index % this.options.length) + this.options.length) % this.options.length;
    }

    layout(index, offset = 0) {
      const height = this.height();
      const indices = [this.wrappedIndex(index - 1), this.wrappedIndex(index), this.wrappedIndex(index + 1)];
      this.layers.forEach((layer, layerIndex) => {
        this.populateLayer(layer, this.options[indices[layerIndex]]);
        layer.style.transform = `translate3d(0,${offset + (layerIndex - 1) * height}px,0)`;
      });
    }

    layoutUnset(offset = 0) {
      const height = this.height();
      const options = [this.options.at(-1), null, this.options[0]];
      this.layers.forEach((layer, layerIndex) => {
        this.populateLayer(layer, options[layerIndex], layerIndex === 1 ? this.placeholder : undefined);
        layer.style.transform = `translate3d(0,${offset + (layerIndex - 1) * height}px,0)`;
      });
    }

    populateLayer(layer, option, fallbackLabel = "") {
      if (!layer.firstElementChild) {
        const label = document.createElement("span");
        label.className = "practice-part-label";
        const detail = document.createElement("span");
        detail.className = "practice-part-detail";
        layer.append(label, detail);
      }
      const detail = typeof option?.detail === "function" ? option.detail() : option?.detail;
      layer.children[0].textContent = option?.label ?? fallbackLabel;
      layer.children[1].textContent = detail ?? "";
      layer.children[1].hidden = !detail;
      layer.classList.toggle("has-detail", Boolean(detail));
      const color = option?.color;
      layer.classList.toggle("has-option-color", Boolean(color));
      if (color) layer.style.setProperty("--pager-option-color", color);
      else layer.style.removeProperty("--pager-option-color");
    }

    refreshLabels() {
      if (this.drag || this.pendingIndex !== null) return;
      if (this.unset) this.layoutUnset();
      else this.layout(this.index);
    }

    setTransition(value) {
      this.layers.forEach((layer) => { layer.style.transition = value; });
    }

    syncAccessibility() {
      this.element.classList.toggle("is-unset", this.unset);
      if (this.unset) {
        this.element.dataset.value = "";
        this.element.removeAttribute("aria-valuenow");
        this.element.setAttribute("aria-valuetext", this.placeholder);
        return;
      }
      const option = this.options[this.index];
      this.element.dataset.value = option.value ?? "";
      this.element.setAttribute("aria-valuenow", String(this.index));
      this.element.setAttribute("aria-valuetext", option.label);
    }

    commit(index, emit = true) {
      const nextIndex = this.wrappedIndex(index);
      const changed = this.unset || nextIndex !== this.index;
      this.unset = false;
      this.index = nextIndex;
      this.pendingIndex = null;
      this.element.classList.remove("is-paging");
      this.setTransition("none");
      this.layout(this.index);
      this.syncAccessibility();
      if (changed && emit) this.element.dispatchEvent(new Event("input", { bubbles: true }));
    }

    finishPendingAnimation(emit = true) {
      if (this.snapTimer !== null) {
        window.clearTimeout(this.snapTimer);
        this.snapTimer = null;
      }
      if (this.pendingIndex !== null) this.commit(this.pendingIndex, emit);
    }

    animateTo(startIndex, targetOffset, nextIndex) {
      this.finishPendingAnimation();
      this.pendingIndex = this.wrappedIndex(nextIndex);
      this.element.classList.add("is-paging");
      this.setTransition(`transform ${this.snapDuration}ms ease-out`);
      if (this.unset) this.layoutUnset(targetOffset);
      else this.layout(startIndex, targetOffset);
      if (this.snapDuration === 0) {
        this.commit(this.pendingIndex);
        return;
      }
      this.snapTimer = window.setTimeout(() => {
        this.snapTimer = null;
        this.commit(this.pendingIndex);
      }, this.snapDuration);
    }

    step(direction) {
      this.finishPendingAnimation();
      if (this.unset) {
        this.animateTo(this.index, direction > 0 ? -this.height() : this.height(),
          direction > 0 ? 0 : this.options.length - 1);
        return;
      }
      const height = this.height();
      this.animateTo(this.index, direction > 0 ? -height : height, this.index + direction);
    }

    bindEvents() {
      const listenerOptions = { signal: this.events.signal };
      this.element.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || this.drag) return;
        this.finishPendingAnimation();
        this.setTransition("none");
        // startY moves as the wheel wraps; originY stays put so a press can
        // tell whether it was a drag at all.
        this.drag = { index: this.index, offset: 0, pointerId: event.pointerId,
          startY: event.clientY, originY: event.clientY, originX: event.clientX, moved: false, unset: this.unset };
        this.element.classList.add("is-dragging");
        this.element.setPointerCapture(event.pointerId);
        event.preventDefault();
      }, listenerOptions);
      this.element.addEventListener("pointermove", (event) => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - this.drag.originX, event.clientY - this.drag.originY) > 4) this.drag.moved = true;
        const height = this.height();
        let delta = event.clientY - this.drag.startY;
        if (this.drag.unset) {
          delta = clamp(delta, -height, height);
          this.drag.offset = delta;
          this.layoutUnset(delta);
          event.preventDefault();
          return;
        }
        while (delta <= -height) {
          this.drag.index = this.wrappedIndex(this.drag.index + 1);
          this.drag.startY -= height;
          delta += height;
        }
        while (delta >= height) {
          this.drag.index = this.wrappedIndex(this.drag.index - 1);
          this.drag.startY += height;
          delta -= height;
        }
        this.drag.offset = delta;
        this.layout(this.drag.index, delta);
        event.preventDefault();
      }, listenerOptions);
      this.element.addEventListener("pointerup", (event) => this.release(event), listenerOptions);
      this.element.addEventListener("pointercancel", (event) => this.cancel(event.pointerId), listenerOptions);
      this.element.addEventListener("lostpointercapture", (event) => this.cancel(event.pointerId), listenerOptions);
      this.element.addEventListener("click", (event) => {
        // Pointer taps are handled on release; only synthetic/assistive clicks
        // belong here, otherwise a drag's trailing click would advance again.
        if (event.detail === 0 && !event.pointerType && !this.drag && !this.onTap?.()) this.step(1);
      }, listenerOptions);
      window.addEventListener("blur", () => this.cancel(this.drag?.pointerId), listenerOptions);
      this.element.addEventListener("wheel", (event) => {
        if (event.deltaY === 0) return;
        event.preventDefault();
        this.step(event.deltaY > 0 ? 1 : -1);
      }, { passive: false, signal: this.events.signal });
      this.element.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
        event.preventDefault();
        if (event.key==="Enter" && this.onTap?.()) return;
        this.step(event.key === "ArrowUp" ? -1 : 1);
      }, listenerOptions);
    }

    release(event) {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      const drag = this.drag;
      const height = this.height();
      const delta = event.clientY - drag.startY;
      // Tapping is what people try first, so it moves to the next option
      // rather than doing nothing and leaving the control looking inert.
      if (!drag.moved) {
        this.drag = null;
        this.element.classList.remove("is-dragging");
        if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
        if (!this.onTap?.()) this.step(1);
        event.preventDefault();
        return;
      }
      if (drag.unset) {
        this.drag = null;
        this.element.classList.remove("is-dragging");
        if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
        this.setTransition("none");
        if (Math.abs(delta) > height / 2) this.commit(delta < 0 ? 0 : this.options.length - 1);
        else {
          this.layoutUnset();
          this.syncAccessibility();
        }
        event.preventDefault();
        return;
      }
      const nextIndex = Math.abs(delta) > height / 2 ? drag.index + (delta < 0 ? 1 : -1) : drag.index;
      const targetOffset = nextIndex === drag.index ? 0 : delta < 0 ? -height : height;
      this.drag = null;
      this.element.classList.remove("is-dragging");
      if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
      this.animateTo(drag.index, targetOffset, nextIndex);
      event.preventDefault();
    }

    cancel(pointerId) {
      if (!this.drag || this.drag.pointerId !== pointerId) return;
      this.drag = null;
      this.element.classList.remove("is-dragging");
      this.setTransition("none");
      if (this.unset) this.layoutUnset();
      else this.layout(this.index);
      if (this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId);
    }

    destroy() {
      this.events.abort();
      if (this.snapTimer !== null) window.clearTimeout(this.snapTimer);
      this.snapTimer = null;
      this.drag = null;
      this.pendingIndex = null;
      this.element.classList.remove("is-paging", "is-dragging");
    }
  }

  const tempoControl = createDragNumber(elements.tempo, {
    values: TEMPO_VALUES,
    stepValues: () => TEMPO_VALUES.filter(value => value === 25 || value % 10 === 0),
    clickStep: 10,
    defaultValue: () => preferenceDefaults().tempo,
    format: (value) => `${value}%`,
    aria: (value) => `${value} percent of written tempo`,
  });
  const metronomeControl = createDragNumber(elements.metronome, {
    values: METRONOME_VALUES,
    clickStep: 10,
    defaultValue: () => preferenceDefaults().metronome,
    format: (value) => `${value}%`,
    aria: (value) => `metronome volume ${value} percent`,
  });
  const takeReverbControl = createDragNumber(document.getElementById("takeReverb"), {
    values: Array.from({length:101}, (_, i) => i), clickStep: 10,
    defaultValue: () => 0, format: value => `${value}%`, aria: value => `Recording reverb ${value} percent`,
  });
  document.getElementById("takeReverb").addEventListener("input", () => {
    engine?.takeBus?.set(takeReverbControl.value()); engine?.balanceTakeLayers(); savePreferences();
  });
  const takeVolumeControl = createDragNumber(document.getElementById("takeVolume"), {
    values: VOLUME_VALUES, clickStep: 10, defaultValue: () => 100,
    format: value => `${value}%`, aria: value => `Recording mix volume ${value} percent`,
  });
  document.getElementById("takeVolume").addEventListener("input", () => {
    engine?.takeBus?.setVolume(takeVolumeControl.value()); savePreferences();
  });
  const verticalControl = createDragNumber(elements.verticalScale, {
    values: VERTICAL_VALUES,
    clickStep: 10,
    defaultValue: () => preferenceDefaults().vertical,
    format: (value) => `${value}%`,
    aria: (value) => `${value} percent vertical scale`,
  });
  const horizontalControl = createDragNumber(elements.horizontalScale, {
    values: HORIZONTAL_VALUES,
    clickStep: 10,
    stepValues: () => scoreView === "bars" ? HORIZONTAL_VALUES : STANDARD_HORIZONTAL_VALUES,
    pixelsPerStep: 4,
    defaultValue: () => preferenceDefaults().horizontal,
    format: (value) => `${value}%`,
    aria: (value) => `${value} percent horizontal scale`,
  });

  function syncPillThumb(group = null) {
    const groups = group ? [group] : [elements.flowToggle, elements.scoreViewToggle];
    groups.forEach((toggle) => {
      const active = toggle?.querySelector(".pill-option.is-active");
      const thumb = toggle?.querySelector(".pill-thumb");
      if (!active || !thumb) return;
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.height = `${active.offsetHeight}px`;
      thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    });
  }

  function setFlow(next, { render = true, persist = true } = {}) {
    flow = next === "continuous" ? "continuous" : "wrap";
    elements.flowToggle.querySelectorAll("[data-flow]").forEach((button) => {
      const selected = button.dataset.flow === flow;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    elements.score.classList.toggle("is-continuous", flow === "continuous");
    elements.barScore.classList.toggle("is-continuous", flow === "continuous");
    requestAnimationFrame(() => syncPillThumb(elements.flowToggle));
    if (persist) savePreferences();
    if (render) scheduleRender();
  }

  function setScoreView(next, { render = true, persist = true } = {}) {
    cancelPitchAuditions();
    cancelScoreScrub();
    stopBarPlayheadMotion();
    const previous = scoreView;
    if (takeReview && !engine.playing) pendingLoopRevealTick = Math.max(0, engine.tickAtSeconds(engine.currentSeconds()));
    scoreView = next === "bars" ? "bars" : "standard";
    if (scoreView !== "standard") {
      window.clearTimeout(renderTimer);
      renderTimer = 0;
      clearNotationRenderTimeout();
      notationRenderInFlight = false;
      notationRenderQueued = false;
      discardScoreRenderSnapshot();
    } else if (previous !== "standard") {
      notationRenderFailed = false;
      setNotationLoadingMessage();
    }
    elements.scoreViewToggle.querySelectorAll("[data-view]").forEach((button) => {
      const selected = button.dataset.view === scoreView;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    requestAnimationFrame(() => syncPillThumb(elements.scoreViewToggle));
    elements.score.hidden = scoreView !== "standard" || !visibleTracks.size;
    elements.barScore.hidden = scoreView !== "bars";
    if (previous !== scoreView) {
      if (scoreView === "standard" && staffTraceSystems.length) renderPitchTrace(staffTraceSystems);
      compPanel?.selected();
    }
    updateMixerAppearance();
    syncScoreLoadingVisibility();
    updateNoteActionLabel();
    requestAnimationFrame(() => {
      renderSelectedPartHighlight();
    });
    if (render) scheduleRender();
    if (persist) savePreferences();
  }

  function scoreWithoutRepeatedLyrics(xml) {
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");
    if (documentXml.querySelector("parsererror")) throw new Error("Repeated lyrics could not be filtered");
    documentXml.querySelectorAll('[data-choir-repeated-lyric="true"]').forEach((lyric) => lyric.remove());
    return new XMLSerializer().serializeToString(documentXml);
  }

  function scoreXmlForDisplayMode() {
    const documentXml = new DOMParser().parseFromString(fullScoreXml, "application/xml");
    if (documentXml.querySelector("parsererror")) throw new Error("Score display options could not be applied");
    if (lyricsMode === "changes") {
      documentXml.querySelectorAll('[data-choir-repeated-lyric="true"]').forEach((lyric) => lyric.remove());
    }
    [...documentXml.getElementsByTagName("*")]
      .filter((element) => element.localName === "rehearsal")
      .forEach((rehearsal) => rehearsal.remove());
    return new XMLSerializer().serializeToString(documentXml);
  }

  function captureNotationReloadAnchor() {
    const cursor = elements.score.querySelector(".at-cursor-bar");
    const anchor = {
      scrollY: window.scrollY,
      scoreScrollLeft: elements.score.scrollLeft,
    };
    if (!cursor) return anchor;
    const bounds = cursor.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return anchor;
    const headerBottom = elements.transport.getBoundingClientRect().bottom;
    anchor.top = clamp(bounds.top, headerBottom + 8, Math.max(headerBottom + 8, window.innerHeight - bounds.height - 20));
    anchor.left = bounds.left;
    return anchor;
  }

  function restoreNotationReloadScrollOffset(anchor) {
    if (!anchor) return;
    automaticScrollUntil = Date.now() + 350;
    window.scrollTo({ top: Math.max(0, Number(anchor.scrollY) || 0), behavior: "auto" });
    elements.score.scrollTo({ left: Math.max(0, Number(anchor.scoreScrollLeft) || 0), behavior: "auto" });
  }

  function restoreNotationReloadAnchor(anchor) {
    const cursor = elements.score.querySelector(".at-cursor-bar");
    if (!cursor) return false;
    const bounds = cursor.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    const headerBottom = elements.transport.getBoundingClientRect().bottom;
    // A freshly loaded score briefly exposes AlphaTab's measure-one cursor.
    // Do not mistake that off-screen stale element for the restored cursor.
    if (bounds.bottom < headerBottom + 2 || bounds.top > window.innerHeight - 2) return false;
    const targetTop = anchor?.top ?? Math.min(window.innerHeight * 0.32, headerBottom + 120);
    const safeTop = clamp(targetTop, headerBottom + 8, Math.max(headerBottom + 8, window.innerHeight - bounds.height - 20));
    automaticScrollUntil = Date.now() + 350;
    window.scrollTo({ top: Math.max(0, window.scrollY + bounds.top - safeTop), behavior: "auto" });
    if (flow === "continuous") {
      const scoreBounds = elements.score.getBoundingClientRect();
      const targetLeft = anchor?.left ?? scoreBounds.left + Math.min(scoreBounds.width * 0.25, 180);
      elements.score.scrollTo({
        left: Math.max(0, elements.score.scrollLeft + bounds.left - targetLeft),
        behavior: "auto",
      });
    }
    playbackDetached = false;
    hidePlaybackReturn();
    return true;
  }

  function finishNotationReloadWhenReady() {
    const pending = pendingNotationReload;
    if (!pending || !pending.playerReady || !pending.renderReady || pending.restoring) return;
    pending.restoring = true;
    selectedScoreTick = pending.selectedTick;
    selectedScorePartIndex = pending.selectedPartIndex;
    if (Number.isInteger(selectedScorePartIndex)) elements.score.dataset.selectedPart = String(selectedScorePartIndex);
    requestAnimationFrame(renderSelectedPartHighlight);

    // Loading new MusicXML makes AlphaTab seek its external-media output to
    // zero. Restore the guide engine itself only after the new score and its
    // player are ready; setting AlphaTab's tick during playerReady is too early
    // and can leave the cursor painted against the previous surface geometry.
    let frame = 0;
    const restoreAfterCursorPaint = () => {
      if (pendingNotationReload !== pending) return;
      frame += 1;
      if (frame === 1) {
        // Restoring the old document offset first causes AlphaTab's lazy
        // renderer to attach the same system before the cursor is repositioned.
        restoreNotationReloadScrollOffset(pending.anchor);
        requestAnimationFrame(restoreAfterCursorPaint);
        return;
      }
      if (frame === 2) {
        // Do not re-enter AlphaTab's external-media position update while its
        // ready/render event is still unwinding.
        engine.seek(engine.secondsAtTick(pending.tick));
        requestAnimationFrame(restoreAfterCursorPaint);
        return;
      }
      if (frame >= 3) {
        if (frame <= 8) restoreNotationReloadScrollOffset(pending.anchor);
        if (frame > 3 && frame % 4 === 0) engine.pushPosition();
      }
      if (frame >= 3 && restoreNotationReloadAnchor(pending.anchor)) {
        pendingNotationReload = null;
        scheduleCursorTrimBurst();
        updateNoteActionLabel();
        if (pending.resume) void engine.startTransport();
        return;
      }
      if (frame < 36) {
        requestAnimationFrame(restoreAfterCursorPaint);
        return;
      }
      restoreNotationReloadScrollOffset(pending.anchor);
      pendingNotationReload = null;
      scheduleCursorTrimBurst();
      updateNoteActionLabel();
      if (pending.resume) void engine.startTransport();
    };
    requestAnimationFrame(restoreAfterCursorPaint);
  }

  function reloadNotationForDisplay() {
    if (!api || !fullScoreXml) return true;
    cancelPitchAuditions();
    cancelScoreScrub();
    const wasPlaying = playing || engine?.preparing;
    const tick = currentScoreTick();
    const anchor = captureNotationReloadAnchor();
    if (wasPlaying) engine.pauseTransport();
    pendingNotationReload = {
      tick,
      selectedTick: tick,
      selectedPartIndex: currentScorePartIndex(),
      anchor,
      resume: wasPlaying,
      playerReady: false,
      renderReady: false,
      restoring: false,
    };
    const tracks = parts.map((_, index) => index).filter((index) => visibleTracks.has(index));
    if (api.load(new TextEncoder().encode(scoreXmlForDisplayMode()), tracks)) return true;
    pendingNotationReload = null;
    if (wasPlaying) void engine.startTransport();
    return false;
  }

  function setLyricsMode(next, { reload = true, persist = true } = {}) {
    const previous = lyricsMode;
    lyricsMode = "changes";
    if (reload && lyricsMode !== previous) {
      if (!reloadNotationForDisplay()) {
        lyricsMode = previous;
        setLyricsMode(previous, { reload: false, persist: false });
        showToast("Lyric display could not be changed", "error");
        return;
      }
      if (scoreView === "bars") scheduleBarRender();
    }
    if (persist) savePreferences();
  }

  function applyMeasureNumberSettings(settings = api?.settings, score = scoreTracks[0]?.score) {
    const notationElement = window.alphaTab?.NotationElement?.BarNumber;
    if (settings?.notation?.elements && notationElement !== undefined) {
      settings.notation.elements.set(notationElement, true);
    }
    const display = window.alphaTab?.model?.BarNumberDisplay;
    const value = display?.AllBars;
    if (score?.stylesheet && value !== undefined) {
      score.stylesheet.barNumberDisplay = value;
      // MusicXML's <measure-numbering> import can set an explicit value on
      // every bar, which takes precedence over the score-wide stylesheet.
      // Normalize those per-bar values so all measure labels survive
      // responsive reflow.
      score.tracks?.forEach((track) => track.staves?.forEach((staff) => {
        staff.bars?.forEach((bar) => { bar.barNumberDisplay = value; });
      }));
    }
  }

  function applyWrittenChordNames(score) {
    const names = new Map((config.writtenChordNames || []).map(mark => [mark.tick, mark.name]));
    if (!names.size) return;
    for (const track of score.tracks) for (const staff of track.staves) {
      for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
        const name = names.get(beat.absoluteDisplayStart), chord = beat.chord;
        if (!name || !chord || chord.name === name) continue;
        // Display spellings such as Fadd9 must not inherit the importer's F9.
        // A dedicated chord ID avoids renaming a genuinely different chord
        // that the importer happened to put in the same chord-name cache.
        const id = `${beat.chordId}:written:${name}`;
        if (!staff.hasChord(id)) staff.addChord(id,
          Object.assign(Object.create(Object.getPrototypeOf(chord)), chord, {name}));
        beat.chordId = id;
      }
    }
  }

  function applyLyricFontSettings(settings = api?.settings) {
    const notationElement = window.alphaTab?.NotationElement?.EffectLyrics;
    const elementFonts = settings?.display?.resources?.elementFonts;
    const currentFont = notationElement === undefined ? null : elementFonts?.get(notationElement);
    if (currentFont?.withSize) elementFonts.set(notationElement, currentFont.withSize(LYRIC_FONT_SIZE));
  }

  // AlphaTab decides whether to print a dynamic by looking back along the
  // beat's own voice. A MuseScore second voice that first sounds mid-score
  // has no history there, so the staff's prevailing dynamic is printed again
  // (Blake, Autumn m12: a stray "pp"). Dynamics belong to the staff. A lower
  // voice that is sounding speaks for it, and is also the only one whose
  // values can be trusted: the importer stamps one running dynamic on beats
  // in document order, voice 1 before voice 2, so a change late in a bar
  // leaks onto the second voice's earlier beats. Otherwise compare with
  // whatever sounded last on the staff, the lower voice winning a tie.
  function staffDynamicChangesAt(beat) {
    if (typeof writtenDynamicForBeat === "function") return writtenDynamicForBeat(beat) !== undefined;
    const bar = beat.voice.bar;
    if (bar.staff.track.score.stylesheet.hideDynamics || beat.isEmpty || beat.voice.isEmpty || beat.isRest) return false;
    const start = beat.playbackStart;
    const sounds = (other) => !other.isRest && !other.isEmpty;
    for (const voice of bar.voices) {
      if (voice.index < beat.voice.index && voice.beats.some((other) => sounds(other)
        && other.playbackStart <= start && start < other.playbackStart + other.playbackDuration)) return false;
    }
    for (let index = bar.index; index >= 0; index -= 1) {
      const limit = index === bar.index ? start : Infinity;
      let previous = null;
      let previousEnd = -1;
      for (const voice of bar.staff.bars[index].voices) {
        for (const other of voice.beats) {
          if (!sounds(other) || other.playbackStart >= limit) continue;
          const end = Math.min(other.playbackStart + other.playbackDuration, limit);
          if (end > previousEnd) { previous = other; previousEnd = end; }
        }
      }
      if (previous) return beat.dynamics !== previous.dynamics;
    }
    return true;
  }

  function installStaffLevelDynamics() {
    const dynamics = window.alphaTab?.NotationElement?.EffectDynamics;
    for (const factory of window.alphaTab?.Environment?.defaultRenderers ?? []) {
      for (const band of factory.effectBands ?? []) {
        if (band?.effect?.notationElement !== dynamics || typeof band.effect.shouldCreateGlyph !== "function") continue;
        band.effect.shouldCreateGlyph = (_settings, beat) => staffDynamicChangesAt(beat);
      }
    }
  }

  function installLowerVoiceRestPlacement() {
    const installed = Symbol.for("melete.lowerVoiceRestPlacement");
    for (const factory of window.alphaTab.Environment.defaultRenderers) {
      if (factory.staffId !== "score" || factory[installed]) continue;
      const create = factory.create;
      factory.create = function(...args) {
        const renderer = create.apply(this, args);
        const helper = renderer.collisionHelper;
        const placeRest = helper.applyRestCollisionOffset;
        helper.applyRestCollisionOffset = function(beat, y, step) {
          if (beat.isRest && beat.voice.index === 1 &&
              renderer.getBeatDirection(beat) === window.alphaTab.rendering.BeamDirection.Down) {
            // AlphaTab 1.8.4 forces voice 2 upward regardless of stem direction.
            // Use its lower-side collision branch without changing the score voice.
            const voice = Object.create(beat.voice, {index: {value: 2}});
            const layoutBeat = Object.create(beat, {voice: {value: voice}});
            return placeRest.call(this, layoutBeat, y, step);
          }
          return placeRest.call(this, beat, y, step);
        };
        return renderer;
      };
      factory[installed] = true;
    }
  }

  function installNotationFormatting() {
    const alpha = window.alphaTab;
    const installed = Symbol.for("melete.notationFormatting");
    const view = (source, key, value) => Object.create(source, {[key]: {value}});
    for (const factory of alpha.Environment.defaultRenderers) {
      for (const band of factory.effectBands || []) {
        const effect = band.effect;
        if ([alpha.NotationElement.EffectMarker, alpha.NotationElement.EffectChordNames].includes(effect.notationElement)) {
          Object.defineProperty(effect, "canShareBand", {value: false, configurable: true});
        }
        if (effect.notationElement === alpha.NotationElement.EffectMarker && !effect[installed]
          && typeof effect.createNewGlyph === "function") {
          const create = effect.createNewGlyph;
          effect.createNewGlyph = function(renderer, beat) {
            const glyph = create.call(this, renderer, beat);
            glyph.font = glyph.font.withSize(18);
            glyph.font.weight = alpha.model.FontWeight.Bold;
            glyph.font.style = alpha.model.FontStyle.Plain;
            glyph.textBaseline = alpha.platform.TextBaseline.Top;
            const layout = glyph.doLayout, paint = glyph.paint;
            glyph.doLayout = function() {
              this.width = this.height = 0;
              layout.call(this);
              this.width += 12;
              this.height += 8;
            };
            glyph.paint = function(x, y, canvas) {
              const left = x + this.x, top = y + this.y;
              const right = left + this.width, bottom = top + this.height, radius = 3;
              const width = canvas.lineWidth;
              canvas.lineWidth = 1;
              canvas.beginGroup("section-heading");
              canvas.beginPath();
              canvas.moveTo(left + radius, top);
              canvas.lineTo(right - radius, top);
              canvas.quadraticCurveTo(right, top, right, top + radius);
              canvas.lineTo(right, bottom - radius);
              canvas.quadraticCurveTo(right, bottom, right - radius, bottom);
              canvas.lineTo(left + radius, bottom);
              canvas.quadraticCurveTo(left, bottom, left, bottom - radius);
              canvas.lineTo(left, top + radius);
              canvas.quadraticCurveTo(left, top, left + radius, top);
              canvas.stroke();
              paint.call(this, x + 6, y + 4, canvas);
              canvas.endGroup();
              canvas.lineWidth = width;
            };
            return glyph;
          };
          effect[installed] = true;
        }
        if (effect.notationElement !== alpha.NotationElement.EffectTempo || effect[installed]) continue;
        const create = effect.createNewGlyph;
        effect.createNewGlyph = function(renderer, beat) {
          // Round the rendering view only, never the timing used by playback.
          const master = beat.voice.bar.masterBar;
          const displayMaster = view(master, "tempoAutomations", master.tempoAutomations.map(mark =>
            view(mark, "value", Number(mark.value.toFixed(2)))));
          return create.call(this, renderer, view(beat, "voice",
            view(beat.voice, "bar", view(beat.voice.bar, "masterBar", displayMaster))));
        };
        effect[installed] = true;
      }
    }
  }

  function createLeftEdgeCursorHandler(alpha, player) {
    const systems = new WeakMap();
    let beatTarget = null, barTarget = null, clockDriven = false;
    const restNames = {1: "RestWhole", 2: "RestHalf", 4: "RestQuarter", 8: "Rest8th",
      16: "Rest16th", 32: "Rest32nd", 64: "Rest64th", 128: "Rest128th", 256: "Rest256th"};
    function columns(bounds) {
      const system = bounds.barBounds.masterBarBounds.staffSystemBounds;
      if (systems.has(system)) return systems.get(system);
      const groups = new Map();
      for (const master of system.bars) for (const bar of master.bars) for (const beat of bar.beats) {
        const center = beat.onNotesX;
        if (!Number.isFinite(center)) continue;
        const notes = (beat.notes || []).map(note => note.noteHeadBounds?.x).filter(Number.isFinite);
        let left = notes.length ? Math.min(...notes) : null;
        if (left === null && beat.beat.isRest) {
          const full = beat.beat.isFullBarRest;
          const symbol = alpha.model.MusicFontSymbol[full ? "RestWhole" : restNames[beat.beat.duration]];
          const width = player.settings.display.resources.engravingSettings.glyphWidths.get(symbol);
          if (Number.isFinite(width)) left = (full ? beat.realBounds.x + beat.realBounds.w / 2 : center)
            - width * player.settings.display.scale / 2;
        }
        if (!Number.isFinite(left)) continue;
        // At a shared onset, a sounding note wins over another part's full-bar rest.
        const key = `${master.index}:${beat.beat.absoluteDisplayStart}`;
        const existing = groups.get(key);
        if (!existing || (notes.length && !existing.hasNotes)) groups.set(key, {center, left, hasNotes: !!notes.length});
        else if (!!notes.length === existing.hasNotes) existing.left = Math.min(existing.left, left);
      }
      const result = [...groups.values()].sort((a, b) => a.center - b.center);
      systems.set(system, result);
      return result;
    }
    function position(bounds, x) {
      const points = columns(bounds);
      if (!points.length) return x;
      let previous = points[0];
      if (x <= previous.center) return previous.left + x - previous.center;
      for (const next of points.slice(1)) {
        if (x <= next.center && next.center > previous.center) {
          const ratio = (x - previous.center) / (next.center - previous.center);
          return previous.left + (next.left - previous.left) * ratio;
        }
        previous = next;
      }
      const end = bounds.barBounds.masterBarBounds.staffSystemBounds.realBounds;
      const right = Math.max(previous.center + 1, end.x + end.w);
      const ratio = Math.min(1, (x - previous.center) / (right - previous.center));
      return previous.left + (right - previous.left) * ratio;
    }
    return {
      onAttach(cursors) { beatTarget = cursors.beatCursor; barTarget = cursors.barCursor; },
      onDetach() { beatTarget = barTarget = null; clockDriven = false; },
      release() { clockDriven = false; },
      sync(tick) {
        if (!beatTarget || !barTarget || !player.tickCache || !player.boundsLookup) return;
        const found = player.tickCache.findBeat(new Set(player.tracks.map(track => track.index)), tick);
        const bounds = found && player.boundsLookup.findBeat(found.beat);
        if (!bounds) return;
        clockDriven = true;
        const master = bounds.barBounds.masterBarBounds;
        const box = master.visualBounds;
        let end = bounds.realBounds.x + bounds.realBounds.w;
        if (found.nextBeat && found.cursorMode === alpha.midi.MidiTickLookupFindBeatResultCursorMode.ToNextBext) {
          const next = player.boundsLookup.findBeat(found.nextBeat.beat);
          if (next?.barBounds.masterBarBounds.staffSystemBounds === master.staffSystemBounds) end = next.onNotesX;
        }
        const fraction = Math.max(0, Math.min(1, (tick - found.start) / Math.max(1, found.tickDuration)));
        const x = position(bounds, bounds.onNotesX + (end - bounds.onNotesX) * fraction);
        beatTarget.transitionToX(0, x);
        beatTarget.setBounds(x, box.y, 1, box.h);
        barTarget.setBounds(box.x, box.y, box.w, box.h);
      },
      placeBarCursor(cursor, bounds) {
        // AlphaTab 1.8.4 calls onDetach on the new handler when replacing one.
        // Placement callbacks provide the live public cursor objects as well.
        barTarget = cursor;
        if (clockDriven) return;
        const box = bounds.barBounds.masterBarBounds.visualBounds;
        cursor.setBounds(box.x, box.y, box.w, box.h);
      },
      placeBeatCursor(cursor, bounds, currentX) {
        beatTarget = cursor;
        if (clockDriven) return;
        const x = position(bounds, currentX), box = bounds.barBounds.masterBarBounds.visualBounds;
        cursor.transitionToX(0, x);
        cursor.setBounds(x, box.y, 1, box.h);
      },
      transitionBeatCursor(cursor, bounds, currentX, endX, duration, mode) {
        beatTarget = cursor;
        if (clockDriven) return;
        const start = position(bounds, currentX), end = position(bounds, endX);
        const factor = mode === alpha.midi.MidiTickLookupFindBeatResultCursorMode.ToNextBext ? 2 : 1;
        cursor.transitionToX(duration * factor, start + (end - start) * factor);
      },
    };
  }

  function installWrittenDirections(xml, division) {
    const alpha = window.alphaTab;
    const elements = alpha.NotationElement;
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");
    const expressions = [], equations = [];
    const children = (node, name) => [...node.children].filter(child => child.localName === name);
    const number = (node, name, fallback = 0) => Number(children(node, name)[0]?.textContent ?? fallback);
    const noteSymbol = {quarter: 0xECA5, eighth: 0xECA7, half: 0xECA3, whole: 0xECA2, '16th': 0xECA9};
    const parts = children(documentXml.documentElement, "part");
    parts.forEach((part, track) => {
      let divisions = 1;
      children(part, "measure").forEach((measure, bar) => {
        let position = 0;
        for (const node of measure.children) {
          if (node.localName === "attributes") divisions = number(node, "divisions", divisions);
          if (node.localName === "backup") position -= number(node, "duration") / divisions;
          if (node.localName === "forward") position += number(node, "duration") / divisions;
          if (node.localName === "note" && !children(node, "chord").length && !children(node, "grace").length) {
            position += number(node, "duration") / divisions;
          }
          if (node.localName !== "direction") continue;
          const at = position + number(node, "offset") / divisions;
          const address = {track, staff: number(node, "staff", 1) - 1, bar, at,
            placement: node.getAttribute("placement") === "above" ? "above" : "below"};
          for (const type of children(node, "direction-type")) {
            for (const dynamic of children(type, "dynamics")) {
              const value = alpha.model.DynamicValue[dynamic.firstElementChild?.localName.toUpperCase()];
              if (value !== undefined) expressions.push({...address, dynamic: value});
            }
            for (const wedge of children(type, "wedge")) {
              expressions.push({...address, wedge: wedge.getAttribute("type"), number: wedge.getAttribute("number") || "1"});
            }
            for (const metronome of children(type, "metronome")) {
              const notes = [];
              for (const item of metronome.children) {
                if (item.localName === "beat-unit" && noteSymbol[item.textContent]) {
                  notes.push({symbol: noteSymbol[item.textContent], dots: 0});
                } else if (item.localName === "beat-unit-dot" && notes.length) notes.at(-1).dots++;
              }
              if (notes.length === 2) equations.push({...address, notes});
            }
          }
          // MuseScore sometimes exports a metric equation as SMuFL words plus
          // an empty metronome element. Recover only the explicit note equation.
          const words = [...node.querySelectorAll("direction-type > words")].map(word => word.textContent).join("");
          const match = words.match(/^\s*([\uECA2-\uECAF])(\uECB7*)\s*=\s*([\uECA2-\uECAF])(\uECB7*)(?:\s*\([\uECA2-\uECAF]\s*=\s*[\d.]+\))?/);
          if (match) equations.push({...address, importedText: match[0], notes: [
            {symbol: match[1].codePointAt(0), dots: match[2].length},
            {symbol: match[3].codePointAt(0), dots: match[4].length},
          ]});
        }
      });
    });

    let directions = new WeakMap();
    const source = alpha.Environment.defaultRenderers.find(factory => factory.staffId === "score");
    const dynamicBand = source.effectBands.find(band => band.effect.notationElement === elements.EffectDynamics);
    const hairpinBand = source.effectBands.find(band => band.effect.notationElement === elements.EffectCrescendo);
    if (expressions.length && dynamicBand && hairpinBand) {
      writtenDynamicForBeat = beat => {
        const entry = directions.get(beat);
        return entry?.above?.dynamic ?? entry?.below?.dynamic;
      };
      const nativeDynamic = dynamicBand.effect.createNewGlyph.bind(dynamicBand.effect);
      const nativeHairpin = hairpinBand.effect.createNewGlyph.bind(hairpinBand.effect);
      const aboveMode = source.effectBands.find(band => band.effect.notationElement === elements.EffectFermata).mode;
      source.effectBands = source.effectBands.filter(band => band !== dynamicBand && band !== hairpinBand);
      for (const placement of ["above", "below"]) {
        const effect = Object.create(hairpinBand.effect, {
          effectId: {value: `melete.expressions.${placement}`},
          canShareBand: {value: false},
        });
        effect.isWrittenExpression = true;
        effect.isDynamicVisible = () => true;
        effect.shouldCreateGlyph = (_settings, beat) => {
          const info = directions.get(beat)?.[placement];
          return !beat.voice.bar.staff.track.score.stylesheet.hideDynamics &&
            Boolean(info?.span || (info?.dynamic !== undefined && effect.isDynamicVisible(beat)));
        };
        effect.canExpand = (left, right) => {
          const a = directions.get(left)?.[placement], b = directions.get(right)?.[placement];
          return Boolean(a?.span && a.span === b?.span);
        };
        effect.createNewGlyph = (renderer, beat) => {
          const info = directions.get(beat)[placement];
          const glyph = nativeHairpin(renderer, Object.create(beat, {crescendo: {value: info.span?.type || 0}}));
          const dynamic = info.dynamic === undefined || !effect.isDynamicVisible(beat) ? null : nativeDynamic(renderer,
            Object.create(beat, {dynamics: {value: info.dynamic}}));
          glyph.writtenDynamic = dynamic;
          const layout = glyph.doLayout, paint = glyph.paint;
          glyph.doLayout = function() {
            layout.call(this);
            this.height = this.renderer.smuflMetrics.glyphHeights.get(alpha.model.MusicFontSymbol.DynamicForte);
            if (dynamic) { dynamic.renderer = this.renderer; dynamic.doLayout(); }
          };
          glyph.paint = function(x, y, canvas) {
            if (info.span) paint.call(this, x, y, canvas);
            if (dynamic) {
              dynamic.x = this.x;
              dynamic.y = this.y;
              canvas.beginGroup(`written-dynamic written-${placement} b${beat.id}`);
              dynamic.paint(x, y, canvas);
              canvas.endGroup();
            }
          };
          glyph.paintGrouped = function(x, y, end, canvas) {
            const metrics = this.renderer.smuflMetrics;
            let start = x + this.x;
            if (dynamic) start += dynamic.width / 2 + 8;
            end -= metrics.glyphWidths.get(alpha.model.MusicFontSymbol.NoteheadBlack) / 2;
            const origin = x - this.renderer.x;
            for (let bar = this.renderer; bar && bar.staff === this.renderer.staff; bar = bar.nextRenderer) {
              for (const voice of bar.bar.voices) {
                const band = (placement === "above" ? bar.topEffects : bar.bottomEffects).getBand(voice, effect.effectId);
                for (const mark of band?.iterateAllGlyphs() || []) {
                  const center = origin + bar.x + mark.x;
                  if (mark.writtenDynamic && center > start) end = Math.min(end, center - mark.writtenDynamic.width / 2 - 6);
                }
              }
              if (origin + bar.x + bar.width > end + 50) break;
            }
            if (end <= start) return;
            const center = y + this.y + this.height / 2;
            const aperture = metrics.glyphHeights.get(alpha.model.MusicFontSymbol.DynamicCrescendoHairpin) / 2;
            const opens = info.span.type === alpha.model.CrescendoType.Crescendo;
            const lineWidth = canvas.lineWidth;
            canvas.lineWidth = metrics.hairpinThickness;
            canvas.beginGroup(`written-hairpin written-${placement} b${beat.id}`);
            canvas.beginPath();
            canvas.moveTo(start, center - (opens ? 0 : aperture));
            canvas.lineTo(end, center - (opens ? aperture : 0));
            canvas.moveTo(start, center + (opens ? 0 : aperture));
            canvas.lineTo(end, center + (opens ? aperture : 0));
            canvas.stroke();
            canvas.endGroup();
            canvas.lineWidth = lineWidth;
          };
          return glyph;
        };
        source.effectBands.push({effect, mode: placement === "above" ? aboveMode : dynamicBand.mode});
      }
    }

    const tempoEffects = new Set();
    for (const factory of alpha.Environment.defaultRenderers) for (const band of factory.effectBands || []) {
      if (band.effect.notationElement !== elements.EffectTempo || tempoEffects.has(band.effect)) continue;
      tempoEffects.add(band.effect);
      const create = band.effect.createNewGlyph;
      band.effect.createNewGlyph = function(renderer, beat) {
        const glyph = create.call(this, renderer, beat);
        const master = beat.voice.bar.masterBar;
        const matching = equations.filter(mark => mark.bar === master.index);
        if (!matching.length) return glyph;
        glyph.paint = function(x, y, canvas) {
          const metrics = this.renderer.smuflMetrics, resources = this.renderer.resources;
          const scale = metrics.tempoNoteScale;
          const oldFont = canvas.font, oldBaseline = canvas.textBaseline, oldAlign = canvas.textAlign;
          canvas.font = resources.elementFonts.get(elements.EffectMarker);
          canvas.textBaseline = 3; // AlphaTab TextBaseline.Alphabetic.
          canvas.textAlign = 0; // AlphaTab TextAlign.Left.
          const baseline = y + this.y + this.height + metrics.glyphBottom.get(0xECA5) * scale;
          for (const mark of matching) {
            canvas.beginGroup(`metric-equation metric-m${master.index + 1}`);
            let cursor = x + this.renderer.getRatioPositionX(mark.at * division / master.calculateDuration());
            const drawNote = note => {
              canvas.fillMusicFontSymbol(cursor, baseline, scale, note.symbol, false);
              cursor += (metrics.glyphWidths.get(note.symbol) ?? metrics.glyphWidths.get(0xECA5)) * scale;
              for (let dot = 0; dot < note.dots; dot++) {
                cursor += 2;
                canvas.fillMusicFontSymbol(cursor, baseline, scale, 0xECB7, false);
                cursor += metrics.glyphWidths.get(0xECB7) * scale;
              }
            };
            drawNote(mark.notes[0]);
            const equals = " = ";
            canvas.fillText(equals, cursor, baseline);
            cursor += canvas.measureText(equals).width;
            drawNote(mark.notes[1]);
            canvas.endGroup();
          }
          canvas.font = oldFont; canvas.textBaseline = oldBaseline; canvas.textAlign = oldAlign;
        };
        return glyph;
      };
    }

    return score => {
      directions = new WeakMap();
      const at = mark => score.masterBars[mark.bar].start + mark.at * division;
      const spans = [], open = new Map();
      for (const mark of expressions) {
        if (!mark.wedge) continue;
        const key = `${mark.track}:${mark.staff}:${mark.number}`;
        if (["crescendo", "diminuendo"].includes(mark.wedge)) {
          open.set(key, {...mark, start: at(mark), type: mark.wedge === "crescendo" ? 1 : 2});
        } else if (mark.wedge === "stop" && open.has(key)) {
          spans.push({...open.get(key), end: at(mark)}); open.delete(key);
        }
      }
      for (const track of score.tracks) for (const staff of track.staves) {
        const marks = expressions.filter(mark => mark.track === track.index && mark.staff === staff.index && mark.dynamic !== undefined);
        const wedges = spans.filter(mark => mark.track === track.index && mark.staff === staff.index);
        for (const bar of staff.bars) {
          const seen = new Set();
          for (const voice of bar.voices) for (const beat of voice.beats) {
            const tick = bar.masterBar.start + beat.playbackStart;
            if (seen.has(tick)) continue;
            seen.add(tick);
            const entry = {};
            for (const mark of marks.filter(mark => Math.abs(at(mark) - tick) < 0.01)) {
              (entry[mark.placement] ||= {}).dynamic = mark.dynamic;
            }
            // A staff-wide wedge belongs to one voice, not every interleaved
            // beat of divisi. Otherwise lower-voice pickups create extra wedges.
            for (const span of wedges.filter(span => voice.index === 0 && span.start <= tick && tick < span.end)) {
              (entry[span.placement] ||= {}).span = span;
            }
            if (Object.keys(entry).length) directions.set(beat, entry);
          }
        }
      }
      // Remove only the duplicated word-form equation; its music-font version
      // now occupies the system's native tempo band, whichever parts are shown.
      for (const mark of equations) for (const track of score.tracks) for (const staff of track.staves) {
        for (const voice of staff.bars[mark.bar]?.voices || []) for (const beat of voice.beats) {
          if (beat.text && mark.importedText) beat.text = beat.text.replace(mark.importedText, "").trim();
        }
      }
    };
  }

  function demoVideoAddress(value) {
    try {
      const address = new URL(String(value || ""));
      return address.protocol === "https:" || address.protocol === "http:" ? address.href : "";
    } catch {
      return "";
    }
  }

  function preferenceDefaults() {
    const defaults = config.defaults || {};
    let practicePart = null;
    if (Number.isInteger(defaults.practicePart) && defaults.practicePart >= 0 && defaults.practicePart < parts.length) {
      practicePart = defaults.practicePart;
    } else if (typeof defaults.practicePart === "string") {
      const wanted = defaults.practicePart.trim().toLocaleLowerCase();
      const match = parts.findIndex((part) => [part.name, part.short, part.id].some((value) => String(value).toLocaleLowerCase() === wanted));
      if (match >= 0) practicePart = match;
    }
    return {
      tempo: nearestAllowed(Number(defaults.tempo) || 100, TEMPO_VALUES),
      metronome: nearestAllowed(Number(defaults.metronome) || 0, METRONOME_VALUES),
      vertical: nearestAllowed(Number(defaults.vertical) || (window.matchMedia("(max-width: 600px)").matches ? 70 : 100), VERTICAL_VALUES),
      horizontal: nearestAllowed(Number(defaults.horizontal) || 100, HORIZONTAL_VALUES),
      flow: defaults.flow === "continuous" ? "continuous" : "wrap",
      scoreView: defaults.scoreView === "bars" ? "bars" : "standard",
      lyrics: defaults.lyrics === "changes" ? "changes" : "full",
      hiddenLyrics: [],
      lyricEditing: false,
      practicePart,
      volumes: mixerParts.map(({source}) => nearestAllowed(clamp(Number(defaults.volumes?.[source] ?? 100), 0, VOLUME_VALUES.at(-1)), VOLUME_VALUES)),
      pans: mixerParts.map(({source}) => nearestAllowed(clamp(Number(defaults.pans?.[source] ?? 0), -100, 100), PAN_VALUES)),
    };
  }

  function captureSettingsState() {
    return {
      tempo: tempoControl.value(),
      metronome: metronomeControl.value(),
      takeReverb: takeReverbControl.value(),
      takeVolume: takeVolumeControl.value(),
      vertical: verticalControl.value(),
      horizontal: horizontalControl.value(),
      flow,
      scoreView,
      lyrics: lyricsMode,
      hiddenLyrics: [...hiddenLyricWords],
      lyricEditing,
      practicePart: practicePartIndex,
      practiceDivisi: [...practiceDivisi],
      visible: parts.map((_, index) => visibleTracks.has(index)),
      visibleChannels: mixerParts.map((_, index) => visibleChannels.has(index)),
      audible: mixerParts.map((_, index) => audibleTracks.has(index)),
      volumes: [...trackVolumes],
      pans: [...trackPans],
      practiceMixMode: activePracticeMix,
      practiceMixPart: practiceMixPartIndex,
      practiceMixUndo: practiceMixUndo ? {
        audible: [...practiceMixUndo.audible],
        volumes: [...practiceMixUndo.volumes],
      } : null,
      loopStart: loopStartMeasure,
      loopEnd: loopEndMeasure,
      loopEnabled,
      reference: referencePlayer?.state,
      loopStartTick,
      loopEndTick,
    };
  }

  function cloneSettingsState(state) {
    return {
      ...state,
      hiddenLyrics: [...(state.hiddenLyrics || [])],
      visible: [...state.visible],
      visibleChannels: state.visibleChannels && [...state.visibleChannels],
      practiceDivisi: [...(state.practiceDivisi || [])],
      audible: [...state.audible],
      volumes: [...state.volumes],
      pans: [...state.pans],
      practiceMixUndo: state.practiceMixUndo ? {
        audible: [...state.practiceMixUndo.audible],
        volumes: [...state.practiceMixUndo.volumes],
      } : null,
    };
  }

  function restorePracticeMixInState(state) {
    const snapshot = state.practiceMixUndo;
    if (snapshot) {
      state.audible = [...snapshot.audible];
      state.volumes = [...snapshot.volumes];
    }
    state.practiceMixMode = null;
    state.practiceMixPart = null;
    state.practiceMixUndo = null;
  }

  function applySettingsState(state) {
    referencePlayer?.restore(state.reference);
    shortcutHints.clear();
    hideShortcutTip();
    const previousVisible = parts.map((_, index) => visibleTracks.has(index));
    const previousFlow = flow;
    const previousScoreView = scoreView;
    const previousLyrics = lyricsMode;
    const previousVertical = verticalControl.value();
    const previousHorizontal = horizontalControl.value();
    visibleTracks.clear();
    state.visible.forEach((visible, index) => { if (visible) visibleTracks.add(index); });
    restoreVisibleChannels(state);
    audibleTracks.clear();
    state.audible.forEach((audible, index) => { if (audible) audibleTracks.add(index); });
    trackVolumes = state.volumes.map((value) => nearestAllowed(clamp(Number(value), 0, VOLUME_VALUES.at(-1)), VOLUME_VALUES));
    trackPans = state.pans.map((value) => nearestAllowed(clamp(Number(value), -100, 100), PAN_VALUES));
    practiceDivisi = normalizePracticeDivisi(state.practiceDivisi);
    syncPracticeFromSee();
    activePracticeMix = ["learn", "check"].includes(state.practiceMixMode) ? state.practiceMixMode : null;
    practiceMixPartIndex = activePracticeMix ? state.practiceMixPart ?? practicePartIndex : null;
    practiceMixUndo = normalizePracticeMixUndo(state.practiceMixUndo);
    restoreLoopState(state);
    tempoControl.setValue(state.tempo, false);
    metronomeControl.setValue(state.metronome, false);
    takeReverbControl.setValue(state.takeReverb || 0, false);
    takeVolumeControl.setValue(state.takeVolume ?? 100, false);
    engine?.takeBus?.setVolume(takeVolumeControl.value());
    engine?.takeBus?.set(takeReverbControl.value());
    verticalControl.setValue(state.vertical, false);
    setFlow(state.flow, { render: false, persist: false });
    setScoreView(state.scoreView, { render: false, persist: false });
    horizontalControl.setValue(state.horizontal, false);
    setLyricsMode(state.lyrics, { reload: false, persist: false });
    restoreHiddenLyrics(state.hiddenLyrics);
    setLyricEditing(state.lyricEditing, { persist: false });
    volumeControls.forEach((control, index) => control.setValue(trackVolumes[index], false));
    panControls.forEach((control, index) => control.setValue(trackPans[index], false));
    practicePartPager?.setValue(practiceMixerIndex());
    updateMixerAppearance();
    updateLoopState();
    engine?.setMetronome(metronomeControl.value());
    if (api) api.playbackSpeed = tempoControl.value() / 100;
    updateNoteActionLabel();
    savePreferences();
    if (lyricsMode !== previousLyrics) {
      reloadNotationForDisplay();
      if (scoreView === "bars") scheduleBarRender();
    }
    else {
      const renderRelevantChanged = flow !== previousFlow
        || scoreView !== previousScoreView
        || verticalControl.value() !== previousVertical
        || horizontalControl.value() !== previousHorizontal
        || parts.some((_, index) => visibleTracks.has(index) !== previousVisible[index])
        || lyricsMode !== previousLyrics;
      if (renderRelevantChanged) scheduleRender();
      else renderPitchTrace();
    }
  }

  // An intonation-station singer's own mix: what they see and hear, speed and
  // metronome. Loop, display and recording settings stay shared.
  const SINGER_PLAYBACK = ["tempo", "metronome", "visible", "visibleChannels", "audible", "volumes", "pans",
    "practiceDivisi", "practiceMixMode", "practiceMixPart", "practiceMixUndo", "reference"];
  const singerPlayback = {
    ready: () => ready && parts.length > 0,
    capture() {
      const state = cloneSettingsState(captureSettingsState());
      return Object.fromEntries(SINGER_PLAYBACK.map(key => [key, state[key]]));
    },
    apply(saved, {startup = false, singer = null, personal = null} = {}) {
      const current = captureSettingsState();
      // A mix saved before the score's parts changed no longer lines up.
      if (["visible", "audible", "volumes", "pans"].some(key => saved?.[key]?.length !== current[key].length)) {
        if (!singer) return false;
        saved=current; personal=null;
      }
      const next = {...current, ...saved};
      const linked = startup && explicitPracticeChoice;
      let ask = false;
      if (singer) {
        const previous = personal?.guideVersion >= 1 ? personal.visibleChannels?.flatMap((on,i)=>on ? [i] : []) : [];
        const prior = previous?.length === 1 ? previous[0] : -1;
        const index = linked ? practiceMixerIndex() : window.MeleteStation.guideChannel(singer, mixerParts, prior);
        const preset = window.MeletePracticeMix.stationDefault(), roles=sequence.practiceRoles;
        if (index < 0) { next.visibleChannels=mixerParts.map(()=>false); ask=true; }
        else if (index !== prior || window.MeleteStation.untouchedFirstPreset(personal,mixerParts,index)) Object.assign(next, window.MeleteStation.guideMix(mixerParts,index,preset,roles),
          {reference:next.reference && {...next.reference, enabled:false}});
        else {
          next.visibleChannels=mixerParts.map((_,i)=>i===index);
          if(window.MeleteStation.followsOldDefault(personal,mixerParts,index,preset,roles))
            Object.assign(next,window.MeletePracticeMix.project(mixerParts,index,preset,roles));
        }
      }
      // Arrival links and first-visit choices can run before the player is
      // ready to restore a station mix. They must still win over its See row.
      if (startup && explicitPracticeChoice) {
        next.visible = current.visible;
        next.visibleChannels = current.visibleChannels;
        next.practiceDivisi = current.practiceDivisi;
      }
      applySettingsState(next);
      if (scoreView === "bars" && current.visibleChannels.some((v,i)=>v!==next.visibleChannels[i])) scheduleBarRender();
      if (singer && !linked) {
        hidePartChooser();
        if (ask && pitchCapturePageActive) {
          showPartChooser({title:`Which part is ${singer.name} recording?`});
          partChooserThen=()=>{const state=captureSettingsState(); applySettingsState({...state,...window.MeleteStation.guideMix(mixerParts,practiceMixerIndex(),window.MeletePracticeMix.stationDefault(),sequence.practiceRoles),
            reference:state.reference && {...state.reference,enabled:false}});};
        }
      }
      return true;
    },
  };

  function performScopedReset(label, mutate, beforeOverride = null) {
    const before = beforeOverride ? cloneSettingsState(beforeOverride) : captureSettingsState();
    const after = captureSettingsState();
    mutate(after, preferenceDefaults());
    if (JSON.stringify(after) === JSON.stringify(before)) {
      showToast(`${label} is already at its default`);
      return;
    }
    applySettingsState(after);
    showToast(`${label} reset`, "", () => {
      applySettingsState(before);
      showToast(`${label} restored`);
    });
  }

  function registerResetTarget(element, label, mutate, { labelTarget = false, cancelActive = null, holdToReset = true } = {}) {
    if (!element || element.dataset.resetBound === "true") return;
    element.dataset.resetBound = "true";
    element.dataset.resettable = "true";
    if (labelTarget) {
      element.dataset.resetLabel = "true";
      if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
    }
    element.setAttribute("aria-description", holdToReset
      ? `Right-click, long-press, or press Shift+F10 to reset ${label}`
      : `Right-click or press Shift+F10 to reset ${label}`);
    // The same news for everyone else: help mode adds this to the control's own
    // tooltip, so the gesture is not something only a screen reader is told.
    element.dataset.resetScope = label;
    element.dataset.resetHold = String(holdToReset);

    let holdTimer = 0;
    let holdPointerId = null;
    let holdX = 0;
    let holdY = 0;
    let holdSnapshot = null;
    let suppressClickUntil = 0;
    let suppressContextUntil = 0;
    const clearHold = () => {
      window.clearTimeout(holdTimer);
      holdTimer = 0;
      holdPointerId = null;
      holdSnapshot = null;
    };
    const reset = (snapshot = null) => {
      if (element.dataset.mixerRow) learnShortcut("reset-row");
      performScopedReset(label, mutate, snapshot);
    };

    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < suppressContextUntil) return;
      const snapshot = holdSnapshot;
      const pointerId = holdPointerId;
      if (snapshot) {
        suppressClickUntil = performance.now() + 800;
        suppressContextUntil = performance.now() + 800;
        cancelActive?.(pointerId);
      }
      clearHold();
      reset(snapshot);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      event.stopPropagation();
      suppressContextUntil = performance.now() + 500;
      reset();
    });
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType === "mouse" || !holdToReset) return;
      clearHold();
      holdPointerId = event.pointerId;
      holdX = event.clientX;
      holdY = event.clientY;
      holdSnapshot = captureSettingsState();
      holdTimer = window.setTimeout(() => {
        const snapshot = holdSnapshot;
        const pointerId = holdPointerId;
        holdTimer = 0;
        suppressClickUntil = performance.now() + 800;
        suppressContextUntil = performance.now() + 800;
        cancelActive?.(pointerId);
        reset(snapshot);
      }, 600);
    }, true);
    element.addEventListener("pointermove", (event) => {
      if (event.pointerId !== holdPointerId) return;
      if (Math.hypot(event.clientX - holdX, event.clientY - holdY) > 8) clearHold();
    }, true);
    element.addEventListener("pointerup", clearHold, true);
    element.addEventListener("pointercancel", clearHold, true);
    element.addEventListener("click", (event) => {
      if (performance.now() >= suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function attachHoldReset(button, activate, reset, label, {contextReset = false, isolate = false} = {}) {
    let gesture = null;
    let timer = 0;
    let feedback = 0;
    let suppressClick = false;
    button.classList.add("hold-reset");
    let suppressTouchContextUntil = 0;
    button.setAttribute("aria-description", isolate ? "Hold or Shift+Enter to isolate; repeat to hear everyone" : `Hold or press Delete to clear ${label}`);
    const clearTimers = () => {
      window.clearTimeout(timer);
      window.clearTimeout(feedback);
      button.classList.remove("is-holding");
    };
    const cancel = () => {
      if (!gesture) return;
      suppressClick = true;
      clearTimers();
      const id = gesture.id;
      gesture = null;
      if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    };
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || button.disabled) return;
      if (gesture) { cancel(); return; }
      suppressClick = false;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, pointerType: event.pointerType };
      button.setPointerCapture(event.pointerId);
      feedback = window.setTimeout(() => button.classList.add("is-holding"), 250);
      timer = window.setTimeout(() => {
        suppressClick = true;
        if (gesture) gesture.didReset = true;
        if (gesture?.pointerType === "touch") suppressTouchContextUntil = Date.now() + 1500;
        clearTimers();
        reset();
      }, 600);
    });
    button.addEventListener("pointermove", (event) => {
      if (gesture?.id === event.pointerId
        && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) cancel();
    });
    button.addEventListener("pointerup", (event) => {
      if (gesture?.id !== event.pointerId) return;
      clearTimers();
      gesture = null;
    });
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("lostpointercapture", cancel);
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (contextReset && Date.now() < suppressTouchContextUntil) return;
      const resetAlready = gesture?.didReset;
      if (gesture?.pointerType === "touch" || event.pointerType === "touch") suppressTouchContextUntil = Date.now() + 1500;
      cancel();
      if (contextReset && !resetAlready) reset();
    });
    window.addEventListener("blur", cancel);
    button.addEventListener("click", (event) => {
      if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
      activate();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter") suppressClick = false;
      if (isolate ? !(event.key === "Enter" && event.shiftKey) : !["Backspace", "Delete"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
      reset();
    });
  }

  function registerStaticResetTargets() {
    const resetAllParts = (state, defaults) => {
      state.practiceDivisi = parts.map(() => null);
      state.visible = parts.map(() => true);
      // See restores per channel; visibleChannels wins over visible on apply.
      state.visibleChannels = mixerParts.map(() => true);
      state.audible = mixerParts.map(() => true);
      state.volumes = [...defaults.volumes];
      state.pans = [...defaults.pans];
      state.practiceMixMode = null;
      state.practiceMixUndo = null;
    };
    const resetPractice = (state, defaults) => {
      restorePracticeMixInState(state);
      state.practicePart = defaults.practicePart;
      state.practiceDivisi = parts.map(() => null);
      state.tempo = defaults.tempo;
      state.metronome = defaults.metronome;
      state.loopStart = null;
      state.loopEnd = null;
      state.loopStartTick = null;
      state.loopEndTick = null;
    };
    const resetDisplay = (state, defaults) => {
      state.scoreView = defaults.scoreView;
      state.flow = defaults.flow;
      state.vertical = defaults.vertical;
      state.horizontal = defaults.horizontal;
      state.lyrics = defaults.lyrics;
      state.hiddenLyrics = [];
      state.lyricEditing = defaults.lyricEditing;
    };

    registerResetTarget(document.getElementById("partsLabel"), "Parts", resetAllParts, { labelTarget: true });
    registerResetTarget(document.getElementById("practiceLabel"), "Practice", resetPractice, { labelTarget: true });
    registerResetTarget(document.getElementById("displayLabel"), "Display", resetDisplay, { labelTarget: true });
    registerResetTarget(settingsSections.get("parts")?.toggle, "Parts", resetAllParts);
    registerResetTarget(settingsSections.get("practice")?.toggle, "Practice", resetPractice);
    registerResetTarget(settingsSections.get("display")?.toggle, "Display", resetDisplay);
    registerResetTarget(elements.practicePart, "practice part", (state, defaults) => {
      restorePracticeMixInState(state);
      state.practicePart = defaults.practicePart;
    }, { cancelActive: (pointerId) => practicePartPager?.cancel(pointerId) });
    registerResetTarget(elements.tempo, "Speed", (state, defaults) => { state.tempo = defaults.tempo; });
    registerResetTarget(elements.metronome, "metronome volume", (state, defaults) => { state.metronome = defaults.metronome; });
    registerResetTarget(elements.loopStart, "loop start", (state) => { state.loopStart = null; state.loopStartTick = null; }, { holdToReset: false });
    registerResetTarget(elements.loopEnd, "loop end", (state) => { state.loopEnd = null; state.loopEndTick = null; }, { holdToReset: false });
    registerResetTarget(elements.flowToggle, "Scroll", (state, defaults) => { state.flow = defaults.flow; });
    registerResetTarget(elements.verticalScale, "vertical scale", (state, defaults) => { state.vertical = defaults.vertical; });
    registerResetTarget(elements.horizontalScale, "horizontal scale", (state, defaults) => { state.horizontal = defaults.horizontal; });
    registerResetTarget(elements.scoreViewToggle, "Score view", (state, defaults) => { state.scoreView = defaults.scoreView; });

    registerResetTarget(document.querySelector(".practice-speed > span"), "Speed", (state, defaults) => { state.tempo = defaults.tempo; }, { labelTarget: true });
    registerResetTarget(document.querySelector(".practice-metronome-volume > span"), "metronome volume", (state, defaults) => { state.metronome = defaults.metronome; }, { labelTarget: true });
    registerResetTarget(elements.loopToggle, "Loop", (state) => {
      state.loopStart = null; state.loopEnd = null; state.loopStartTick = null; state.loopEndTick = null;
      state.loopEnabled = true;
    }, { holdToReset: false });
    registerResetTarget(document.querySelector(".display-direction-row > span"), "Scroll", (state, defaults) => { state.flow = defaults.flow; }, { labelTarget: true });
    registerResetTarget(document.getElementById("scaleLabel"), "Scale", (state, defaults) => {
      state.vertical = defaults.vertical;
      state.horizontal = defaults.horizontal;
    }, { labelTarget: true });
  }

  function resetStateToDefaults() {
    const defaults = preferenceDefaults();
    visibleTracks.clear();
    audibleTracks.clear();
    parts.forEach((_, index) => visibleTracks.add(index));
    visibleChannels.clear();
    mixerParts.forEach((_, index) => visibleChannels.add(index));
    mixerParts.forEach((_, index) => audibleTracks.add(index));
    trackVolumes = [...defaults.volumes];
    trackPans = [...defaults.pans];
    practicePartIndex = null;
    practiceDivisi = normalizePracticeDivisi([]);
    syncPracticeFromSee();
    activePracticeMix = null;
    practiceMixPartIndex = null;
    practiceMixUndo = null;
    loopStartMeasure = null;
    loopEndMeasure = null;
    loopStartTick = null;
    loopEndTick = null;
    tempoControl.setValue(defaults.tempo, false);
    metronomeControl.setValue(defaults.metronome, false);
    takeReverbControl.setValue(0, false);
    takeVolumeControl.setValue(100, false);
    engine?.takeBus?.set(0);
    verticalControl.setValue(defaults.vertical, false);
    setFlow(defaults.flow, { render: false, persist: false });
    setScoreView(defaults.scoreView, { render: false, persist: false });
    horizontalControl.setValue(defaults.horizontal, false);
    setLyricsMode(defaults.lyrics, { reload: false, persist: false });
    restoreHiddenLyrics([]);
    setLyricEditing(defaults.lyricEditing, { persist: false });
  }

  function portableStateFingerprint() {
    return String(buildMetadata.fingerprint || config.slug || config.title || "score");
  }

  function portableStateForCurrentScore() {
    if (!portableState || portableState.version !== PORTABLE_STATE_VERSION
      || portableState.fingerprint !== portableStateFingerprint()) return null;
    return portableState;
  }

  function currentPreferenceState() {
    const state = {
      mixerChannels: 1,
      lastGuideChannel,
      tempo: tempoControl.value(),
      metronome: metronomeControl.value(),
      takeReverb: takeReverbControl.value(),
      takeVolume: takeVolumeControl.value(),
      vertical: verticalControl.value(),
      horizontal: horizontalControl.value(),
      flow,
      scoreView,
      lyrics: lyricsMode,
      hiddenLyrics: [...hiddenLyricWords],
      lyricEditing,
      practicePart: practicePartIndex,
      practiceDivisi: [...practiceDivisi],
      visible: parts.map((_, index) => visibleTracks.has(index)),
      visibleChannels: mixerParts.map((_, index) => visibleChannels.has(index)),
      audible: mixerParts.map((_, index) => audibleTracks.has(index)),
      volumes: [...trackVolumes],
      pans: [...trackPans],
      practiceMixMode: activePracticeMix,
      practiceMixPart: practiceMixPartIndex,
      practiceMixUndo: practiceMixUndo ? {
        audible: [...practiceMixUndo.audible],
        volumes: [...practiceMixUndo.volumes],
      } : null,
      loopStart: loopStartMeasure,
      loopEnd: loopEndMeasure,
      loopEnabled,
      reference: referencePlayer?.state,
      loopStartTick,
      loopEndTick,
      sing: singEnabled,
      help: settingsHelpEnabled,
    };
    return state;
  }

  function applyPreferenceState(stored) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
    referencePlayer?.restore(stored.reference);
    restoreHiddenLyrics(stored.hiddenLyrics);
    setLyricEditing(stored.lyricEditing, { persist: false });
    if (sequence.practiceRoles?.length) stored = window.MeletePracticeRoutes.extendPreferences(stored, sequence.practiceRoles, parts.length);
    stored = window.MeleteDivisiMixer.preferences(stored, mixerParts, parts.length);
    if (TEMPO_VALUES.includes(stored.tempo)) tempoControl.setValue(stored.tempo, false);
    if (METRONOME_VALUES.includes(stored.metronome)) metronomeControl.setValue(stored.metronome, false);
    if (Number.isFinite(stored.takeReverb)) takeReverbControl.setValue(clamp(stored.takeReverb, 0, 100), false);
    if (Number.isFinite(stored.takeVolume)) takeVolumeControl.setValue(clamp(stored.takeVolume, 0, 200), false);
    if (VERTICAL_VALUES.includes(stored.vertical)) verticalControl.setValue(stored.vertical, false);
    if (["wrap", "continuous"].includes(stored.flow)) setFlow(stored.flow, { render: false, persist: false });
    if (["standard", "bars"].includes(stored.scoreView)) setScoreView(stored.scoreView, { render: false, persist: false });
    if (["full", "changes"].includes(stored.lyrics)) setLyricsMode(stored.lyrics, { reload: false, persist: false });
    setSettingsHelp(stored.help === true, { persist: false });
    if (HORIZONTAL_VALUES.includes(stored.horizontal)) horizontalControl.setValue(stored.horizontal, false);
    if (Number.isInteger(stored.practicePart) && stored.practicePart >= 0 && stored.practicePart < parts.length) practicePartIndex = stored.practicePart;
    practiceDivisi = normalizePracticeDivisi(stored.practiceDivisi);
    if (Array.isArray(stored.visible) && stored.visible.length === parts.length && stored.visible.some(Boolean)) {
      visibleTracks.clear();
      stored.visible.forEach((value, index) => { if (value) visibleTracks.add(index); });
    }
    restoreVisibleChannels(stored);
    if (Number.isInteger(stored.lastGuideChannel) && mixerParts[stored.lastGuideChannel]) lastGuideChannel=stored.lastGuideChannel;
    syncPracticeFromSee();
    if (Array.isArray(stored.audible) && stored.audible.length === mixerParts.length) {
      audibleTracks.clear();
      stored.audible.forEach((value, index) => { if (value) audibleTracks.add(index); });
    }
    if (Array.isArray(stored.volumes) && stored.volumes.length === mixerParts.length) {
      trackVolumes = stored.volumes.map((value) => nearestAllowed(clamp(Number(value) || 0, 0, VOLUME_VALUES.at(-1)), VOLUME_VALUES));
    }
    if (Array.isArray(stored.pans) && stored.pans.length === mixerParts.length) {
      trackPans = stored.pans.map((value) => nearestAllowed(clamp(Number(value) || 0, -100, 100), PAN_VALUES));
    }
    restoreLoopState(stored);
    singEnabled = stored.sing === true;
    const storedMixUndo = normalizePracticeMixUndo(stored.practiceMixUndo);
    const storedMixPart = stored.practiceMixPart ?? practicePartIndex;
    if (storedMixUndo && ["learn", "check"].includes(stored.practiceMixMode) && practiceMixMatches(stored.practiceMixMode, storedMixPart)) {
      activePracticeMix = stored.practiceMixMode;
      practiceMixPartIndex = storedMixPart;
      practiceMixUndo = storedMixUndo;
    }
  }

  // Reads the current key, or the first older key that still holds something,
  // moving it across so the next read finds it in its proper place.
  function storedValueFor(key, legacyKeys = []) {
    try {
      const current = localStorage.getItem(key);
      if (current !== null) return current;
      for (const legacy of legacyKeys) {
        const value = localStorage.getItem(legacy);
        if (value === null) continue;
        localStorage.setItem(key, value);
        localStorage.removeItem(legacy);
        return value;
      }
    } catch {
      // Device-local storage is optional.
    }
    return null;
  }

  // Names used to carry the build's fingerprint, so every rebuild left the
  // previous build's entries behind under a name nothing would ever ask for
  // again. By the time this runs the adoptions above have taken whatever this
  // build still wanted, so anything left under a fingerprint is dead, as are
  // this song's own superseded :vN names. Other songs' entries are left alone
  // and clear themselves the next time those songs are opened, and nothing
  // outside this app's prefix is touched — the site shares one origin.
  function sweepSupersededStorage(slug) {
    const fingerprinted = /^choir-practice:[0-9a-f]{16}:/;
    const ownPrefix = `choir-practice:${slug}:`;
    const superseded = (key) => fingerprinted.test(key) || (key.startsWith(ownPrefix) && /:v\d+$/.test(key));
    try {
      const doomed = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && superseded(key)) doomed.push(key);
      }
      doomed.forEach((key) => localStorage.removeItem(key));
      return doomed.length;
    } catch {
      // Device-local storage is optional.
      return 0;
    }
  }

  function loadPreferences() {
    resetStateToDefaults();
    let stored = null;
    let importedPortableState = false;
    try {
      const localValue = storedValueFor(preferenceKey, legacyPreferenceKeys);
      if (localValue !== null) stored = JSON.parse(localValue);
    } catch {
      // Device-local preferences are optional.
    }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      const embeddedPreferences = portableStateForCurrentScore()?.preferences;
      if (embeddedPreferences && typeof embeddedPreferences === "object" && !Array.isArray(embeddedPreferences)) {
        // A shared download carries display settings, not microphone consent.
        stored = { ...embeddedPreferences, sing: false };
        importedPortableState = true;
      }
    }
    applyPreferenceState(stored);
    if (importedPortableState) savePreferences();
  }

  function savePreferences() {
    if (!parts.length) return;
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(currentPreferenceState()));
    } catch {
      // Device-local preferences are optional.
    }
    compPanel?.playbackChanged?.();
    if (linkedPracticeState) clearEditedLinkFields();
  }

  function isMobileSettingsDevice() {
    return navigator.userAgentData?.mobile === true
      || window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  }

  function readSettingsSections() {
    function read(storageKey, defaults) {
      try {
        const value = JSON.parse(localStorage.getItem(storageKey) || "null");
        for (const key of settingsSections.keys()) {
          if (typeof value?.[key] === "boolean") defaults[key] = value[key];
        }
      } catch { /* Layout preferences are optional. */ }
      return defaults;
    }
    mobileSectionOpen = read(settingsSectionsKey, {practice:true});
    desktopSectionOpen = read(desktopSectionsKey, {});
  }

  function settingsSectionCollapsed(key) {
    return Boolean(settingsSections.get(key)?.group.classList.contains("is-collapsed"));
  }

  function syncSettingsSections() {
    const mobile = settingsSectionsMedia.matches;
    elements.settingsPanel.classList.toggle("desktop-sections", !mobile);
    for (const [key, {group, body, toggle}] of settingsSections) {
      const collapsed = mobile ? !mobileSectionOpen[key] : desktopSectionOpen[key] === false;
      const wasCollapsed = group.classList.contains("is-collapsed");
      if (collapsed && body.contains(document.activeElement)) toggle.focus();
      group.classList.toggle("is-collapsed", collapsed);
      body.inert = collapsed;
      toggle.setAttribute("aria-expanded", String(!collapsed));
      if (key === "takes" && collapsed !== wasCollapsed) {
        if (collapsed) {
          elements.takeActions.open = false;
        } else if (ready) void scoreNextTake();
      }
    }
    requestAnimationFrame(updateTransportHeight);
  }

  function setSettingsSection(key, open, {persist = true} = {}) {
    if (!settingsSections.has(key)) return;
    const mobile = settingsSectionsMedia.matches;
    const layout = mobile ? mobileSectionOpen : desktopSectionOpen;
    layout[key] = Boolean(open);
    if (persist) {
      try { localStorage.setItem(mobile ? settingsSectionsKey : desktopSectionsKey, JSON.stringify(layout)); } catch {}
    }
    syncSettingsSections();
  }

  function setupSettingsSections() {
    settingsSectionsMedia = window.matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)");
    for (const group of elements.settingsPanel.querySelectorAll("[data-settings-section]")) {
      const key = group.dataset.settingsSection;
      const label = group.querySelector(".group-label");
      const body = document.createElement("div");
      body.className = "settings-section-content";
      body.id = `settings-${key}-content`;
      for (const child of [...group.children]) if (child !== label) body.append(child);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "settings-section-toggle";
      toggle.setAttribute("aria-label", `${label.textContent} settings`);
      toggle.setAttribute("aria-controls", body.id);
      // Lucide Chevron Down, ISC license. Match the existing inline icon set.
      toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg><span></span>';
      toggle.querySelector("span").textContent = label.textContent;
      toggle.addEventListener("click", () => setSettingsSection(key, settingsSectionCollapsed(key)));
      if (key === "takes") {
        toggle.title = "Click to expand or collapse. Right-click on desktop to show just Parts and Record.";
        toggle.addEventListener("contextmenu", event => {
          if (settingsSectionsMedia.matches) return;
          event.preventDefault();
          desktopSectionOpen = {parts:true, practice:false, display:false, tools:false, takes:true};
          setSettingsSection("takes", true);
        });
      }
      group.append(toggle, body);
      settingsSections.set(key, {group, body, toggle});
    }
    settingsSectionsMedia.addEventListener("change", syncSettingsSections);
    window.addEventListener("storage", event => {
      if (event.key === settingsSectionsKey || event.key === desktopSectionsKey || event.key === null) {
        readSettingsSections();
        syncSettingsSections();
      }
    });
    readSettingsSections();
    syncSettingsSections();
  }

  function loadSettingsOpenState() {
    try {
      const stored = storedValueFor(settingsPanelPreferenceKey, legacySettingsPanelKeys);
      if (stored === "open") return true;
      if (stored === "closed") return false;
    } catch {
      // Device-local preferences are optional.
    }
    return !isMobileSettingsDevice();
  }

  function setSettingsOpen(open, { persist = true } = {}) {
    const expanded = Boolean(open);
    elements.settingsPanel.classList.toggle("is-open", expanded);
    elements.settingsPanel.setAttribute("aria-hidden", String(!expanded));
    elements.settingsToggle.setAttribute("aria-expanded", String(expanded));
    elements.settingsToggle.setAttribute("aria-label", expanded ? "Close settings" : "Open settings");
    if (expanded && ready) {
      takeScoreFailures.clear();
      void refreshMicrophoneChoices();
      void loadTakeLibrary().catch(() => {
        takeNotice = "Local storage unavailable. Enable site storage to record.";
        renderTakePanel();
      });
    } else if (!expanded) {
      elements.takeActions.open = false;
    }
    if (persist) {
      try {
        localStorage.setItem(settingsPanelPreferenceKey, expanded ? "open" : "closed");
      } catch {
        // Device-local preferences are optional.
      }
    }
    if (!expanded && elements.settingsPanel.contains(document.activeElement)) elements.settingsToggle.focus();
    requestAnimationFrame(updateTransportHeight);
    if (takeReview && !engine.playing) {
      pendingLoopRevealTick = Math.max(0, engine.tickAtSeconds(engine.currentSeconds()));
      requestAnimationFrame(revealPendingLoopStart);
    }
  }

  function buildPracticePartPicker() {
    practicePartPager?.destroy();
    practicePartPager = null;
    elements.practicePart.hidden = conductorMode || mixerParts.length<2;
    if (!elements.practicePart.hidden) {
      const options=mixerParts.map((p,i)=>({label:p.short,value:i,color:p.color}))
        .sort((a,b)=>window.MeleteTakePitch.compareParts(a.label,b.label));
      practicePartPager=new InfinitePager(elements.practicePart,{options,value:lastGuideChannel,placeholder:"Part",onTap:()=>{
        if (visibleChannels.size===1) return false;
        if (lastGuideChannel===null) showPartChooser();
        else choosePracticePart(mixerParts[lastGuideChannel].source,mixerParts[lastGuideChannel].line);
        return true;
      }});
    }
    updatePracticeMixAppearance();
  }

  function normalizePracticeDivisi(values) {
    return parts.map((_, index) => {
      const count = partDivisi[index]?.maxLines || 1;
      const value = values?.[index];
      return count > 1 ? Number.isInteger(value) && value >= 0 && value < count ? value : 0 : null;
    });
  }

  function practiceDivisiOptions(index) {
    const count = partDivisi[index]?.maxLines || 1;
    if (count < 2) return [];
    return [{ value: null, label: "All Div" },
      ...Array.from({ length: count }, (_, line) => ({ value: line, label: `Div ${line + 1}` }))];
  }

  function updatePracticeDivisi() {
    // Choosing a practice line never mutes its independent mixer siblings.
    document.getElementById("practiceDivisi")?.remove();
    practicePartPager?.setValue(practiceMixerIndex() ?? lastGuideChannel);
    elements.practicePart.classList.toggle("is-mixed",visibleChannels.size!==1);
    elements.practicePart.title=visibleChannels.size===1 ? "Tap to advance; drag to browse."
      : lastGuideChannel===null ? "Choose your practice part" : "Show only "+mixerParts[lastGuideChannel].name;
    engine?.setPracticeDivisi(practicePartIndex, practiceDivisi[practicePartIndex] ?? null);
  }

  function practiceMixMatches(mode, partIndex = practiceMixPartIndex, { volumesOnly = false } = {}) {
    if (!["learn", "check"].includes(mode) || !Number.isInteger(partIndex) || partIndex < 0
      || partIndex >= mixerParts.length || (!volumesOnly && audibleTracks.size !== mixerParts.length)) return false;
    return mixerParts.every((_, index) => {
      const expected = mode === "check"
        ? index === partIndex ? 20 : 100
        : index === partIndex ? 100 : 20;
      return trackVolumes[index] === expected;
    });
  }

  function normalizePracticeMixUndo(value) {
    if (!value || typeof value !== "object"
      || !Array.isArray(value.audible) || value.audible.length !== mixerParts.length
      || !value.audible.every((item) => typeof item === "boolean")
      || !Array.isArray(value.volumes) || value.volumes.length !== mixerParts.length
      || !value.volumes.every((item) => Number.isFinite(Number(item)))) return null;
    return {
      audible: [...value.audible],
      volumes: value.volumes.map((item) => nearestAllowed(clamp(Number(item), 0, VOLUME_VALUES.at(-1)), VOLUME_VALUES)),
    };
  }

  function cancelPracticeMixSession() {
    activePracticeMix = null;
    practiceMixPartIndex = null;
    practiceMixUndo = null;
  }

  function snapshotPracticeMix() {
    return {
      audible: mixerParts.map((_, index) => audibleTracks.has(index)),
      volumes: [...trackVolumes],
    };
  }

  function restorePracticeMix() {
    const snapshot = normalizePracticeMixUndo(practiceMixUndo);
    if (!snapshot) return false;
    audibleTracks.clear();
    snapshot.audible.forEach((audible, index) => { if (audible) audibleTracks.add(index); });
    trackVolumes = snapshot.volumes.map((value, index) => {
      volumeControls[index]?.setValue(value, false);
      return value;
    });
    cancelPracticeMixSession();
    return true;
  }

  function currentPracticeMix() {
    return practiceMixUndo && practiceMixMatches(activePracticeMix) ? activePracticeMix : null;
  }

  function updatePracticeMixAppearance() {
    updatePracticeDivisi();
    const mode = currentPracticeMix();
    const selectedPart = Number.isInteger(practicePartIndex) ? mixerParts[practiceMixerIndex()] || parts[practicePartIndex] : null;
    elements.practicePart.classList.toggle("has-part", Boolean(selectedPart));
    if (selectedPart) {
      elements.practicePart.style.setProperty("--part-color", selectedPart.color);
      document.documentElement.style.setProperty("--practice-color", selectedPart.color);
    } else {
      elements.practicePart.style.removeProperty("--part-color");
      document.documentElement.style.removeProperty("--practice-color");
    }
    elements.mixer.querySelectorAll("[data-volume-index]").forEach((button) => {
      const index = Number(button.dataset.volumeIndex);
      const active = index === practiceMixPartIndex ? mode : null;
      const nextMode = nextPartVolumeMix(index);
      const next = nextMode === "check" ? "reduce this part" : nextMode === "normal" ? "set all voices to 100%" : "emphasize this part";
      button.dataset.practiceMix = active || "normal";
      button.classList.toggle("is-mix-target", Boolean(active));
      button.dataset.help = `Drag vertically to adjust volume. Hold to ${next}. Shift+Enter does the same.`;
      button.title = `${mixerParts[index].name} volume. ${button.dataset.help} Right-click to reset.`;
    });
  }

  function nextPartVolumeMix(partIndex) {
    // Infer the cycle from the displayed levels, including manually set or reloaded mixes.
    if (trackVolumes.every((value) => value === 100)) return "learn";
    if (practiceMixMatches("learn", partIndex, { volumesOnly: true })) return "check";
    if (practiceMixMatches("check", partIndex, { volumesOnly: true })) return "normal";
    return "learn";
  }

  function cyclePartVolumeMix(partIndex) {
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= mixerParts.length) return;
    const next = nextPartVolumeMix(partIndex);
    if (next !== "normal") {
      applyPracticeMix(next, { toggle: false, partIndex });
      return;
    }
    cancelPracticeMixSession();
    audibleTracks.clear();
    trackVolumes = mixerParts.map((_, index) => {
      audibleTracks.add(index);
      volumeControls[index]?.setValue(100, false);
      return 100;
    });
    updateMixerAppearance();
    savePreferences();
    showToast("All voices at 100%");
  }

  function partPanIsSeparated(partIndex) {
    return Number.isInteger(partIndex) && partIndex >= 0 && partIndex < mixerParts.length
      && mixerParts.every((_, index) => trackPans[index] === (index === partIndex ? 100 : -100));
  }

  function updatePanHoldAppearance() {
    elements.mixer.querySelectorAll("[data-pan-index]").forEach((button) => {
      const index = Number(button.dataset.panIndex);
      const next = partPanIsSeparated(index) ? "center all parts" : "pan this part right and all others left";
      button.dataset.help = `Drag horizontally to adjust pan. Hold to ${next}. Shift+Enter does the same.`;
      button.title = `${mixerParts[index].name} pan. ${button.dataset.help} Right-click to reset this part.`;
    });
  }

  function togglePartPanSeparation(partIndex) {
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= mixerParts.length) return;
    const center = partPanIsSeparated(partIndex);
    trackPans = mixerParts.map((_, index) => center ? 0 : index === partIndex ? 100 : -100);
    panControls.forEach((control, index) => control.setValue(trackPans[index], false));
    engine?.updateMix(audibleTracks, trackVolumes, trackPans);
    updatePanHoldAppearance();
    savePreferences();
    showToast(center ? "All parts centered" : `${mixerParts[partIndex].name} right; other parts left`);
  }

  function applyPracticeMix(mode, { toggle = true, partIndex = practiceMixerIndex() } = {}) {
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= mixerParts.length) {
      (settingsSectionCollapsed("practice") ? settingsSections.get("practice").toggle : elements.practicePart).focus();
      showToast("Choose your part first");
      return;
    }
    if (toggle && practiceMixPartIndex === partIndex && activePracticeMix === mode && practiceMixUndo && restorePracticeMix()) {
      updateMixerAppearance();
      savePreferences();
      showToast("Previous mix restored");
      return;
    }
    if (!activePracticeMix || !practiceMixUndo) practiceMixUndo = snapshotPracticeMix();
    activePracticeMix = mode;
    practiceMixPartIndex = partIndex;
    audibleTracks.clear();
    mixerParts.forEach((_, index) => audibleTracks.add(index));
    trackVolumes = mixerParts.map((_, index) => {
      const value = mode === "check"
        ? index === partIndex ? 20 : 100
        : index === partIndex ? 100 : 20;
      volumeControls[index]?.setValue(value, false);
      return value;
    });
    updateMixerAppearance();
    savePreferences();
    const partName = mixerParts[partIndex].name;
    showToast(mode === "check" ? `${partName} reduced to 20%` : `${partName} emphasized; others at 20%`);
  }

  function setPracticePart(selected) {
    pitchCaptureWorker?.invalidate();
    pitchOctaveHistory = [];
    const mode = currentPracticeMix();
    const channel = mixerParts[selected];
    if (channel) practiceDivisi[channel.source] = channel.line;
    visibleChannels.clear();
    if (channel) visibleChannels.add(selected);
    syncPracticeFromSee();
    selectedScorePartIndex = null;
    if (mode && practicePartIndex !== null) {
      // Follow the new singer without replacing the pre-preset mix snapshot.
      applyPracticeMix(mode, { toggle: false });
    } else {
      if (mode) restorePracticeMix();
      else cancelPracticeMixSession();
      updateMixerAppearance();
      savePreferences();
    }
    renderPitchTrace();
    renderTakePanel();
  }

  // A chooser or part link isolates See to identify the singer, but leaves
  // Hear, Volume and Pan untouched, including an existing hold preset.
  function choosePracticePart(index, divisi) {
    if (!Number.isInteger(index) || index < 0 || index >= parts.length) return null;
    explicitPracticeChoice = true;
    const revealed = scoreView === "bars" && !visibleTracks.has(index);
    selectedScorePartIndex = null;
    if (divisi !== undefined) practiceDivisi[index] = divisi;
    visibleChannels.clear();
    const channel = mixerParts.findIndex(p => p.source === index && p.line === (practiceDivisi[index] ?? null));
    if (channel >= 0) visibleChannels.add(channel);
    else mixerParts.forEach((p, i) => { if (p.source === index) visibleChannels.add(i); });
    syncPracticeFromSee();
    practicePartPager?.setValue(practiceMixerIndex());
    updateMixerAppearance();
    updateNoteActionLabel();
    savePreferences();
    renderPitchTrace();
    renderTakePanel();
    scheduleRender();
    return { revealed };
  }

  function practicePartLabel(index) {
    const line = practiceDivisi[index] ?? null;
    return mixerParts.find(channel => channel.source === index && channel.line === line)?.name || parts[index].name;
  }

  function roleTraceKey(part) {
    return `${pitchTraceBaseKey}:part:${part}:line:${practiceDivisi[part] ?? "all"}`;
  }

  function assignPracticePart(index) {
    const nextKey = roleTraceKey(index);
    const changed = pitchTraceBaseKey && nextKey !== pitchTraceKey;
    if (changed) savePitchTraceNow();
    practicePartIndex = index;
    if (changed) {
      pitchTraceKey = nextKey;
      // A new practice part starts with a clean live trace. Saved takes remain
      // independently available through their Hear controls.
      pitchCaptureWorker?.invalidate();
      pitchOctaveHistory = [];
      pitchTraceLanes.clear();
      pitchTraceCount = 0;
      pitchTraceDirty.clear();
      if (takeState !== "off" || recordAudio || preparingCapture) void stopTakeRecording("", true, {discardShortTail: true});
    }
  }

  function partChooserAnswered() {
    try {
      return Boolean(partChooserKey && localStorage.getItem(partChooserKey));
    } catch {
      return false;
    }
  }

  function rememberPartChooser(answer) {
    try {
      if (partChooserKey) localStorage.setItem(partChooserKey, answer);
    } catch {
      // Device-local preferences are optional.
    }
  }

  function showPartChooser({ only = null, channels = null, note = "", title = "Which part do you sing?" } = {}) {
    if (mixerParts.length<2) return;
    elements.partChooserTitle.textContent = title;
    const choices = [...(channels || mixerParts.filter(part => !only || only.includes(part.source)))]
      .sort((a, b) => window.MeleteTakePitch.compareParts(a.short, b.short));
    elements.partChooserOptions.replaceChildren(...choices.map((part) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "part-chooser-option";
      button.dataset.partIndex = String(part.source);
      button.dataset.line = part.line === null ? "" : String(part.line);
      button.style.setProperty("--part-color", part.color);
      button.textContent = part.name;
      return button;
    }));
    elements.partChooserNote.textContent = note || "Hold a part in See to practise it.";
    elements.partChooser.hidden = false;
  }

  function hidePartChooser() {
    partChooserThen = null;
    if (elements.partChooser.hidden) return;
    const hadFocus = elements.partChooser.contains(document.activeElement);
    elements.partChooser.hidden = true;
    if (hadFocus) {
      const next = elements.mixer.querySelector("[data-visible-index]") || elements.settingsToggle;
      next.focus({ preventScroll: true });
    }
  }

  function dismissPartChooser() {
    if (pendingMixReceipt) finishMixReceipt(false);
    rememberPartChooser("dismissed");
    hidePartChooser();
  }

  let pendingMixReceipt=null;
  const mixHost=()=>window.frameElement?.hasAttribute("data-melete-collection-player") ? window.parent : window;
  function finishMixReceipt(applied) {
    if (!pendingMixReceipt) return;
    const h=mixHost().history;
    try {h.replaceState({...h.state,meleteMix:{signature:pendingMixReceipt,applied,guide:relativeGuide}}, "");} catch {}
    if(!applied){relativeMix=null;relativeGuide=null;}
    pendingMixReceipt=null;
  }
  function applyRelativeGuide(index,{enable=false}={}) {
    if (!relativeMix || !Number.isInteger(index) || index<0 || (!enable && relativeGuide===index)) return;
    if(!enable && currentPracticeMix()){relativeGuide=index;return;}
    cancelPracticeMixSession();
    const follow=!enable && Number.isInteger(relativeGuide),old=relativeGuide,vol=[...trackVolumes],pan=[...trackPans];
    const seats=relativeMix.layout==="choir" && window.MeletePracticeMix.project(mixerParts,index,relativeMix,sequence.practiceRoles).pans;
    mixerParts.forEach((_,i)=>{
      const other=i===old?index:i===index?old:i;
      const v=follow ? ("myVol" in relativeMix || "otherVol" in relativeMix ? vol[other] : undefined) : relativeMix[i===index?"myVol":"otherVol"];
      const p=seats ? seats[i] : follow ? ("myPan" in relativeMix || "otherPan" in relativeMix ? pan[other] : undefined) : relativeMix[i===index?"myPan":"otherPan"];
      if(v!==undefined) {trackVolumes[i]=v;volumeControls[i]?.setValue(v,false);}
      if(p!==undefined) {trackPans[i]=p;panControls[i]?.setValue(p,false);}
      if(enable) audibleTracks.add(i);
    });
    relativeGuide=index;
    if(follow){try{const h=mixHost().history;if(h.state?.meleteMix)h.replaceState({...h.state,meleteMix:{...h.state.meleteMix,guide:index}},"");}catch{}}
    updateMixerAppearance();savePreferences();
  }
  function openMixLink(detail) {
    const mix=window.MeletePracticeMix.read(detail);
    if (!mix || conductorMode) return false;
    const signature=JSON.stringify([takeSongKey(),mix]);
    const receipt=mixHost().history.state?.meleteMix;
    if(receipt?.signature===signature) {
      relativeMix=receipt.applied ? mix : null; relativeGuide=receipt.guide ?? lastGuideChannel;
      return true;
    }
    relativeMix=mix;relativeGuide=null;pendingMixReceipt=signature;
    const accept=()=>{applyRelativeGuide(practiceMixerIndex(),{enable:true});finishMixReceipt(true);};
    const named=detail.part!==undefined && (partsForLink(detail.part).length===1 || mixerParts.some(p=>partLinkKey(p.short)===partLinkKey(detail.part)));
    if(named && applyPartLink(detail) && elements.partChooser.hidden && practiceMixerIndex()!==null) accept();
    else if(mixerParts.length===1) {choosePracticePart(mixerParts[0].source,mixerParts[0].line);accept();}
    else {
      if(detail.part===undefined || !applyPartLink(detail) || elements.partChooser.hidden) showPartChooser();
      partChooserThen=accept;
    }
    return true;
  }
  const shareDialog=document.getElementById("shareMixDialog"), shareForm=shareDialog.querySelector("form");
  let sharingMix=null;
  function currentShareAddress(mix=sharingMix, publishedBase) {
    const range=engine?.hasLoop() ? loopTickRange() : null;
    return window.MeletePracticeMix.address(mixHost().location.href,mix,
      range && range.end!==null ? takeBoundaryLabel(range.start)+"-"+takeBoundaryLabel(range.end) : null,publishedBase);
  }
  async function copyRelativeLink() {
    const address=currentShareAddress();
    try {await navigator.clipboard.writeText(address);if(shareDialog.open)shareDialog.close();showToast("Practice link copied");}
    catch {const field=document.getElementById("shareMixUrl");field.value=address;field.hidden=false;
      if(!shareDialog.open)shareDialog.showModal();field.select();}
  }
  function sharePracticeMix() {
    if(!/^https?:$/.test(mixHost().location.protocol)){showToast("Open the hosted player to share a practice link.");return;}
    if(mixerParts.length===1 && lastGuideChannel===null)lastGuideChannel=0;
    const selected=practiceMixerIndex() ?? lastGuideChannel;
    if(selected===null || selected<0){showPartChooser({title:"Which part is your guide?"});partChooserThen=sharePracticeMix;return;}
    const capture=window.MeletePracticeMix.fromMixer(selected,trackVolumes,trackPans);
    if(relativeMix?.layout==="choir" && window.MeletePracticeMix.project(mixerParts,selected,relativeMix,sequence.practiceRoles).pans.every((v,i)=>v===trackPans[i])
        && trackVolumes.every((v,i)=>i===selected || v===capture.mix.otherVol)){
      sharingMix={layout:"choir",width:relativeMix.width,myVol:capture.mix.myVol,otherVol:capture.mix.otherVol};
      const fieldset=document.getElementById("shareBacking");fieldset.hidden=true;fieldset.disabled=true;
      void copyRelativeLink();return;
    }
    sharingMix=capture.mix;
    const fieldset=document.getElementById("shareBacking");fieldset.hidden=capture.uniform;fieldset.disabled=capture.uniform;
    document.getElementById("shareMixUrl").hidden=true;
    shareForm.elements.volume.value=sharingMix.otherVol;shareForm.elements.pan.value=sharingMix.otherPan;
    if(capture.uniform) void copyRelativeLink();else shareDialog.showModal();
  }
  const stationMixDialog=document.getElementById("stationMixDialog"), mixButton=document.getElementById("copyPracticeMix");
  let stationMixEditor;
  function setupMixLink() {
    if (!window.MeleteStation.requested() || conductorMode || config.audition?.enabled) return;
    mixButton.setAttribute("aria-label","Practice mix");mixButton.title="Practice mix";
    mixButton.dataset.help="Preview a station default or copy a choir link.";
    mixButton.setAttribute("aria-haspopup","dialog");mixButton.setAttribute("aria-controls","stationMixDialog");
  }
  mixButton.addEventListener("click",()=>{
    if (!mixButton.hasAttribute("aria-haspopup")) return sharePracticeMix();
    if (!ready || !mixerParts.length) return;
    if(takeState!=="off") {showToast("Stop recording to preview a mix.");return;}
    stationMixEditor ||= window.MeleteStationMixEditor.create({dialog:stationMixDialog,channels:mixerParts,
      roles:sequence.practiceRoles,compare:window.MeleteTakePitch.compareParts,drag:createDragNumber,pan:createPanRing,thumb:syncPillThumb,
      engine, guide:()=>practiceMixerIndex() ?? lastGuideChannel ?? 0,
      restore:saved=>{
        if(saved) compPanel?.refreshStationMix();
        engine.setPracticeDivisi(practicePartIndex,practiceDivisi[practicePartIndex]);engine.updateMix(audibleTracks,trackVolumes,trackPans);
      },
      address:mix=>currentShareAddress(mix,config.choirShareUrl)});
    stationMixEditor.open();
  });
  document.getElementById("closeShareMix").onclick=()=>shareDialog.close();
  shareForm.onsubmit=e=>{e.preventDefault();
    if(!document.getElementById("shareBacking").disabled){
      sharingMix.otherVol=shareForm.elements.volume.valueAsNumber;sharingMix.otherPan=shareForm.elements.pan.valueAsNumber;
    }
    void copyRelativeLink();};

  // Later fields win, so the hash overrides a ?part= query. Song names and
  // other fields are left for whoever owns them.
  function partLinkFields(...addresses) {
    const decode = (value) => {
      try {
        return decodeURIComponent(value.replace(/\+/gu, " "));
      } catch {
        return value;
      }
    };
    const fields = {};
    addresses.forEach((address) => String(address || "").replace(/^[#?]/u, "").split("&").forEach((token) => {
      const at = token.indexOf("=");
      if (at < 1) return;
      const key = decode(token.slice(0, at)).trim().toLowerCase();
      if (key === "part" || key === "div") fields[key] = decode(token.slice(at + 1)).trim();
    }));
    return fields;
  }

  const partLinkKey = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

  // Exact names, short names and ids first ("Alto 1", "A1"), then a unique
  // beginning ("sop"). Anything that still fits several parts is offered as a
  // choice rather than guessed between.
  function partsForLink(text) {
    const wanted = partLinkKey(text);
    if (!wanted) return [];
    const names = parts.map((part) => [part.name, part.short, part.id].map(partLinkKey).filter(Boolean));
    const exact = parts.filter((part) => names[part.index].includes(wanted));
    const matches = exact.length ? exact
      : parts.filter((part) => names[part.index].some((name) => name.startsWith(wanted)));
    return matches.map((part) => part.index);
  }

  function divisiForLink(index, text) {
    if (text === undefined || text === "") return { value: undefined };
    const wanted = partLinkKey(text).replace(/^div/u, "");
    if (wanted === "all") return { value: null };
    const line = /^\d+$/u.test(wanted) ? Number(wanted) - 1 : NaN;
    return practiceDivisiOptions(index).some((option) => option.value === line)
      ? { value: line } : { value: undefined, missing: text };
  }

  // Returns whether the link said anything about parts at all.
  function applyPartLink(link) {
    if (!link || (link.part === undefined && link.div === undefined)) return false;
    if (!parts.length) {
      pendingPartLink = link;
      return true;
    }
    const exactChannel = mixerParts.find(p => p.line !== null
      && [p.name, p.short].some(name => partLinkKey(name) === partLinkKey(link.part)));
    if (exactChannel) link = {...link, part: parts[exactChannel.source].name, div: String(exactChannel.line + 1)};
    if (link.part === undefined && !Number.isInteger(practicePartIndex)) return false;
    const matches = link.part === undefined ? [practicePartIndex] : partsForLink(link.part);
    if (matches.length !== 1) {
      const quoted = `“${link.part}”`;
      if (matches.length) {
        showPartChooser({ only: matches, note: `The link’s ${quoted} could be ${matches.length === 2 ? "either" : "any"} of these.` });
      }
      else if (!Number.isInteger(practicePartIndex)) showPartChooser({ note: `This song has no part called ${quoted}.` });
      else showToast(`This song has no part called ${quoted}; still practising ${practicePartLabel(practicePartIndex)}`);
      return true;
    }
    const index = matches[0];
    const divisi = divisiForLink(index, link.div);
    const before = { part: practicePartIndex, divisi: [...practiceDivisi], visible: [...visibleTracks] };
    const { revealed } = choosePracticePart(index, divisi.value);
    rememberPartChooser("chosen");
    hidePartChooser();
    const changed = before.part !== index || before.divisi[index] !== practiceDivisi[index];
    const undo = changed && Number.isInteger(before.part) ? () => {
      practiceDivisi = before.divisi;
      visibleTracks.clear();
      before.visible.forEach((part) => visibleTracks.add(part));
      choosePracticePart(before.part);
      showToast(`Practising ${practicePartLabel(before.part)}`);
    } : null;
    const label = practicePartLabel(index);
    const message = divisi.missing ? `${parts[index].name} has no Div ${divisi.missing}; practising ${label}`
      : `Practising ${label}${Number.isInteger(before.part) && changed ? " from the link" : ""}`;
    showToast(`${message}${revealed ? " (shown in pitchbar view)" : ""}`, "", undo);
    return true;
  }

  // A link is followed once. Afterwards the remembered choice speaks for
  // itself, so a reload or bookmark cannot undo a later change of part.
  function consumePartLink() {
    try {
      const address = new URL(window.location.href);
      const keep = (text) => text.replace(/^[#?]/u, "").split("&")
        .filter((token) => token && !/^(part|div)=/iu.test(token)).join("&");
      address.search = keep(address.search);
      address.hash = keep(address.hash);
      window.history.replaceState(window.history.state, "", address.href);
    } catch {
      // An opaque or read-only address keeps its link; nothing depends on it.
    }
  }

  elements.partChooserOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-part-index]");
    if (!button) return;
    const index = Number(button.dataset.partIndex);
    const chosen = choosePracticePart(index, button.dataset.line === "" ? null : Number(button.dataset.line));
    if (!chosen) return;
    const then = partChooserThen;
    rememberPartChooser("chosen");
    hidePartChooser();
    then?.();
    showToast(`Practising ${practicePartLabel(index)}${chosen.revealed ? " (shown in pitchbar view)" : ""}`);
    // Choosing is the natural moment to learn that holding the part's number
    // brings it forward. The tip waits for the mixer to be on screen.
    queueShortcutTip(shortcutHints.hold("vol", practiceMixerIndex(), event.detail === 0 ? "keyboard" : "touch"));
  });
  elements.partChooserDismiss.addEventListener("click", dismissPartChooser);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || stationMixDialog.open || elements.partChooser.hidden || event.defaultPrevented) return;
    if (isTextEntryTarget(event.target) && !elements.partChooser.contains(event.target)) return;
    // Settings stay open; a second Escape reaches them.
    event.preventDefault();
    dismissPartChooser();
  });
  // A collection owns its own address and forwards the part fields it found
  // there, so the parts of this song decide what the name means.
  const linkedLoopState = () => [loopEnabled, loopStartMeasure, loopEndMeasure, loopStartTick, loopEndTick].join(":");
  function clearEditedLinkFields() {
    const stale = [];
    if ("part" in linkedPracticeState && linkedPracticeState.part !== practiceMixerIndex()) {
      delete linkedPracticeState.part;
      stale.push("part", "div");
    }
    if ("loop" in linkedPracticeState && linkedPracticeState.loop !== linkedLoopState()) {
      delete linkedPracticeState.loop;
      stale.push("loop");
    }
    if (!Object.keys(linkedPracticeState).length) linkedPracticeState = null;
    if (stale.length) document.dispatchEvent(new CustomEvent("melete:link-edited", {detail: stale}));
  }
  document.addEventListener("melete:deep-link", (event) => {
    const detail = event.detail || {};
    const field = (value) => typeof value === "string" ? value : undefined;
    linkedPracticeState = null;
    const shared = openMixLink(detail);
    const part = shared ? detail.part!==undefined : applyPartLink({ part: field(detail.part), div: field(detail.div) });
    const loop = applyLoopLink(field(detail.loop));
    // A shared passage remains copyable until edited. Clearing a loop or
    // undoing a part choice must not resurrect it the next time the page loads.
    if (part || loop) linkedPracticeState = {
      ...(part ? {part: practiceMixerIndex()} : {}), ...(loop ? {loop: linkedLoopState()} : {}),
    };
    if (detail.loop !== undefined && !loop) document.dispatchEvent(new CustomEvent("melete:link-edited", {detail:["loop"]}));
  });
  window.addEventListener("hashchange", () => {
    const link = partLinkFields(window.location.hash);
    if (link.part !== undefined || link.div !== undefined) {
      consumePartLink();
      applyPartLink(link);
    }
    const loop = loopLinkValue(window.location.hash);
    if (loop !== undefined) {
      consumeLoopLink();
      applyLoopLink(loop);
    }
  });

  function restoreVisibleChannels(state) {
    visibleChannels.clear();
    if (Array.isArray(state.visibleChannels) && state.visibleChannels.length === mixerParts.length) {
      state.visibleChannels.forEach((on, i) => { if (on) visibleChannels.add(i); });
    } else mixerParts.forEach((p, i) => {
      if (visibleTracks.has(p.source) && (visibleTracks.size !== 1 || p.source !== state.practicePart
        || p.line === (state.practiceDivisi?.[p.source] ?? p.line))) visibleChannels.add(i);
    });
  }

  function syncPracticeFromSee() {
    visibleTracks.clear();
    for (const i of visibleChannels) visibleTracks.add(mixerParts[i].source);
    const channel = visibleChannels.size === 1 ? mixerParts[[...visibleChannels][0]] : null;
    if (channel) lastGuideChannel=[...visibleChannels][0];
    if (channel) practiceDivisi[channel.source] = channel.line;
    assignPracticePart(channel?.source ?? null);
  }

  function updateMixerAppearance() {
    elements.mixer.querySelectorAll("[data-visible-index]").forEach((button) => {
      const index = Number(button.dataset.visibleIndex);
      const visible = visibleChannels.has(index);
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", `${mixerParts[index].name} notation ${visible ? "shown" : "hidden"}`);
      button.dataset.help = `${visible ? "Hide" : "Show"} ${mixerParts[index].name}; hold to practise this part.`;
    });
    elements.mixer.querySelectorAll("[data-audio-index]").forEach((button) => {
      const index = Number(button.dataset.audioIndex);
      const audible = audibleTracks.has(index);
      button.setAttribute("aria-pressed", String(audible));
      button.setAttribute("aria-label", `${mixerParts[index].name} audio ${audible ? "on" : "off"}`);
      button.dataset.help = audible ? `Silence ${mixerParts[index].name}.` : `Hear ${mixerParts[index].name}.`;
    });
    engine?.updateMix(audibleTracks, trackVolumes, trackPans);
    updatePracticeMixAppearance();
    updatePanHoldAppearance();
  }

  function setTrackVisibility(index, visible) {
    if (visible) visibleChannels.add(index);
    else visibleChannels.delete(index);
    syncPracticeFromSee();
    updateMixerAppearance();
    updateNoteActionLabel();
    savePreferences();
    scheduleRender();
    renderTakePanel();
  }

  function setTrackAudible(index, audible) {
    cancelPracticeMixSession();
    if (audible) audibleTracks.add(index);
    else audibleTracks.delete(index);
    updateMixerAppearance();
    savePreferences();
  }

  function aloneOnItsRow(row, partCount) {
    return Array.from({ length: partCount }, (_, part) => part)
      .every((part) => row.on(part) === (part === row.index || part === row.required));
  }

  function turnOnEveryPart(row, partCount) {
    for (let part = 0; part < partCount; part += 1) row.set(part, true);
  }

  function soloRow(row, partCount) {
    if (aloneOnItsRow(row, partCount)) return turnOnEveryPart(row, partCount);
    // The kept part goes on first: a row is not allowed to empty, so turning
    // the others off around a part that is itself off would be refused.
    row.set(row.index, true);
    for (let part = 0; part < partCount; part += 1) if (part !== row.index) row.set(part, false);
  }

  function pressRow(row, partCount) {
    row.set(row.index, !row.on(row.index));
  }

  // Press a part to toggle it, hold to leave only that part on — the gesture
  // Chordus uses on its clefs. The two rows are independent: soloing what you
  // can see never changes what you can hear. Holding the last part still
  // standing puts the others back. A plain press can turn the last part off.
  // Dragging across the Hear row still paints it.
  function attachMixerGestures() {
    const rowAt = (cell) => {
      if (cell?.dataset.visibleIndex !== undefined) {
        return { name: "see", count: mixerParts.length, index: Number(cell.dataset.visibleIndex), selector: "[data-visible-index]",
          key: "visibleIndex", on: (part) => visibleChannels.has(part), set: setTrackVisibility, paints: false };
      }
      if (cell?.dataset.audioIndex !== undefined) {
        return { name: "hear", count: mixerParts.length, index: Number(cell.dataset.audioIndex), selector: "[data-audio-index]",
          key: "audioIndex", on: (part) => audibleTracks.has(part), set: setTrackAudible, paints: true };
      }
      return null;
    };
    const press = (row, input) => {
      const before = Array.from({length: row.count}, (_, index) => row.on(index));
      pressRow(row, row.count);
      queueShortcutTip(shortcutHints.toggle(row.name, row.index, before,
        Array.from({length: row.count}, (_, index) => row.on(index)), input));
    };
    let gesture = null;
    const clear = () => {
      if (!gesture) return;
      window.clearTimeout(gesture.timer);
      const { pointerId } = gesture;
      gesture = null;
      if (elements.mixer.hasPointerCapture(pointerId)) elements.mixer.releasePointerCapture(pointerId);
    };
    elements.mixer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const row = rowAt(event.target.closest("[data-visible-index], [data-audio-index]"));
      if (!row) return;
      clear();
      gesture = { row, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        held: false, painting: false, painted: row.index, target: false };
      try { elements.mixer.setPointerCapture(event.pointerId); } catch {}
      gesture.timer = window.setTimeout(() => {
        if (!gesture) return;
        gesture.held = true;
        learnShortcut("isolate");
        soloRow(gesture.row, gesture.row.count);
        if(gesture.row.name==="see" && visibleChannels.size===1) applyRelativeGuide(practiceMixerIndex());
      }, MIXER_SOLO_HOLD_MS);
      event.preventDefault();
    });
    elements.mixer.addEventListener("pointermove", (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId || gesture.held) return;
      if (!gesture.painting && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 10) return;
      window.clearTimeout(gesture.timer);
      const { row } = gesture;
      if (!row.paints) { clear(); return; }
      if (!gesture.painting) {
        gesture.painting = true;
        gesture.target = !row.on(row.index);
        row.set(row.index, gesture.target);
      }
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest(row.selector);
      const part = cell && elements.mixer.contains(cell) ? Number(cell.dataset[row.key]) : null;
      if (part === null || Number.isNaN(part) || part === gesture.painted) return;
      gesture.painted = part;
      row.set(part, gesture.target);
    });
    elements.mixer.addEventListener("pointerup", (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const { row, held, painting } = gesture;
      clear();
      if (!held && !painting) press(row, event.pointerType);
    });
    elements.mixer.addEventListener("pointercancel", clear);
    elements.mixer.addEventListener("lostpointercapture", clear);

    // Keyboard and assistive tech reach both actions through the button
    // itself, where a synthetic click carries no pointer detail.
    elements.mixer.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      const row = rowAt(event.target.closest("[data-visible-index], [data-audio-index]"));
      if (!row) return;
      if (event.shiftKey) {
        learnShortcut("isolate");
        soloRow(row, row.count);
        if(row.name==="see" && visibleChannels.size===1) applyRelativeGuide(practiceMixerIndex());
      } else press(row, "keyboard");
    });
  }

  function appendMixerLabel(text, mutate) {
    const label = document.createElement("span");
    label.className = "mixer-row-label";
    label.textContent = text;
    label.dataset.mixerRow = text.toLowerCase();
    elements.mixer.append(label);
    registerResetTarget(label, text, mutate, { labelTarget: true });
    return label;
  }

  // Always measure from the drag's starting mix so reversing restores it.
  // Independent clamping preserves each part's original saturation point.
  function attachGroupDrag(label, controls, values, pixelsPerStep, { horizontal = false, clampIndividually = false } = {}) {
    const along = (event) => horizontal ? event.clientX : -event.clientY;
    const indicesNow = () => controls.map((control) => values.indexOf(nearestAllowed(control.value(), values)));
    const shift = (startIndices, steps) => {
      if (startIndices.some((index) => index < 0)) return;
      const room = clampIndividually ? steps
        : clamp(steps, -Math.min(...startIndices), values.length - 1 - Math.max(...startIndices));
      controls.forEach((control, part) => control.setValue(values[clamp(startIndices[part] + room, 0, values.length - 1)]));
    };

    let pointerId = null;
    let startPoint = 0;
    let startIndices = [];
    label.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !controls.length) return;
      pointerId = event.pointerId;
      startPoint = along(event);
      startIndices = indicesNow();
      try { label.setPointerCapture(pointerId); } catch {}
      event.preventDefault();
    });
    label.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId || !label.hasPointerCapture(pointerId)) return;
      shift(startIndices, Math.round((along(event) - startPoint) / pixelsPerStep));
    });
    const release = (event) => {
      if (event.pointerId !== pointerId) return;
      if (label.hasPointerCapture(pointerId)) label.releasePointerCapture(pointerId);
      pointerId = null;
    };
    label.addEventListener("pointerup", release);
    label.addEventListener("pointercancel", release);
    label.addEventListener("lostpointercapture", () => { pointerId = null; });
    label.addEventListener("keydown", (event) => {
      const steps = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1
        : ["ArrowDown", "ArrowLeft"].includes(event.key) ? -1 : 0;
      if (!steps) return;
      shift(indicesNow(), steps);
      event.preventDefault();
    });
  }

  function buildMixer() {
    elements.mixer.innerHTML = "";
    elements.mixer.removeAttribute("aria-busy");
    elements.mixer.style.setProperty("--part-count", String(mixerParts.length + (referencePlayer ? 1 : 0)));
    volumeControls.length = 0;
    panControls.length = 0;
    const ordered = mixerParts.map((part, index) => ({part, index}))
      .sort((a, b) => window.MeleteTakePitch.compareParts(a.part.short, b.part.short));

    appendMixerLabel("See", (state) => { state.visibleChannels = mixerParts.map(() => true); });
    ordered.forEach(({part, index}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "part-heading";
      button.classList.toggle("long-part-label",part.short.length>5);
      button.style.setProperty("--part-color", part.color);
      button.dataset.visibleIndex = String(index);
      button.textContent = part.short;
      button.setAttribute("aria-label", `${part.name} notation`);
      button.dataset.help = `Show ${part.name}; hold for only this part.`;
      registerResetTarget(button, `${part.name} notation`, (state) => { state.visibleChannels[index] = true; },
        { holdToReset: false });
      elements.mixer.append(button);
    });

    referencePlayer?.mount('See', elements.mixer);

    appendMixerLabel("Hear", (state) => {
      state.audible = mixerParts.map(() => true);
      state.practiceMixMode = null;
      state.practiceMixUndo = null;
    });
    ordered.forEach(({part, index}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "matrix-cell";
      button.style.setProperty("--part-color", part.color);
      button.dataset.audioIndex = String(index);
      button.setAttribute("aria-label", `${part.name} audio`);
      button.dataset.help = `Hear ${part.name}; hold for only this part.`;
      registerResetTarget(button, `${part.name} audio`, (state) => {
        state.audible[index] = true;
        state.practiceMixMode = null;
        state.practiceMixUndo = null;
      }, { holdToReset: false });
      elements.mixer.append(button);
    });

    referencePlayer?.mount('Hear', elements.mixer);

    const volumeLabel = appendMixerLabel("Vol", (state, defaults) => {
      state.volumes = [...defaults.volumes];
      state.practiceMixMode = null;
      state.practiceMixUndo = null;
    });
    volumeLabel.classList.add("is-group-drag");
    volumeLabel.dataset.help = "Drag vertically to change every part.";
    volumeLabel.setAttribute("aria-label", "All part volumes");
    ordered.forEach(({part, index}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "drag-number";
      button.dataset.value = String(trackVolumes[index]);
      button.dataset.volumeIndex = String(index);
      button.style.setProperty("--part-color", part.color);
      button.setAttribute("aria-keyshortcuts", "Shift+Enter");
      button.dataset.help = `${part.name} volume: drag vertically.`;
      button.setAttribute("aria-label", `${part.name} volume`);
      elements.mixer.append(button);
      const control = createDragNumber(button, {
        values: VOLUME_VALUES,
        clickStep: 10,
        defaultValue: () => preferenceDefaults().volumes[index],
        format: (value) => `${value}%`,
        aria: (value) => `${part.name} volume ${value} percent`,
        pixelsPerStep: 4,
        onHold: () => {
          learnShortcut("vol-hold");
          cyclePartVolumeMix(index);
        },
        onManualChange: (before, after, input) => queueShortcutTip(shortcutHints.adjust(
          "vol", index, before, after, preferenceDefaults().volumes[index], input)
          || shortcutHints.hold("vol", index, input)),
      });
      button.addEventListener("input", () => {
        cancelPracticeMixSession();
        trackVolumes[index] = control.value();
        engine?.updateMix(audibleTracks, trackVolumes, trackPans);
        updatePracticeMixAppearance();
        savePreferences();
      });
      registerResetTarget(button, `${part.name} volume`, (state, defaults) => {
        state.volumes[index] = defaults.volumes[index];
        state.practiceMixMode = null;
        state.practiceMixUndo = null;
      }, { holdToReset: false });
      volumeControls[index] = control;
    });
    attachGroupDrag(volumeLabel, volumeControls, VOLUME_VALUES, 4, { clampIndividually: true });
    referencePlayer?.mount('Vol', elements.mixer);

    const panLabel = appendMixerLabel("Pan", (state, defaults) => { state.pans = [...defaults.pans]; });
    panLabel.classList.add("is-group-drag", "is-horizontal");
    panLabel.dataset.help = "Drag horizontally to pan every part.";
    panLabel.setAttribute("aria-label", "All part pans");
    ordered.forEach(({part, index}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pan-ring";
      button.style.setProperty("--part-color", part.color);
      button.dataset.value = String(trackPans[index]);
      button.dataset.panIndex = String(index);
      button.setAttribute("aria-keyshortcuts", "Shift+Enter");
      button.setAttribute("aria-label", `${part.name} stereo pan`);
      const ring = document.createElement("span");
      ring.className = "pan-arc";
      ring.setAttribute("aria-hidden", "true");
      const cap = document.createElement("span");
      cap.className = "pan-cap";
      const indicator = document.createElement("span");
      indicator.className = "pan-indicator";
      cap.append(indicator);
      ring.append(cap);
      button.append(ring);
      elements.mixer.append(button);
      const control = createPanRing(button, {
        name: part.name, defaultValue: () => preferenceDefaults().pans[index],
        onHold: () => {
          learnShortcut("pan-hold");
          togglePartPanSeparation(index);
        },
        onManualChange: (before, after, input) => queueShortcutTip(shortcutHints.adjust(
          "pan", index, before, after, preferenceDefaults().pans[index], input)
          || shortcutHints.hold("pan", index, input)),
      });
      button.addEventListener("input", () => {
        trackPans[index] = control.value();
        engine?.updateMix(audibleTracks, trackVolumes, trackPans);
        updatePanHoldAppearance();
        savePreferences();
      });
      registerResetTarget(button, `${part.name} pan`, (state, defaults) => { state.pans[index] = defaults.pans[index]; },
        { holdToReset: false });
      panControls[index] = control;
    });
    // Same feel as a pan dial's own drag, which also steps every four pixels.
    attachGroupDrag(panLabel, panControls, PAN_VALUES, 4, { horizontal: true, clampIndividually: true });
    referencePlayer?.mount('Pan', elements.mixer);

    updateMixerAppearance();
  }

  function loadAnnotations() {
    annotations.clear();
    try {
      const adopted = storedValueFor(annotationKey, legacyAnnotationKeys);
      let source = adopted ? { key: annotationKey, value: adopted } : null;
      if (!source) {
        const embeddedAnnotations = portableStateForCurrentScore()?.annotations;
        if (embeddedAnnotations && typeof embeddedAnnotations === "object" && !Array.isArray(embeddedAnnotations)) {
          source = { key: "portable-state", value: JSON.stringify(embeddedAnnotations) };
        }
      }
      const stored = JSON.parse(source?.value || "null");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
      const fallbackPartIndex = currentScorePartIndex();
      if (stored.version === 3 && Array.isArray(stored.items)) {
        stored.items.forEach((item) => {
          const tick = Math.round(Number(item?.tick));
          const partIndex = Number.isInteger(Number(item?.partIndex)) ? Number(item.partIndex) : fallbackPartIndex;
          const text = typeof item?.text === "string" ? item.text.trim().slice(0, 500) : "";
          if (Number.isFinite(tick) && tick >= 0 && tick < sequence.endTick && partIndex >= 0 && partIndex < parts.length && text) {
            annotations.set(annotationId(tick, partIndex), { tick, partIndex, text });
          }
        });
        if (source?.key !== annotationKey) saveAnnotations();
        return;
      }
      if (stored.version === 2 && Array.isArray(stored.items)) {
        stored.items.forEach((item) => {
          const tick = Math.round(Number(item?.tick));
          const note = typeof item?.text === "string" ? item.text.trim().slice(0, 500) : "";
          if (Number.isFinite(tick) && tick >= 0 && tick < sequence.endTick && note) {
            annotations.set(annotationId(tick, fallbackPartIndex), { tick, partIndex: fallbackPartIndex, text: note });
          }
        });
        if (annotations.size) saveAnnotations();
        return;
      }
      // Migrate the original measure-indexed note format to measure starts.
      Object.entries(stored).forEach(([measure, text]) => {
        const index = Number(measure);
        const note = typeof text === "string" ? text.trim().slice(0, 500) : "";
        const tick = sequence.measures[index]?.[0];
        if (Number.isInteger(index) && Number.isFinite(tick) && note) {
          annotations.set(annotationId(tick, fallbackPartIndex), { tick, partIndex: fallbackPartIndex, text: note });
        }
      });
      if (annotations.size) saveAnnotations();
    } catch {
      // Score notes are optional device-local state.
    }
  }

  function currentAnnotationState() {
    return {
      version: 3,
      items: [...annotations.values()]
        .sort((left, right) => left.tick - right.tick || left.partIndex - right.partIndex)
        .map(({ tick, partIndex, text }) => ({ tick, partIndex, text })),
    };
  }

  function saveAnnotations() {
    try {
      localStorage.setItem(annotationKey, JSON.stringify(currentAnnotationState()));
    } catch {
      showToast("This browser could not save the annotation", "error");
    }
  }

  function annotationId(tick, partIndex) {
    return `${partIndex}:${tick}`;
  }

  function scoreLocationAtTick(value) {
    const tick = clamp(Math.round(Number(value) || 0), 0, Math.max(0, sequence.endTick - 1));
    const measureIndex = measureIndexAtTick(tick);
    const [start, duration, rawBeats = 4, rawBeatType = 4] = sequence.measures[measureIndex];
    const beats = Math.max(1, Math.round(Number(rawBeats) || 4));
    const beatType = Math.max(1, Number(rawBeatType) || 4);
    const division = Math.max(1, Number(sequence.division) || 1);
    const nominalBeatDuration = division * 4 / beatType;
    const beatDuration = Number.isFinite(nominalBeatDuration) && nominalBeatDuration > 0
      ? nominalBeatDuration
      : Math.max(1, duration / beats);
    const offset = clamp(tick - start, 0, Math.max(0, duration - 1));
    const beatZeroIndex = clamp(Math.floor(offset / beatDuration), 0, beats - 1);
    const beatFraction = clamp((offset - beatZeroIndex * beatDuration) / beatDuration, 0, 0.999999);
    const thousandths = Math.min(999, Math.round(beatFraction * 1000));
    const fractionDigits = String(thousandths).padStart(3, "0").replace(/0+$/u, "") || "0";
    return `${measureIndex + 1}.${beatZeroIndex + 1}.${fractionDigits}`;
  }

  function currentScoreTick() {
    const playbackTick = engine ? engine.tickAtSeconds(engine.currentSeconds()) : 0;
    if (Number.isFinite(selectedScoreTick) && Math.abs(playbackTick - selectedScoreTick) <= 1) return selectedScoreTick;
    return clamp(Math.round(playbackTick), 0, Math.max(0, sequence.endTick - 1));
  }

  function takeBoundaryLabel(tick) {
    return window.MeleteTakePitch.measureAddress(tick, sequence.measures, sequence.division);
  }

  function currentScorePartIndex() {
    if (Number.isInteger(selectedScorePartIndex) && visibleTracks.has(selectedScorePartIndex)) return selectedScorePartIndex;
    if (Number.isInteger(practicePartIndex) && visibleTracks.has(practicePartIndex)) return practicePartIndex;
    return [...visibleTracks][0] ?? 0;
  }

  function updateNoteActionLabel() {
    const unavailable = scoreView === "bars";
    elements.noteMode.disabled = unavailable;
    if (unavailable) {
      elements.noteMode.setAttribute("aria-label", "Annotate is available in standard notation");
      elements.noteMode.dataset.help = "Available only in standard notation.";
      return;
    }
    if (!parts.length || !sequence?.measures?.length) return;
    const partIndex = currentScorePartIndex();
    const location = scoreLocationAtTick(currentScoreTick());
    const description = `${parts[partIndex]?.name || `Part ${partIndex + 1}`} at measure ${location}`;
    elements.noteMode.setAttribute("aria-label", `Add annotation for ${description}`);
    elements.noteMode.dataset.help = `Annotate ${parts[partIndex]?.name || `Part ${partIndex + 1}`} at ${location}.`;
  }

  function startInlineNoteEdit(scoreTick, scorePartIndex) {
    const tick = Math.round(Number(scoreTick));
    const partIndex = Number(scorePartIndex);
    if (!Number.isFinite(tick) || tick < 0 || tick >= sequence.endTick || !Number.isInteger(partIndex) || partIndex < 0 || partIndex >= parts.length) return;
    if (editingAnnotation) commitInlineNoteEdit();
    const id = annotationId(tick, partIndex);
    const existing = annotations.get(id);
    editingAnnotation = {
      id,
      tick,
      partIndex,
      draft: existing?.text || "",
      focusRequested: true,
    };
    renderAnnotations();
  }

  function commitInlineNoteEdit(cancel = false) {
    if (!editingAnnotation) return;
    const { id, tick, partIndex, draft } = editingAnnotation;
    const text = String(draft || "").trim().slice(0, 500);
    editingAnnotation = null;
    if (!cancel) {
      if (text) annotations.set(id, { tick, partIndex, text });
      else annotations.delete(id);
      saveAnnotations();
    }
    renderAnnotations();
  }

  function deleteAnnotation(tick, partIndex) {
    const id = annotationId(tick, partIndex);
    const deleted = annotations.get(id);
    if (!deleted) return;
    annotations.delete(id);
    saveAnnotations();
    renderAnnotations();
    const location = scoreLocationAtTick(tick);
    showToast(`Annotation at ${location} deleted`, "", () => {
      annotations.set(id, deleted);
      saveAnnotations();
      renderAnnotations();
      showToast(`Annotation at ${location} restored`);
    });
  }

  function resizeInlineNoteEditor(editor) {
    const lineCount = Math.max(1, String(editor.value || "").split(/\r\n?|\n/u).length);
    const computed = getComputedStyle(editor);
    const fontSize = Number.parseFloat(computed.fontSize) || 10;
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.3;
    editor.style.height = `${Math.max(13, Math.ceil(lineCount * lineHeight))}px`;
  }

  function renderSectionGuides() {
    elements.score.querySelectorAll('[data-section-measure="true"]').forEach((label) => {
      label.removeAttribute("data-section-measure");
    });
    if (!api || !sequence?.measures?.length) return;
    const chapterMeasures = new Set(autoChapters()
      .filter((chapter) => Number.isFinite(chapter.tick) && chapter.tick >= 0 && chapter.tick < sequence.endTick)
      .filter((chapter, index, all) => index === 0 || chapter.tick > all[index - 1].tick)
      .map((chapter) => measureIndexAtTick(chapter.tick) + 1));
    if (!chapterMeasures.size) return;

    // AlphaTab emits bar numbers as red Arial text nodes. Mark the existing
    // number instead of drawing a competing chapter line or duplicate label.
    elements.score.querySelectorAll(".at-surface-svg text").forEach((label) => {
      const text = label.textContent?.trim() || "";
      if (!/^\d+$/u.test(text)) return;
      const measure = Number(text);
      const fill = (label.getAttribute("fill") || "").toLowerCase();
      if (chapterMeasures.has(measure) && fill === "#c80000") {
        label.setAttribute("data-section-measure", "true");
      }
    });
  }

  function scheduleSectionGuides() {
    const generation = ++sectionGuideGeneration;
    let frame = 0;
    const markAfterPaint = () => {
      if (generation !== sectionGuideGeneration) return;
      renderSectionGuides();
      frame += 1;
      // AlphaTab can replace its SVG surfaces for several frames after
      // renderFinished, so reapply the lightweight text attributes until the
      // final surface is attached.
      if (frame < 8) requestAnimationFrame(markAfterPaint);
    };
    requestAnimationFrame(markAfterPaint);
  }

  function partIndexForTrack(track) {
    const identityIndex = scoreTracks.indexOf(track);
    if (identityIndex >= 0) return identityIndex;
    const modelIndex = Number(track?.index);
    return scoreTracks.findIndex((candidate) => Number(candidate?.index) === modelIndex);
  }

  function barBoundsForPart(masterBounds, partIndex) {
    return [...(masterBounds?.bars || [])].find((bounds) => partIndexForTrack(bounds?.bar?.staff?.track) === partIndex) || null;
  }

  function renderSelectedPartHighlight() {
    const existing = elements.score.querySelector(".score-selected-part");
    if (scoreView !== "standard" || !api || !Number.isInteger(selectedScorePartIndex)
      || !visibleTracks.has(selectedScorePartIndex) || !sequence?.measures?.length) {
      existing?.remove();
      return;
    }
    const tick = currentScoreTick();
    const measureIndex = measureIndexAtTick(tick);
    const lookup = api.boundsLookup || api.renderer?.boundsLookup;
    const masterBounds = lookup?.findMasterBarByIndex?.(measureIndex);
    const staffBounds = barBoundsForPart(masterBounds, selectedScorePartIndex);
    const box = staffBounds?.realBounds || staffBounds?.visualBounds;
    const x = Number(box?.x);
    const y = Number(box?.y);
    const width = Number(box?.w);
    const height = Number(box?.h);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    const geometry = [x, y, width, height].map((value) => value.toFixed(3)).join("|");
    if (existing?.dataset.measureIndex === String(measureIndex)
      && existing.dataset.partIndex === String(selectedScorePartIndex)) {
      if (existing.dataset.geometry === geometry) return;
      existing.dataset.geometry = geometry;
      existing.style.left = `${x}px`;
      existing.style.top = `${y}px`;
      existing.style.width = `${width}px`;
      existing.style.height = `${height}px`;
      return;
    }
    existing?.remove();
    const highlight = document.createElement("div");
    highlight.className = "score-selected-part";
    highlight.dataset.measureIndex = String(measureIndex);
    highlight.dataset.partIndex = String(selectedScorePartIndex);
    highlight.dataset.geometry = geometry;
    highlight.style.setProperty("--part-color", parts[selectedScorePartIndex]?.color || partPaint(selectedScorePartIndex));
    highlight.style.left = `${x}px`;
    highlight.style.top = `${y}px`;
    highlight.style.width = `${width}px`;
    highlight.style.height = `${height}px`;
    elements.score.append(highlight);
  }

  function nearestPartIndexAtScoreY(measureIndex, scoreY, fallbackPartIndex) {
    const lookup = api?.boundsLookup || api?.renderer?.boundsLookup;
    const masterBounds = lookup?.findMasterBarByIndex?.(measureIndex);
    const candidates = [...(masterBounds?.bars || [])].map((bounds) => {
      const partIndex = partIndexForTrack(bounds?.bar?.staff?.track);
      const box = bounds?.realBounds || bounds?.visualBounds;
      const top = Number(box?.y);
      const height = Number(box?.h);
      if (!visibleTracks.has(partIndex) || !Number.isFinite(top) || !Number.isFinite(height)) return null;
      const bottom = top + height;
      const distance = scoreY < top ? top - scoreY : scoreY > bottom ? scoreY - bottom : 0;
      return { partIndex, distance, centerDistance: Math.abs(scoreY - (top + bottom) / 2) };
    }).filter(Boolean).sort((left, right) => left.distance - right.distance || left.centerDistance - right.centerDistance);
    return candidates[0]?.partIndex ?? (visibleTracks.has(fallbackPartIndex) ? fallbackPartIndex : currentScorePartIndex());
  }

  function scoreNoteBoxWidth(text, location) {
    const canvas = scoreNoteBoxWidth.canvas || (scoreNoteBoxWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    if (!context) return Math.max(120, 68 + String(text || "").length * 6);
    context.font = "650 10px Inter, ui-sans-serif, system-ui, sans-serif";
    const lines = String(text || "").split(/\r\n?|\n/u);
    const textWidth = Math.max(8, ...lines.map((line) => context.measureText(line || " ").width));
    const addressWidth = context.measureText(String(location || "1.1.0")).width;
    // 12px box padding + 18px delete button + two 5px flex gaps.
    return Math.max(120, Math.ceil(40 + addressWidth + textWidth + 3));
  }

  function standardScoreTargetAtClientPoint(clientX, clientY, fallbackPartIndex) {
    const lookup = api?.boundsLookup || api?.renderer?.boundsLookup;
    if (!lookup?.findMasterBarByIndex || !sequence?.measures?.length) return null;
    const scoreBounds = elements.score.getBoundingClientRect();
    const scoreX = clientX - scoreBounds.left + elements.score.scrollLeft;
    const scoreY = clientY - scoreBounds.top + elements.score.scrollTop;
    const candidates = sequence.measures.map((_, measureIndex) => {
      const masterBounds = lookup.findMasterBarByIndex(measureIndex);
      const box = masterBounds?.realBounds || masterBounds?.visualBounds || masterBounds?.lineAlignedBounds;
      const x = Number(box?.x);
      const y = Number(box?.y);
      const width = Number(box?.w);
      const height = Number(box?.h);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
      const horizontalDistance = scoreX < x ? x - scoreX : scoreX > x + width ? scoreX - x - width : 0;
      const verticalDistance = scoreY < y ? y - scoreY : scoreY > y + height ? scoreY - y - height : 0;
      return {
        measureIndex, x, width, masterBounds,
        distance: horizontalDistance * horizontalDistance + verticalDistance * verticalDistance,
        centerDistance: Math.abs(scoreY - (y + height / 2)),
      };
    }).filter(Boolean).sort((left, right) => left.distance - right.distance || left.centerDistance - right.centerDistance);
    const target = candidates[0];
    if (!target) return null;
    const [measureStart, measureDuration] = sequence.measures[target.measureIndex];
    const fraction = clamp((scoreX - target.x) / target.width, 0, 0.999999);
    const tick = clamp(
      Math.round(measureStart + measureDuration * fraction),
      measureStart,
      Math.max(measureStart, measureStart + measureDuration - 1),
    );
    const partIndex = nearestPartIndexAtScoreY(target.measureIndex, scoreY, fallbackPartIndex);
    const beatTick = beatTickAtScoreX(target.masterBounds, partIndex, scoreX);
    return {
      tick: beatTick === null ? tick : beatTick,
      exactTick: beatTick !== null,
      partIndex,
      snapStartTick: Number(measureStart) || 0,
      snapEndTick: (Number(measureStart) || 0) + (Number(measureDuration) || 0),
    };
  }

  function standardNoteAtClientPoint(clientX, clientY, nearest = false) {
    const lookup = api?.boundsLookup || api?.renderer?.boundsLookup;
    if (!lookup?.findMasterBarByIndex) return null;
    const origin = elements.score.getBoundingClientRect();
    const x = clientX - origin.left + elements.score.scrollLeft;
    const y = clientY - origin.top + elements.score.scrollTop;
    let closest = null;
    for (let index = 0; index < (sequence?.measures?.length || 0); index++) {
      const master = lookup.findMasterBarByIndex(index);
      const system = master?.staffSystemBounds?.realBounds;
      if (nearest && system && (x < system.x || x > system.x + system.w
        || y < system.y || y > system.y + system.h)) continue;
      for (const bar of master?.bars || []) {
        const track = partIndexForTrack(bar.bar?.staff?.track);
        if (!visibleTracks.has(track)) continue;
        for (const beat of bar.beats || []) for (const bounds of beat.notes || []) {
          const box = bounds.noteHeadBounds;
          const key = Number(bounds.note?.realValue);
          if (!box || !Number.isFinite(key) || key < 0 || key > 127) continue;
          // Use the engraved notehead, not the beat's entire time/lyric column.
          const padding = 2;
          if (!nearest && (x < box.x - padding || x > box.x + box.w + padding
            || y < box.y - padding || y > box.y + box.h + padding)) continue;
          const distance = Math.hypot(x - box.x - box.w / 2, y - box.y - box.h / 2);
          if (!closest || distance < closest.distance) closest = {
            key, track, distance, tick: Number(beat.beat?.absolutePlaybackStart), beatId: beat.beat?.id, box,
          };
        }
      }
    }
    for (const candidate of rangePreviews) {
      if (!candidate.rangeNode.isConnected || !visibleTracks.has(candidate.track)) continue;
      const b = candidate.rangeNode.querySelector('.range-hit').getBoundingClientRect();
      const system = lookup.findMasterBarByIndex(0)?.staffSystemBounds?.realBounds;
      if (nearest && system && (x < system.x || x > system.x + system.w || y < system.y || y > system.y + system.h)) continue;
      if (!nearest && (clientX < b.left || clientX > b.right || clientY < b.top || clientY > b.bottom)) continue;
      const distance = Math.hypot(clientX-b.left-b.width/2,clientY-b.top-b.height/2);
      if (!closest || distance < closest.distance) closest = {...candidate,distance};
    }
    return closest;
  }

  function previewGlyph(note) {
    if (note?.paint) return note.paint;
    const group = note?.rangeNode || (note?.beatId !== undefined
      ? elements.score.querySelector(`g.b${note.beatId}`) : null);
    if (!group) return null;
    const glyphs = [...group.querySelectorAll('text')].filter(text =>
      [...text.textContent].some(c => c.codePointAt(0)>=0xe0a0 && c.codePointAt(0)<=0xe0ff));
    if (glyphs.length < 2 || !note.box) return glyphs[0] || null;
    const origin = elements.score.getBoundingClientRect();
    const distance = text => {
      const point = text.getStartPositionOfChar(0).matrixTransform(text.getScreenCTM());
      return Math.hypot(point.x-origin.left+elements.score.scrollLeft-note.box.x,
        point.y-origin.top+elements.score.scrollTop-note.box.y-note.box.h/2);
    };
    return glyphs.sort((a,b)=>distance(a)-distance(b))[0];
  }

  function paintNoteFeedback(name, notes) {
    const wanted = new Set(notes.map(previewGlyph).filter(Boolean));
    for (const node of document.querySelectorAll('.'+name)) if (!wanted.has(node)) node.classList.remove(name);
    for (const node of wanted) node.classList.add(name);
  }

  function hoverNote(note) {
    paintNoteFeedback('hover-notehead', note ? [note] : []);
  }

  function bindScoreRanges() {
    rangePreviews = [];
    hoverNote(null);
    for (const track of scoreTracks) {
      const part = partIndexForTrack(track);
      for (const [index, name] of ['low','high'].entries()) {
        const nodes = elements.score.querySelectorAll(`.melete-range-${name}.melete-range-track-${track.index}`);
        nodes.forEach((node, staffIndex) => {
          const ends = window.MeleteNotationRange.extremes(track.staves[staffIndex] || track.staves[0]);
          const key = ends[index]?.realValue;
          if (!Number.isFinite(key)) return;
          const note = {key,track:part,rangeNode:node};
          rangePreviews.push(note);
          node.setAttribute('role','button'); node.setAttribute('tabindex','0');
          node.setAttribute('aria-label',`${parts[part]?.name || track.name}: ${index?'highest':'lowest'} note ${pitchLabel(key)}. Hold to listen.`);
          node.dataset.pitch=key; node.dataset.part=part;
          node.onkeydown=event=>{
            if(event.key!=='Enter'||event.repeat)return;
            event.preventDefault();event.stopPropagation();
            beginPitchAudition({button:0,pointerId:-1,currentTarget:node,clientX:0,clientY:0,timeStamp:performance.now()},note,()=>note,null);
          };
          node.onkeyup=event=>{if(event.key==='Enter'){event.preventDefault();pitchAuditions.get(-1)?.();}};
          node.onblur=()=>pitchAuditions.get(-1)?.();
        });
      }
    }
  }

  function chordNotesAtTick(tick) {
    return (sequence?.notes || []).filter(([track, start, end]) =>
      track >= 0 && track < parts.length && start <= tick && tick < end)
      .map(([track, , , key]) => ({ key, track }));
  }

  function performedScoreTick(tick) {
    const swing = sequence.swing;
    const unit = swing?.unit === "16th" ? sequence.division / 4
      : swing?.unit === "eighth" ? sequence.division / 2 : 0;
    if (!(unit > 0 && swing.ratio > 0 && swing.ratio < 100)) return tick;
    const pair = unit * 2, first = pair * swing.ratio / 100;
    const pairStart = Math.floor(tick / pair) * pair, offset = tick - pairStart;
    return Math.round(pairStart + (offset <= unit ? offset * first / unit
      : first + (offset - unit) * (pair - first) / unit));
  }

  function standardChordTargetAtClientPoint(clientX, clientY, stripOnly = true) {
    const lookup = api?.boundsLookup || api?.renderer?.boundsLookup;
    if (!lookup?.findMasterBarByIndex) return null;
    const origin = elements.score.getBoundingClientRect();
    const x = clientX - origin.left + elements.score.scrollLeft;
    const y = clientY - origin.top + elements.score.scrollTop;
    for (let index = 0; index < (sequence?.measures?.length || 0); index++) {
      const master = lookup.findMasterBarByIndex(index);
      const box = master?.realBounds;
      const system = master?.staffSystemBounds?.realBounds || box;
      const top = master?.lineAlignedBounds?.y;
      if (!box || !system || !Number.isFinite(top) || x < box.x || x >= box.x + box.w) continue;
      if (stripOnly ? y < Math.max(system.y, top - 44) || y >= top - 2
        : y < system.y || y > system.y + system.h) continue;

      // Engraved spacing is not proportional to time. Interpolate between
      // notehead left edges, including rest columns between notes. Use performed
      // onset ticks when the sequence carries swing, not straight notation time.
      const [start, duration] = sequence.measures[index];
      const columns = new Map();
      for (const bar of master.bars || []) {
        if (!visibleTracks.has(partIndexForTrack(bar.bar?.staff?.track))) continue;
        for (const beat of bar.beats || []) {
          const tick = performedScoreTick(Number(beat.beat?.absolutePlaybackStart));
          const heads = (beat.notes || []).map((note) => note.noteHeadBounds?.x).filter(Number.isFinite);
          const hasHead = heads.length > 0;
          const position = hasHead ? Math.min(...heads) : beat.realBounds?.x;
          if (!Number.isFinite(tick) || !Number.isFinite(position)) continue;
          const previous = columns.get(tick);
          if (!previous || (hasHead && !previous.hasHead)
            || (hasHead === previous.hasHead && position < previous.x)) {
            columns.set(tick, { x: position, hasHead });
          }
        }
      }
      const anchors = [...columns].map(([tick, column]) => ({ tick, x: column.x }))
        .sort((a, b) => a.x - b.x);
      if (!anchors.length) anchors.push({ tick: start, x: box.x });
      anchors.push({ tick: start + duration, x: box.x + box.w });
      let tick = anchors[0].tick;
      for (let i = 1; i < anchors.length; i++) {
        const left = anchors[i - 1], right = anchors[i];
        if (x < left.x) break;
        const fraction = clamp((x - left.x) / Math.max(1, right.x - left.x), 0, 1);
        tick = left.tick + fraction * (right.tick - left.tick);
        if (x < right.x) break;
      }
      return { tick: clamp(Math.floor(tick), start, start + duration - 1), exactTick: true,
        partIndex: currentScorePartIndex() };
    }
    return null;
  }

  // Engraving spaces notes by musical convention, not in proportion to time: a
  // leading clef, key and time signature, and the padding around every barline,
  // all take horizontal room that carries no duration. Reading a tick from how
  // far across the bar a click landed therefore points past the note that was
  // clicked, by a whole beat in the first bar of a system. The renderer knows
  // where it put each beat, so use its own answer and that beat's own tick.
  function beatTickAtScoreX(masterBounds, partIndex, scoreX) {
    const beats = barBoundsForPart(masterBounds, partIndex)?.beats;
    if (!beats?.length) return null;
    let chosen = null;
    for (const bounds of beats) {
      const beatStart = Number(bounds?.realBounds?.x);
      if (!Number.isFinite(beatStart)) continue;
      // Before the first beat counts as the first beat; otherwise a beat owns
      // the strip from where it starts up to where the next one starts.
      if (chosen && beatStart > scoreX) break;
      chosen = bounds;
    }
    const tick = Number(chosen?.beat?.absolutePlaybackStart);
    return Number.isFinite(tick) ? tick : null;
  }

  function snapTickToEighth(rawTick, originTick = 0) {
    const eighthTicks = Math.max(1, (Number(sequence?.division) || 1) / 2);
    return originTick + Math.round((rawTick - originTick) / eighthTicks) * eighthTicks;
  }

  function applyScoreScrubTarget(target) {
    if (!target || !engine || !ready) return;
    cancelVerticalFollowAnimation(true);
    const rawTick = clamp(Math.round(Number(target.tick) || 0), pitchTraceOriginTick(), latestSeekTick());
    const requestedTick = target.exactTick ? rawTick : clamp(snapTickToEighth(
      rawTick,
      Number.isFinite(target.snapStartTick) ? target.snapStartTick : 0,
    ), pitchTraceOriginTick(), latestSeekTick());
    if (Number.isInteger(target.partIndex) && visibleTracks.has(target.partIndex)) {
      selectedScorePartIndex = target.partIndex;
      elements.score.dataset.selectedPart = String(selectedScorePartIndex);
      elements.barScore.dataset.selectedPart = String(selectedScorePartIndex);
    }
    // An explicit seek cancels AlphaTab's old cursor transition. A raw audio
    // clock jump looks like continuous playback, especially into the next bar.
    seekPlaybackTick(requestedTick);
    selectedScoreTick = engine.tickAtSeconds(engine.currentSeconds());
    playbackDetached = false;
    hidePlaybackReturn();
    updateNoteActionLabel();
    renderSelectedPartHighlight();
    updateBarPlayhead(requestedTick);
    scheduleCursorTrim();
  }

  function cancelScoreScrub(pointer = null) {
    if (!scoreScrub || (pointer !== null && scoreScrub.pointerId !== pointer)) return;
    const { controller, surface, pointerId } = scoreScrub;
    scoreScrub = null;
    controller.abort();
    surface.classList.remove("is-scrubbing-score");
    document.documentElement.classList.remove("is-scrubbing-score");
    try {
      if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    } catch {
      // The browser can release capture first when the pointer leaves the tab.
    }
  }

  function beginScoreScrub(event, targetAtPointer) {
    if (event.button !== 0 || !ready || !engine || pinchActive || typeof targetAtPointer !== "function") return;
    const initialTarget = targetAtPointer(event);
    if (!initialTarget) return;
    cancelScoreScrub();
    const surface = event.currentTarget;
    const pointerId = event.pointerId;
    const controller = new AbortController();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerType = event.pointerType || "mouse";
    const pressedAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
    let scrubbing = false;
    scoreScrub = { controller, surface, pointerId };

    const beginDragScrub = (moveEvent) => {
      scrubbing = true;
      surface.classList.add("is-scrubbing-score");
      document.documentElement.classList.add("is-scrubbing-score");
      document.getSelection()?.removeAllRanges();
      try { surface.setPointerCapture(pointerId); } catch {}
      moveEvent.preventDefault();
      applyScoreScrubTarget(targetAtPointer(moveEvent));
    };

    const move = (moveEvent) => {
      if (!scoreScrub || moveEvent.pointerId !== pointerId) return;
      if (!scrubbing) {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        if (Math.hypot(deltaX, deltaY) < 8) return;
        const clearlyHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
        // A finger drag is primarily a reading gesture. In vertical layout,
        // reserve only an unmistakably horizontal gesture for scrubbing; in
        // horizontal layout, all finger drags remain native score scrolling.
        if (pointerType === "touch" && (flow === "continuous" || surface.classList.contains("has-horizontal-overflow") || !clearlyHorizontal)) {
          cancelScoreScrub();
          return;
        }
        beginDragScrub(moveEvent);
        return;
      }
      moveEvent.preventDefault();
      document.getSelection()?.removeAllRanges();
      applyScoreScrubTarget(targetAtPointer(moveEvent));
    };
    const finish = (finishEvent) => {
      if (!scoreScrub || finishEvent.pointerId !== pointerId) return;
      finishEvent.preventDefault();
      // A tap commits only on release, after it is known not to be a scroll.
      const releasedAt = Number.isFinite(finishEvent.timeStamp) ? finishEvent.timeStamp : performance.now();
      if (scrubbing || releasedAt - pressedAt < PITCH_AUDITION_HOLD_MS) {
        applyScoreScrubTarget(scrubbing ? targetAtPointer(finishEvent) : initialTarget);
      }
      cancelScoreScrub();
    };
    window.addEventListener("pointermove", move, { signal: controller.signal, passive: false });
    window.addEventListener("pointerup", finish, { signal: controller.signal, passive: false });
    window.addEventListener("pointercancel", (cancelEvent) => cancelScoreScrub(cancelEvent.pointerId), { signal: controller.signal });
    window.addEventListener("lostpointercapture", (lostEvent) => cancelScoreScrub(lostEvent.pointerId), { signal: controller.signal });
  }

  // A pitch bar is drawn two semitones tall, centred on its own pitch, so a
  // press is on it when it lands within a semitone of that centre. Bars of
  // neighbouring pitches overlap, so the nearest one wins; a tie goes to the
  // part the score is following.
  function barNoteAt(notes, tick, pitch, nearest = false, geometry = null) {
    const selected = currentScorePartIndex();
    const under = notes.filter(([, start, end, key]) =>
      (nearest && geometry ? end > geometry.startTick && start < geometry.endTick : tick >= start && tick < end)
      && (nearest || Math.abs(key - pitch) <= 1));
    const distance = note => nearest && geometry ? Math.hypot(
      Math.max(note[1] - tick, tick - note[2], 0) * geometry.tickScale,
      (note[3] - pitch) * geometry.pitchStep) : Math.abs(note[3] - pitch);
    under.sort((left, right) => distance(left) - distance(right)
      || (mixerParts[right[0]].source === selected) - (mixerParts[left[0]].source === selected));
    if (!under.length) return null;
    const [channel, start, end, key] = under[0];
    return { key, track: mixerParts[channel].source, channel, tick: start, endTick: end };
  }

  function cancelPitchAuditions() {
    for (const finish of pitchAuditions.values()) finish();
    keyboardAudition?.();
    keyboardAudition = null;
    hoverNote(null);
  }

  function stepScoreNote(direction) {
    if (!ready || !engine || !api) return;
    const track = currentScorePartIndex();
    const here = engine.currentSeconds();
    const candidates = scoreView === "bars"
      ? visiblePitchNotes().map(([channel, tick, , key]) => ({channel, key, track:mixerParts[channel].source, start:engine.secondsAtTick(tick)}))
      : engine.notes.flatMap(note => note.segments || [note]);
    const notes = candidates.filter(note => note.track === track).sort((a, b) => a.start - b.start);
    const target = direction > 0 ? notes.find((note) => note.start > here + 0.002)
      : [...notes].reverse().find((note) => note.start < here - 0.002);
    if (!target) return;
    const from = playbackCursorPlace();
    engine.pauseTransport();
    cancelPitchAuditions();
    applyScoreScrubTarget({ tick: engine.tickAtSeconds(target.start), exactTick: true, partIndex: track });
    const onset = new Map(notes.filter(note => Math.abs(note.start - target.start) < 1e-6).map(note => [note.key, note]));
    const voices = [...onset.values()].map(note => engine.holdNote(note.key, track, {channel:note.channel}));
    const finish = () => {
      window.clearTimeout(timer);
      for (const voice of voices) voice.release();
      if (keyboardAudition === finish) keyboardAudition = null;
    };
    const timer = window.setTimeout(finish, KEYBOARD_NOTE_PREVIEW_SECONDS * 1000);
    keyboardAudition = finish;
    followCursorFrom(from);
  }

  // The starting region fixes note/chord mode. Audio is immediate; only an
  // unmoved short release seeks. Space outside a music system can still scrub.
  function beginPitchAudition(event, note, notesAtPointer, targetAtPointer) {
    if (event.button !== 0 || !note || !engine || !ready || pinchActive) return false;
    cancelScoreScrub();
    pitchAuditions.get(event.pointerId)?.();
    const fullChord = Boolean(note.fullChord);
    const voices = new Map();
    const pointerId = event.pointerId;
    const surface = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const pressedAt = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
    const initialTarget = targetAtPointer?.(event);
    const controller = new AbortController();
    let dragging = false;
    const sound = (preview) => {
      const notes = preview?.notes || (preview ? [preview] : []);
      heldNotePreviews.set(pointerId, notes);
      paintNoteFeedback('preview-notehead', [...heldNotePreviews.values()].flat());
      const next = new Map(notes.map((n) => [`${n.channel ?? n.track}:${n.key}`, n]));
      for (const [id, voice] of voices) if (!next.has(id)) { voice.release(); voices.delete(id); }
      for (const [id, n] of next) if (!voices.has(id)) {
        voices.set(id, engine.holdNote(n.key, n.track, { fullChord, channel: n.channel }));
      }
    };
    const finish = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      pitchAuditions.delete(pointerId);
      heldNotePreviews.delete(pointerId);
      paintNoteFeedback('preview-notehead', [...heldNotePreviews.values()].flat());
      for (const voice of voices.values()) voice.release();
      voices.clear();
      surface?.classList.remove("is-auditioning-score");
      try { if (surface?.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId); } catch {}
    };
    pitchAuditions.set(pointerId, finish);
    try {
      sound(note);
      // A chord-area press on a rest still unlocks audio for the ensuing drag.
      if (!voices.size) { engine.ensureAudio(); void engine.context.resume().catch(finish); }
    } catch { finish(); return false; }
    window.addEventListener("pointermove", (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX, dy = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return;
        if (event.pointerType === "touch" && (flow === "continuous" || surface?.classList.contains("has-horizontal-overflow") || Math.abs(dx) <= Math.abs(dy) * 1.25)) {
          finish();
          return;
        }
        dragging = true;
        surface?.classList.add("is-auditioning-score");
        try { surface?.setPointerCapture(pointerId); } catch {}
      }
      moveEvent.preventDefault();
      document.getSelection()?.removeAllRanges();
      try { sound(notesAtPointer?.(moveEvent) ?? null); } catch { finish(); }
    }, { signal: controller.signal, passive: false });
    window.addEventListener("pointerup", (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      upEvent.preventDefault();
      // Cold audio startup can delay dispatch of an already released pointer.
      // Classify the physical input interval, not time spent running JavaScript.
      const releasedAt = Number.isFinite(upEvent.timeStamp) ? upEvent.timeStamp : performance.now();
      const tap = !dragging && releasedAt - pressedAt < PITCH_AUDITION_HOLD_MS;
      finish();
      if (tap && initialTarget) {
        applyScoreScrubTarget(initialTarget);
      }
    }, { signal: controller.signal });
    window.addEventListener("pointercancel", (cancelEvent) => {
      if (cancelEvent.pointerId === pointerId) finish();
    }, { signal: controller.signal });
    window.addEventListener("lostpointercapture", (lostEvent) => {
      if (lostEvent.pointerId === pointerId && lostEvent.target === surface) finish();
    }, { signal: controller.signal });
    event.currentTarget?.addEventListener("contextmenu", (contextEvent) => contextEvent.preventDefault(),
      { signal: controller.signal });
    return true;
  }

  function moveAnnotationRecord(currentId, tick, partIndex) {
    const nextId = annotationId(tick, partIndex);
    if (nextId === currentId) return currentId;
    if (annotations.has(nextId)) return null;
    const stored = annotations.get(currentId);
    if (stored) {
      annotations.delete(currentId);
      annotations.set(nextId, { ...stored, tick, partIndex });
    }
    if (editingAnnotation?.id === currentId) {
      editingAnnotation.id = nextId;
      editingAnnotation.tick = tick;
      editingAnnotation.partIndex = partIndex;
      editingAnnotation.focusRequested = false;
    }
    return nextId;
  }

  function beginAnnotationDrag(event, noteBox, tick, partIndex) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let currentId = noteBox.dataset.annotationId;
    let currentTick = tick;
    let currentPartIndex = partIndex;
    let moved = false;
    const controller = new AbortController();
    annotationDragActive = true;
    document.documentElement.classList.add("is-dragging-annotation");
    if (editingAnnotation?.id === currentId) {
      editingAnnotation.draft = noteBox.querySelector(".score-note-editor")?.value || editingAnnotation.draft;
      editingAnnotation.focusRequested = false;
    }

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
      const target = standardScoreTargetAtClientPoint(moveEvent.clientX, moveEvent.clientY, currentPartIndex);
      if (!target || (target.tick === currentTick && target.partIndex === currentPartIndex)) return;
      const nextId = moveAnnotationRecord(currentId, target.tick, target.partIndex);
      if (!nextId) return;
      currentId = nextId;
      currentTick = target.tick;
      currentPartIndex = target.partIndex;
      moved = true;
      renderAnnotations();
    };
    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      controller.abort();
      annotationDragActive = false;
      document.documentElement.classList.remove("is-dragging-annotation");
      if (!moved) return;
      saveAnnotations();
      if (editingAnnotation?.id === currentId) editingAnnotation.focusRequested = true;
      renderAnnotations();
      showToast(`Annotation moved to ${scoreLocationAtTick(currentTick)}`);
    };
    window.addEventListener("pointermove", move, { signal: controller.signal, passive: false });
    window.addEventListener("pointerup", finish, { signal: controller.signal });
    window.addEventListener("pointercancel", finish, { signal: controller.signal });
  }

  function renderAnnotations() {
    const previousEditor = elements.score.querySelector(".score-note-editor");
    if (editingAnnotation && previousEditor) {
      editingAnnotation.draft = previousEditor.value;
      if (!annotationDragActive && document.activeElement === previousEditor) editingAnnotation.focusRequested = true;
    }
    elements.score.querySelector(".score-note-layer")?.remove();
    if ((!annotations.size && !editingAnnotation) || !api) return;
    const lookup = api.boundsLookup || api.renderer?.boundsLookup;
    if (!lookup?.findMasterBarByIndex) return;
    const layer = document.createElement("div");
    layer.className = "score-note-layer";
    const scoreWidth = Math.max(elements.score.clientWidth, elements.score.scrollWidth);
    layer.style.width = `${scoreWidth}px`;
    layer.style.height = `${Math.max(elements.score.clientHeight, elements.score.scrollHeight)}px`;

    const renderedBeatBoundsAtTick = (tick, partIndex) => {
      const track = scoreTracks[partIndex];
      if (!track || !visibleTracks.has(partIndex)) return null;
      for (const staff of track.staves || []) {
        for (const bar of staff.bars || []) {
          for (const voice of bar.voices || []) {
            for (const beat of voice.beats || []) {
              if (Number(beat.absolutePlaybackStart) !== tick) continue;
              const beatBounds = lookup.findBeat?.(beat);
              if (beatBounds) return beatBounds;
            }
          }
        }
      }
      return null;
    };

    const items = [...annotations.values()]
      .filter((annotation) => annotationId(annotation.tick, annotation.partIndex) !== editingAnnotation?.id)
      .map((annotation) => ({ ...annotation, editing: false }));
    if (editingAnnotation) items.push({ ...editingAnnotation, text: editingAnnotation.draft, editing: true });
    items.sort((left, right) => left.tick - right.tick || left.partIndex - right.partIndex);

    items.forEach(({ id, tick, partIndex, text, editing }) => {
      if (!visibleTracks.has(partIndex)) return;
      const measureIndex = measureIndexAtTick(tick);
      const masterBounds = lookup.findMasterBarByIndex(measureIndex);
      const staffBounds = barBoundsForPart(masterBounds, partIndex);
      const box = staffBounds?.realBounds || staffBounds?.visualBounds;
      if (!box) return;
      const x = Number(box.x);
      const staffTop = Number(box.y);
      const width = Number(box.w);
      if (![x, staffTop, width].every(Number.isFinite)) return;
      const [measureStart, measureDuration] = sequence.measures[measureIndex];
      const fraction = measureDuration > 0 ? clamp((tick - measureStart) / measureDuration, 0, 1) : 0;
      const beatX = Number(renderedBeatBoundsAtTick(tick, partIndex)?.onNotesX);
      const anchorX = Number.isFinite(beatX) ? beatX : x + width * fraction;
      const anchorBottom = Math.max(6, staffTop - 5);
      const location = scoreLocationAtTick(tick);
      const partName = parts[partIndex]?.name || `Part ${partIndex + 1}`;
      const partColor = parts[partIndex]?.color || partPaint(partIndex);
      const noteText = String(text || "");
      const boxWidth = scoreNoteBoxWidth(noteText, location);
      const boxLeft = anchorX + 4;
      layer.style.width = `${Math.max(Number.parseFloat(layer.style.width) || scoreWidth, boxLeft + boxWidth + 8)}px`;

      const pin = document.createElement("span");
      pin.className = "score-note-pin";
      pin.style.setProperty("--part-color", partColor);
      pin.style.left = `${Math.max(0, anchorX)}px`;
      pin.style.top = `${anchorBottom}px`;
      pin.style.height = `${Math.max(5, staffTop - anchorBottom)}px`;
      layer.append(pin);

      const noteBox = document.createElement("div");
      noteBox.className = `score-note-box${editing ? " is-editing" : ""}`;
      noteBox.dataset.annotationId = id || annotationId(tick, partIndex);
      noteBox.dataset.partIndex = String(partIndex);
      noteBox.dataset.tick = String(tick);
      noteBox.style.setProperty("--part-color", partColor);
      noteBox.style.left = `${Math.max(2, boxLeft)}px`;
      noteBox.style.top = `${anchorBottom}px`;
      noteBox.style.width = `${boxWidth}px`;
      const address = document.createElement("button");
      address.type = "button";
      address.className = "score-note-location";
      address.textContent = location;
      address.title = `Drag to move ${partName} annotation`;
      address.setAttribute("aria-label", `Move ${partName} annotation at ${location}`);
      address.addEventListener("pointerdown", (event) => beginAnnotationDrag(event, noteBox, tick, partIndex));
      address.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "score-note-delete";
      deleteButton.title = `Delete ${partName} annotation at ${location}`;
      deleteButton.setAttribute("aria-label", `Delete ${partName} annotation at ${location}`);
      const deleteIcon = createSvgElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
      deleteIcon.append(createSvgElement("path", { d: "M18 6 6 18M6 6l12 12" }));
      deleteButton.append(deleteIcon);
      deleteButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (editingAnnotation?.id === noteBox.dataset.annotationId) editingAnnotation = null;
        if (annotations.has(noteBox.dataset.annotationId)) deleteAnnotation(tick, partIndex);
        else renderAnnotations();
      });

      if (editing) {
        const editor = document.createElement("textarea");
        editor.className = "score-note-editor";
        editor.rows = 1;
        editor.wrap = "off";
        editor.maxLength = 500;
        editor.value = noteText;
        editor.setAttribute("aria-label", `Annotation for ${partName} at measure ${location}`);
        editor.addEventListener("pointerdown", (event) => event.stopPropagation());
        editor.addEventListener("input", () => {
          if (!editingAnnotation || editingAnnotation.id !== noteBox.dataset.annotationId) return;
          editingAnnotation.draft = editor.value;
          const nextWidth = scoreNoteBoxWidth(editor.value, location);
          noteBox.style.width = `${nextWidth}px`;
          layer.style.width = `${Math.max(scoreWidth, boxLeft + nextWidth + 8)}px`;
          resizeInlineNoteEditor(editor);
        });
        editor.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            commitInlineNoteEdit(true);
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            editingAnnotation.draft = editor.value;
            commitInlineNoteEdit();
          }
        });
        editor.addEventListener("blur", () => {
          if (!editingAnnotation || editingAnnotation.id !== noteBox.dataset.annotationId) return;
          editingAnnotation.draft = editor.value;
          commitInlineNoteEdit();
        });
        noteBox.append(deleteButton, address, editor);
        requestAnimationFrame(() => {
          resizeInlineNoteEditor(editor);
          if (!editingAnnotation?.focusRequested || editingAnnotation.id !== noteBox.dataset.annotationId) return;
          editingAnnotation.focusRequested = false;
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
        });
      } else {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "score-note-edit";
        const message = document.createElement("span");
        message.className = "score-note-message";
        message.textContent = noteText;
        editButton.append(message);
        editButton.title = `Edit ${partName} annotation at ${location}`;
        editButton.setAttribute("aria-label", `Edit ${partName} annotation at ${location}: ${noteText}`);
        editButton.addEventListener("click", (event) => {
          event.stopPropagation();
          startInlineNoteEdit(tick, partIndex);
        });
        noteBox.append(deleteButton, address, editButton);
      }
      layer.append(noteBox);
    });
    elements.score.append(layer);
  }

  function centerFullMeasureRests() {
    if (!api || !sequence?.measures?.length) return;
    const lookup = api.boundsLookup || api.renderer?.boundsLookup;
    if (!lookup?.findMasterBarByIndex) return;

    const targets = new Map();
    let barCount = 0;
    sequence.measures.forEach((_, index) => {
      const bounds = lookup.findMasterBarByIndex(index);
      if (!bounds) return;
      barCount += 1;
      for (const bar of bounds.bars || []) for (const beat of bar.beats || []) {
        if (!beat.beat.isFullBarRest || beat.beat.isEmpty) continue;
        const box = beat.realBounds;
        if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.w) || box.w <= 0) continue;
        // Beat bounds exclude the clef, key/time signature and closing barline.
        // Centering in the entire bar can put a rest on top of the time signature.
        targets.set(`b${beat.beat.id}`, {index, x: box.x + box.w / 2});
      }
    });
    elements.score.dataset.fullRestBarCount = String(barCount);

    const scoreRect = elements.score.getBoundingClientRect();
    const localPoint = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left - scoreRect.left + elements.score.scrollLeft + rect.width / 2,
        y: rect.top - scoreRect.top + elements.score.scrollTop + rect.height / 2,
      };
    };
    let glyphCount = 0;
    let centeredCount = 0;
    elements.score.querySelectorAll(".at-surface-svg text").forEach((rest) => {
      // SMuFL restWhole (U+E4E3). AlphaTab recognizes MusicXML measure rests,
      // but v1.8.4 places their glyph at beat zero instead of the bar center.
      if (rest.textContent !== "\uE4E3") return;
      glyphCount += 1;
      const group = rest.parentElement;
      if (!group) return;
      let target;
      for (let owner = group; owner && owner !== elements.score; owner = owner.parentElement) {
        const id = [...(owner.classList || [])].find(name => targets.has(name));
        if (id) { target = targets.get(id); break; }
      }
      if (!target) return;
      if (group.dataset.fullRestOriginalTransform === undefined) {
        group.dataset.fullRestOriginalTransform = group.getAttribute("transform") || "";
      }
      group.setAttribute("transform", group.dataset.fullRestOriginalTransform);
      const point = localPoint(rest);
      const targetX = target.x;
      const deltaX = (targetX - point.x) / (group.getScreenCTM()?.a || 1);
      group.setAttribute("transform", `${group.dataset.fullRestOriginalTransform} translate(${deltaX} 0)`);
      group.dataset.fullRestCentered = "true";
      group.dataset.fullRestMeasure = String(target.index + 1);
      group.dataset.fullRestTargetX = String(targetX);
      centeredCount += 1;
    });
    elements.score.dataset.fullRestGlyphCount = String(glyphCount);
    elements.score.dataset.fullRestCenteredCount = String(centeredCount);
  }

  function scheduleFullMeasureRestCentering() {
    const generation = ++fullRestCenterGeneration;
    let frame = 0;
    const centerAfterPaint = () => {
      if (generation !== fullRestCenterGeneration) return;
      centerFullMeasureRests();
      frame += 1;
      // AlphaTab's renderFinished event can precede replacement SVG attachment
      // by several frames during reflow. Repeating is safe because each pass
      // restores the original transform before calculating a fresh offset.
      if (frame < 8) requestAnimationFrame(centerAfterPaint);
    };
    requestAnimationFrame(centerAfterPaint);
  }

  function measureIndexAtTick(tick) {
    if (!sequence?.measures?.length) return 0;
    let low = 0;
    let high = sequence.measures.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence.measures[middle][0] <= tick) low = middle + 1;
      else high = middle;
    }
    return clamp(low - 1, 0, sequence.measures.length - 1);
  }

  function currentMeasureIndex() {
    if (!engine) return 0;
    const tick = engine.tickAtSeconds(engine.currentSeconds());
    // Both loop controls include the selected measure, including its downbeat.
    // Tolerate roundoff when converting a clicked tick through playback seconds.
    return measureIndexAtTick(tick + 1e-6);
  }

  function loopLinkValue(...addresses) {
    let value;
    addresses.forEach(address => {
      for (const [key, item] of new URLSearchParams(String(address || "").replace(/^[#?]/u, ""))) {
        if (key.toLowerCase() === "loop") value = item.trim();
      }
    });
    return value;
  }

  function loopAddressTick(address, end = false) {
    const match = /^([1-9]\d*)(?:\.([1-9]\d*)(?:\.(\d{1,9}))?)?$/u.exec(address);
    if (!match || !sequence?.measures?.length) return null;
    const measureIndex = Number(match[1]) - 1;
    const beat = Number(match[2] || 1);
    const fraction = Number(`0.${match[3] || "0"}`);
    // All URL endpoints are positions: omitted beat/fraction means 1.0.
    if (end && measureIndex === sequence.measures.length && beat === 1 && fraction === 0) return sequence.endTick;
    const measure = sequence.measures[measureIndex];
    if (!measure) return null;
    const beatTicks = sequence.division * 4 / (measure[3] || 4);
    const offset = (beat - 1 + fraction) * beatTicks;
    if (!Number.isFinite(offset) || beat > (measure[2] || 4) || offset < 0 || offset >= measure[1]) return null;
    return measure[0] + offset;
  }

  function parseLoopLink(value) {
    if (typeof value !== "string" || value.length > 100) return null;
    const endpoints = value.trim().split("-");
    if (endpoints.length !== 2) return null;
    const start = loopAddressTick(endpoints[0].trim());
    const end = loopAddressTick(endpoints[1].trim(), true);
    if (start === null || end === null || start >= end || end > sequence.endTick) return null;
    const first = sequence.measures[measureIndexAtTick(start)];
    const last = sequence.measures[measureIndexAtTick(end - 1e-6)];
    return { start: first[0], end: last[0] + last[1] };
  }

  function consumeLoopLink() {
    try {
      const address = new URL(window.location.href);
      const keep = text => text.replace(/^[#?]/u, "").split("&")
        .filter(token => token && loopLinkValue(token) === undefined).join("&");
      address.search = keep(address.search);
      address.hash = keep(address.hash);
      window.history.replaceState(window.history.state, "", address.href);
    } catch {
      // Embedded players receive their links from the collection instead.
    }
  }

  function loopTickRange() {
    const startMeasure = sequence?.measures?.[loopStartMeasure];
    const endMeasure = sequence?.measures?.[loopEndMeasure];
    return {
      start: startMeasure ? loopStartTick ?? startMeasure[0] : 0,
      end: endMeasure ? loopEndTick ?? endMeasure[0] + endMeasure[1] : null,
    };
  }

  function restoreLoopState(state) {
    loopEnabled = state.loopEnabled !== false;
    const validMeasure = index => Number.isInteger(index) && index >= 0 && index < sequence.measures.length;
    loopStartMeasure = validMeasure(state.loopStart) ? state.loopStart : null;
    loopEndMeasure = validMeasure(state.loopEnd) ? state.loopEnd : null;
    loopStartTick = loopStartMeasure !== null ? state.loopStartTick ?? null : null;
    loopEndTick = loopEndMeasure !== null ? state.loopEndTick ?? null : null;
    const validTick = (tick, index, end) => {
      if (tick === null) return true;
      const [start, duration] = sequence.measures[index];
      return Number.isFinite(tick) && (end ? tick > start && tick <= start + duration : tick >= start && tick < start + duration);
    };
    const range = loopTickRange();
    if ((state.loopStart != null && !validMeasure(state.loopStart)) || (state.loopEnd != null && !validMeasure(state.loopEnd))
      || !validTick(loopStartTick, loopStartMeasure, false) || !validTick(loopEndTick, loopEndMeasure, true)
      || (range.end !== null && (range.start >= range.end || range.end > sequence.endTick))) {
      loopStartMeasure = loopEndMeasure = loopStartTick = loopEndTick = null;
    }
    // Older recordings stored their first entrance as a fractional loop start.
    // Preserve those measures, but always return to their downbeats on repeats.
    loopStartTick = loopEndTick = null;
  }

  function applyLoopLink(value) {
    if (value === undefined) return false;
    if (!ready || !engine) {
      pendingLoopLink = value;
      return true;
    }
    pendingLoopLink = undefined;
    const range = parseLoopLink(value);
    if (!range) {
      showToast("This loop link is not a valid range in this score; your loop is unchanged", "error");
      return false;
    }
    // Links use exclusive ends; playback and visible controls use whole bars.
    loopEnabled = true;
    loopStartMeasure = measureIndexAtTick(range.start);
    loopEndMeasure = measureIndexAtTick(range.end);
    if (loopEndMeasure > 0 && sequence.measures[loopEndMeasure][0] === range.end) loopEndMeasure -= 1;
    const endMeasure = sequence.measures[loopEndMeasure];
    loopStartTick = range.start === sequence.measures[loopStartMeasure][0] ? null : range.start;
    loopEndTick = range.end === endMeasure[0] + endMeasure[1] ? null : range.end;
    api?.pause();
    engine.pause();
    updateLoopState({ persist: true });
    seekLoopStart(range.start);
    showToast(`Loop ready: ${elements.loopStart.textContent} to ${elements.loopEnd.textContent}`);
    return true;
  }

  function seekLoopStart(tick) {
    pendingLoopRevealTick = tick;
    engine.seek(engine.secondsAtTick(tick));
    requestAnimationFrame(revealPendingLoopStart);
  }

  function restoreStartupLoop() {
    const firstReady = !initialLoopRestored;
    initialLoopRestored = true;
    // An incoming link wins over saved endpoints; an invalid link leaves them intact.
    if (pendingLoopLink !== undefined && applyLoopLink(pendingLoopLink)) return;
    if (firstReady && !pendingNotationReload && engine?.hasLoop() && !engine.playing) {
      seekLoopStart(loopTickRange().start);
    }
  }

  function revealPendingLoopStart() {
    if (pendingLoopRevealTick === null || !ready || !engine) return;
    if (!engine.hasLoop() || engine.playing
      || Math.abs(engine.tickAtSeconds(engine.currentSeconds()) - pendingLoopRevealTick) > 1) {
      pendingLoopRevealTick = null;
      return;
    }
    // Inactive collection frames and in-flight layouts do not have usable bounds.
    // Their activation/render completion calls us again, without a polling timer.
    if (window.frameElement?.inert || window.frameElement?.getAttribute("aria-hidden") === "true"
      || pendingNotationReload || (scoreView === "bars" ? barRenderFrame
        : renderTimer || notationRenderInFlight || notationRenderQueued)) return;
    const bounds = playbackCursorBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    updateTransportHeight();
    scrollToPlayback("down", "auto", true);
    const surface = scoreView === "bars" ? elements.barScore : elements.score;
    if (flow === "continuous" || surface.classList.contains("has-horizontal-overflow")) {
      scrollToPlayback("left", "auto", true);
    }
    pendingLoopRevealTick = null;
  }

  function updateLoopState({ persist = false } = {}) {
    const hasStart = Number.isInteger(loopStartMeasure);
    const hasEnd = Number.isInteger(loopEndMeasure);
    const startLabel = hasStart ? (loopStartTick === null ? String(loopStartMeasure + 1) : scoreLocationAtTick(loopStartTick)) : "Start";
    const endLabel = hasEnd ? (loopEndTick === null ? String(loopEndMeasure + 1) : scoreLocationAtTick(loopEndTick)) : "End";
    elements.loopStart.classList.toggle("is-set", hasStart);
    elements.loopEnd.classList.toggle("is-set", hasEnd);
    elements.loopStart.textContent = startLabel;
    elements.loopEnd.textContent = endLabel;
    elements.loopStart.setAttribute("aria-label", hasStart ? `Set loop start to selected measure; currently ${startLabel}` : "Set loop start to selected measure");
    elements.loopEnd.setAttribute("aria-label", hasEnd ? `Set loop end to selected measure; currently ${endLabel}` : "Set loop end to selected measure");
    elements.loopStart.dataset.help = hasStart ? `Move loop start; currently ${startLabel}.` : "Set loop start at selected measure. Shortcut: [";
    elements.loopEnd.dataset.help = hasEnd ? `Move loop end; currently ${endLabel}${loopEndTick === null ? " (inclusive)" : " (exclusive)"}.` : "Set loop end at selected measure. Shortcut: ]";
    [elements.loopStart, elements.loopEnd].forEach((button) => {
      button.style.fontSize = button.textContent.includes(".") ? `${Math.min(10, 64 / button.textContent.length)}px` : "";
      button.dataset.help += " Hold to clear the loop.";
      button.title = button.dataset.help;
    });
    // A closing repeat with no opening one repeats from the top, the way it
    // does in print, so an End on its own is a complete loop. An opening one
    // alone is not: there is nothing yet to come back from.
    elements.loopControls.classList.toggle("has-partial-loop", hasStart && !hasEnd);
    elements.loopControls.classList.toggle("has-complete-loop", hasEnd);
    elements.loopControls.classList.toggle("is-loop-disabled", hasEnd && !loopEnabled);
    elements.loopToggle.disabled = !sequence?.measures?.length;
    elements.loopToggle.setAttribute("aria-pressed", String(hasEnd && loopEnabled));
    elements.loopToggle.setAttribute("aria-label", hasEnd && loopEnabled ? "Disable loop; keep endpoints" : "Enable loop");

    if (hasEnd && engine) {
      const { start, end } = loopTickRange();
      engine?.setLoop(loopEnabled ? start : null, loopEnabled ? end : null);
      const left = timelineFraction(engine.secondsAtTick(start)) * 100;
      const right = timelineFraction(engine.secondsAtTick(end)) * 100;
      elements.loopBand.style.left = `${left}%`;
      elements.loopBand.style.width = `${right - left}%`;
      elements.loopBand.classList.add("is-active");
      elements.loopBand.classList.toggle("is-disabled", !loopEnabled);
    } else {
      engine?.setLoop(null, null);
      elements.loopBand.classList.remove("is-active");
    }
    if (scoreView === "bars" && sequence?.measures?.length) scheduleBarRender();
    if (persist) savePreferences();
    if (elements.takePanel && !elements.takePanel.hidden) renderTakePanel();
  }

  function setLoopPoint(kind) {
    loopEnabled = true;
    const current = currentMeasureIndex();
    if (kind === "start") {
      loopStartMeasure = current;
      loopStartTick = null;
      const range = loopTickRange();
      if (range.end !== null && range.start >= range.end) { loopEndMeasure = null; loopEndTick = null; }
    } else {
      loopEndMeasure = current;
      loopEndTick = null;
      const range = loopTickRange();
      if (range.start >= range.end) { loopStartMeasure = null; loopStartTick = null; }
    }
    updateLoopState({ persist: true });
    if (Number.isInteger(loopStartMeasure) && Number.isInteger(loopEndMeasure)) {
      showToast(`Looping ${elements.loopStart.textContent} to ${elements.loopEnd.textContent}`);
    }
  }

  function clearLoop() {
    loopEnabled = true;
    loopStartMeasure = null;
    loopEndMeasure = null;
    loopStartTick = null;
    loopEndTick = null;
    updateLoopState({ persist: true });
  }

  function toggleLoop() {
    if (!sequence?.measures?.length) return;
    if (!Number.isInteger(loopEndMeasure)) {
      loopStartMeasure = 0;
      loopEndMeasure = sequence.measures.length - 1;
      loopStartTick = loopEndTick = null;
      loopEnabled = true;
    } else loopEnabled = !loopEnabled;
    updateLoopState({ persist: true });
  }

  function autoChapters() {
    const explicit = Array.isArray(config.chapters) && config.chapters.length ? config.chapters : sequence.chapters;
    if (Array.isArray(explicit) && explicit.length) {
      return explicit.map((chapter, index) => ({
        tick: Number(chapter.tick ?? sequence.measures?.[Math.max(0, Number(chapter.measure || 1) - 1)]?.[0] ?? 0),
        label: String(chapter.label || chapter.name || `Section ${index + 1}`),
      })).sort((left, right) => left.tick - right.tick);
    }
    const groupSize = sequence.measures.length > 48 ? 8 : 4;
    return sequence.measures.filter((_, index) => index % groupSize === 0).map((measure, index) => ({
      tick: measure[0],
      label: `Measure ${index * groupSize + 1}`,
    }));
  }

  function buildTimelineSegments() {
    elements.timelineSegments.innerHTML = "";
    const listed = autoChapters()
      .filter((chapter) => Number.isFinite(chapter.tick) && chapter.tick >= 0 && chapter.tick < sequence.endTick)
      .filter((chapter, index, all) => index === 0 || chapter.tick > all[index - 1].tick);
    const chapters = listed[0]?.tick === 0 ? listed : [{ tick: 0, label: "Start" }, ...listed];
    chapters.unshift({tick: pitchTraceOriginTick(), label: "Lead-in"});
    const chapterTimes = chapters.map((chapter) => engine.secondsAtTick(chapter.tick) * 1000);
    const durationMilliseconds = engine.duration * 1000;
    chapterSeekMilliseconds = [...new Set([
      0,
      ...chapterTimes.map((milliseconds) => Math.round(milliseconds)),
      Math.round(durationMilliseconds),
    ])].sort((left, right) => left - right);
    const boundaries = [...chapterTimes, durationMilliseconds];
    chapters.forEach((chapter, index) => {
      const span = document.createElement("span");
      span.className = "timeline-segment is-chapter";
      span.style.flexGrow = String(Math.max(1, boundaries[index + 1] - chapterTimes[index]));
      span.dataset.chapterMilliseconds = String(Math.round(chapterTimes[index]));
      span.title = chapter.label;
      elements.timelineSegments.append(span);
    });
  }

  function snapSeekMilliseconds(milliseconds) {
    const maximum = Number(elements.seek.max) || Math.round((engine?.duration || 0) * 1000) || 1;
    const value = clamp(Number(milliseconds) || 0, Number(elements.seek.min) || 0, maximum);
    if (value < 0) return value;
    // Every snap point attracts anything within a measure of it, so leaving the
    // end of the piece in would swallow the whole final bar and there would be
    // no way to place the playhead inside it. It is not a section to practise
    // from either; End still goes there directly.
    const points = (chapterSeekMilliseconds.length ? chapterSeekMilliseconds : [0, maximum])
      .filter((point) => point < maximum);
    const nearest = points.reduce((best, point) => {
      const [lower, upper] = chapterSnapBoundsMilliseconds(point);
      if (value < lower || value > upper) return best;
      const distance = Math.abs(point - value);
      return !best || distance < best.distance ? { point, distance } : best;
    }, null);
    return nearest?.point ?? value;
  }

  function chapterSnapBoundsMilliseconds(chapterMilliseconds) {
    if (!engine || !sequence?.measures?.length) return [chapterMilliseconds, chapterMilliseconds];
    const chapterTick = clamp(engine.tickAtSeconds(chapterMilliseconds / 1000), 0, sequence.endTick);
    const referenceTick = Math.min(chapterTick, Math.max(0, sequence.endTick - 1));
    const measure = sequence.measures[measureIndexAtTick(referenceTick)];
    const measureDurationTicks = Math.max(1, Number(measure?.[1]) || engine.division * 4);
    const lowerTick = Math.max(0, chapterTick - measureDurationTicks);
    const upperTick = Math.min(sequence.endTick, chapterTick + measureDurationTicks);
    return [engine.secondsAtTick(lowerTick) * 1000, engine.secondsAtTick(upperTick) * 1000];
  }

  function adjacentChapterMilliseconds(milliseconds, direction) {
    const value = Number(milliseconds) || 0;
    if (direction > 0) return chapterSeekMilliseconds.find((point) => point > value + 1) ?? chapterSeekMilliseconds.at(-1) ?? value;
    return [...chapterSeekMilliseconds].reverse().find((point) => point < value - 1) ?? chapterSeekMilliseconds[0] ?? value;
  }

  // Seeking too close to the score's last tick reads as past the end to the
  // player, which answers by rewinding to the beginning. Measured on this
  // build the last tick that behaves is two short of the end, so stop a
  // sixty-fourth short: far too little to hear, and it does not depend on
  // where exactly the player draws that line.
  function latestSeekTick() {
    const endTick = Number(sequence?.endTick) || 1;
    const division = Number(sequence?.division) || 960;
    return Math.max(0, endTick - Math.max(1, Math.round(division / 16)));
  }

  function seekTickFor(milliseconds) {
    return clamp(Math.round(engine.tickAtSeconds(Number(milliseconds) / 1000)), pitchTraceOriginTick(), latestSeekTick());
  }

  function seekPlaybackTick(tick) {
    // AlphaTab owns only the printed score; our audio clock also owns its lead-in.
    api.tickPosition = Math.max(0, tick);
    if (tick < 0) engine.seek(engine.secondsAtTick(tick));
  }

  function restorePlaybackPosition(milliseconds) {
    if (!ready || !engine || !api || typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) return false;
    // Collection restoration is an exact location, not a chapter-scrubbing gesture.
    initialLoopRestored = true;
    pendingLoopRevealTick = null;
    seekPlaybackTick(seekTickFor(milliseconds));
    return true;
  }

  // The timeline's section names were only ever hover titles, which a touch
  // screen never shows. While a finger scrubs, the section under the thumb
  // sits on the rail, where sliding the finger down reveals it, and goes on
  // release. Nothing is added to the header between gestures.
  let scrubLabelPointer = null;

  function chapterLabelAt(milliseconds) {
    let label = "";
    // A song without sections has only its "Start", which says nothing.
    if (elements.timelineSegments.children.length < 2) return label;
    for (const segment of elements.timelineSegments.children) {
      if (Number(segment.dataset.chapterMilliseconds) > milliseconds + 1) break;
      label = segment.title;
    }
    return label;
  }

  function showScrubLabel(milliseconds) {
    const label = [chapterLabelAt(milliseconds), takeTimelineLabelAt(milliseconds / 1000)].filter(Boolean).join(" \u00b7 ");
    if (!label) {
      elements.scrubLabel.hidden = true;
      return;
    }
    elements.scrubLabel.textContent = label;
    elements.scrubLabel.hidden = false;
    const rail = elements.timelineRail.getBoundingClientRect();
    const thumb = parseFloat(getComputedStyle(elements.timelineRail).getPropertyValue("--seek-thumb-size")) || 16;
    const fraction = timelineFraction(milliseconds / 1000);
    const x = rail.left + thumb / 2 + (rail.width - thumb) * fraction;
    const box = elements.scrubLabel.getBoundingClientRect();
    elements.scrubLabel.style.left = `${clamp(x - box.width / 2, 8, Math.max(8, window.innerWidth - box.width - 8))}px`;
    elements.scrubLabel.style.top = `${rail.top + rail.height / 2 - box.height / 2}px`;
  }

  function hideScrubLabel() {
    scrubLabelPointer = null;
    elements.scrubLabel.hidden = true;
  }

  function previewSeek(milliseconds, updateScore = false) {
    const value = snapSeekMilliseconds(milliseconds);
    elements.seek.value = String(value);
    elements.currentTime.textContent = formatTime(value);
    updateSeekAppearance(value);
    if (updateScore && ready && engine && api) {
      cancelVerticalFollowAnimation(true);
      seekPlaybackTick(seekTickFor(value));
    }
    return value;
  }

  // Firefox on macOS only. Opening a microphone there rebuilds the page's
  // audio graph on a private aggregate device whose first outputs belong to
  // the microphone, so a USB mic with its own headphone jack silently takes
  // every sound the page makes for as long as it is open. Firefox keeps one
  // graph per sample rate and the microphone always joins the native-rate
  // one, so playback on any other rate stays on the system output.
  function isolatedPlaybackRate(AudioContextClass) {
    const agent = navigator.userAgent;
    if (!/\bFirefox\//.test(agent) || !/Macintosh/.test(agent)) return 0;
    try {
      const probe = new AudioContextClass();
      const nativeRate = probe.sampleRate;
      void probe.close();
      return nativeRate === 44100 ? 48000 : 44100;
    } catch {
      return 0;
    }
  }

  class GuideEngine {
    constructor(data) {
      this.practiceRoles = data.practiceRoles || [];
      this.division = data.division;
      this.endTick = data.endTick;
      this.leadInTicks = -clamp(Number(config.recordingCountInBeats) || 4, 1, 16) * this.division * 4 / (data.measures?.[0]?.[3] || 4);
      this.tempoSegments = this.buildTempoSegments(data.tempos || []);
      this.duration = this.secondsAtTick(this.endTick);
      const raw = data.notes.map(([track, startTick, endTick, key, velocity]) => ({
        track,
        key,
        velocity,
        start: this.secondsAtTick(startTick),
        end: this.secondsAtTick(endTick),
      }));
      const joined = new Set(), phrases = [];
      for (const chain of data.legato || []) {
        const segments = chain.map((index) => raw[index]);
        if (segments.length < 2 || new Set(chain).size !== chain.length || chain.some((index) => joined.has(index)) ||
            segments.some((note, i) => !note || note.end <= note.start || (i &&
              (note.track !== segments[0].track || Math.abs(segments[i - 1].end - note.start) > 1e-6)))) continue;
        phrases.push({ ...segments[0], end: segments.at(-1).end, segments });
        chain.forEach((index) => joined.add(index));
      }
      this.notes = [...phrases, ...raw.filter((_, index) => !joined.has(index))]
        .filter((note) => note.end > note.start).sort((left, right) => left.start - right.start || left.track - right.track);
      this.clicks = this.buildMetronomeEvents(data.measures || []);
      this.rate = 1;
      this.basePosition = 0;
      this.anchorTime = 0;
      this.playing = false;
      this.starting = false;
      this.startRequest = 0;
      this.preparing = false;
      this.transportRequest = 0;
      this.onPreparationChanged = null;
      this.context = null;
      this.playbackIsolated = false;
      this.master = null;
      this.transition = null;
      this.trackStrips = [];
      this.wave = null;
      this.timer = 0;
      this.presentationFrame = 0;
      this.visualSeconds = null;
      this.nextNoteIndex = 0;
      this.nextClickIndex = 0;
      this.scheduled = new Set();
      this.held = new Set();
      this.output = null;
      this.api = null;
      this.metronomeVolume = 0;
      this.loopStartSeconds = null;
      this.loopEndSeconds = null;
      this.allowLoopLeadIn = false;
      this.recordingLeadIn = null;
      this.takeReview = null;
      this.takeLayers = new Map();
      this.overdubLayerId = null;
      this.referenceLayers = new Map();
      this.pinnedTakeIds = new Set();
    }

    buildTempoSegments(raw) {
      const deduped = new Map();
      raw.forEach(([tick, bpm]) => deduped.set(Number(tick), Number(bpm)));
      if (!deduped.has(0)) deduped.set(0, Number(config.writtenTempo) || 120);
      const ordered = [...deduped].sort((left, right) => left[0] - right[0]);
      let seconds = 0;
      return ordered.map(([tick, bpm], index) => {
        if (index) {
          const [previousTick, previousBpm] = ordered[index - 1];
          seconds += ((tick - previousTick) * 60) / (previousBpm * this.division);
        }
        return { tick, bpm: Math.max(1, bpm), seconds };
      });
    }

    secondsAtTick(tick) {
      let low = 0;
      let high = this.tempoSegments.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (this.tempoSegments[middle].tick <= tick) low = middle + 1;
        else high = middle;
      }
      const segment = this.tempoSegments[Math.max(0, low - 1)];
      return segment.seconds + ((tick - segment.tick) * 60) / (segment.bpm * this.division);
    }

    tickAtSeconds(seconds) {
      let low = 0;
      let high = this.tempoSegments.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (this.tempoSegments[middle].seconds <= seconds) low = middle + 1;
        else high = middle;
      }
      const segment = this.tempoSegments[Math.max(0, low - 1)];
      return segment.tick + ((seconds - segment.seconds) * segment.bpm * this.division) / 60;
    }

    static measurePulses([start,duration,n=4,d=4], division, groups) {
      const group=groups?.[`${n}/${d}`];
      const grouped=Array.isArray(group) && group.every(v=>Number.isInteger(v) && v>0) && group.reduce((a,b)=>a+b,0)===n;
      const accents=new Set([0]);
      if (grouped) { let at=0; for (const size of group) { accents.add(at); at+=size; } }
      const stride=!grouped && d>=8 && n>3 && n%3===0 ? 3 : 1;
      const pulses=[];
      for (let beat=0;beat<n;beat+=stride) {
        const offset=beat*division*4/d;
        if (offset>=duration) break;
        const downbeat=beat===0, accent=accents.has(beat);
        const middle=grouped ? accent : n%2===0 && offset===duration/2;
        pulses.push({tick:start+offset,downbeat,accent,level:downbeat ? 0 : middle ? 1 : 2});
      }
      return pulses;
    }

    buildMetronomeEvents(measures) {
      const events = [];
      const beatTicks = this.division * 4 / (measures[0]?.[3] || 4);
      for (let beat = Math.round(-this.leadInTicks / beatTicks); beat > 0; beat--) {
        const tick = -beat * beatTicks;
        events.push({tick, time: this.secondsAtTick(tick), downbeat: false});
      }
      measures.forEach(measure => {
        for (const pulse of GuideEngine.measurePulses(measure,this.division,config.beatGroups)) {
          events.push({...pulse,time:this.secondsAtTick(pulse.tick)});
        }
      });
      return events.sort((left, right) => left.time - right.time);
    }

    attach(apiInstance) {
      this.api = apiInstance;
      this.output = apiInstance.player?.output || null;
      if (!this.output) throw new Error("External playback output is unavailable");
      const engineInstance = this;
      this.output.handler = {
        get backingTrackDuration() { return engineInstance.duration * 1000; },
        get playbackRate() { return engineInstance.rate; },
        set playbackRate(value) { engineInstance.setRate(value); },
        get masterVolume() { return 1; },
        set masterVolume(_value) {},
        seekTo(milliseconds) {
          const alphaTabRate = clamp(Number(engineInstance.api?.playbackSpeed) || engineInstance.rate, 0.25, 1.5);
          if (Math.abs(alphaTabRate - engineInstance.rate) > 0.000001) return;
          engineInstance.seek((milliseconds / 1000) * alphaTabRate);
        },
        play() { void engineInstance.play(); },
        pause() { engineInstance.pause(); },
      };
    }

    ensureAudio() {
      if (this.context) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable");
      const isolatedRate = isolatedPlaybackRate(AudioContextClass);
      try {
        this.context = new AudioContextClass(isolatedRate
          ? { latencyHint: "interactive", sampleRate: isolatedRate }
          : { latencyHint: "interactive" });
      } catch { this.context = new AudioContextClass(); }
      this.playbackIsolated = isolatedRate > 0 && this.context.sampleRate === isolatedRate;

      this.master = this.context.createGain();
      this.master.gain.value = 0.92;
      this.transition = this.context.createGain();
      this.transition.gain.value = 1;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 14;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.16;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      // MIDI retains its mix compressor. Fixed-gain recordings bypass it so
      // their phrasing is not flattened; the final limiter is a safety net.
      this.master.connect(compressor).connect(this.transition).connect(limiter).connect(this.context.destination);

      this.trackStrips = mixerParts.map(() => {
        const gain = this.context.createGain();
        const panner = typeof this.context.createStereoPanner === "function" ? this.context.createStereoPanner() : null;
        if (panner) gain.connect(panner).connect(this.master);
        else gain.connect(this.master);
        return { gain, panner };
      });
      const real = new Float32Array([0, 0, 0, 0, 0, 0]);
      const imaginary = new Float32Array([0, 1, 0.44, 0.20, 0.10, 0.04]);
      this.wave = this.context.createPeriodicWave(real, imaginary, { disableNormalization: false });
      this.updateMix(audibleTracks, trackVolumes, trackPans, true);
    }

    currentSeconds() {
      if (!this.playing || !this.context) return this.basePosition;
      return clamp(this.basePosition + (this.context.currentTime - this.anchorTime) * this.rate,
        Math.min(0, this.basePosition), this.duration);
    }

    presentationSeconds(now = performance.now()) {
      if (!this.playing || !this.context) return this.basePosition;
      const context = this.context;
      let audioTime = context.currentTime - Math.max(0, Number(context.baseLatency) || 0)
        - Math.max(0, Number(context.outputLatency) || 0);
      try {
        const stamp = context.getOutputTimestamp?.();
        const age = now - stamp?.performanceTime;
        if (stamp?.contextTime > 0 && stamp.performanceTime > 0 && age >= -20 && age < 250) {
          audioTime = stamp.contextTime + Math.max(0, age) / 1000;
        }
      } catch { /* Older browsers fall back to their reported output latency. */ }
      audioTime = Math.max(this.anchorTime, Math.min(context.currentTime, audioTime));
      return clamp(this.basePosition + (audioTime - this.anchorTime) * this.rate,
        Math.min(0, this.basePosition), this.duration);
    }

    startPresentation() {
      this.stopPresentation();
      const paint = () => {
        this.presentationFrame = 0;
        if (!this.playing) return;
        // Read the audio clock at paint time, never integrate delayed timer ticks.
        this.pushPosition(this.presentationSeconds());
        this.presentationFrame = requestAnimationFrame(paint);
      };
      this.presentationFrame = requestAnimationFrame(paint);
    }

    stopPresentation() {
      if (this.presentationFrame) cancelAnimationFrame(this.presentationFrame);
      this.presentationFrame = 0;
      this.api?.customCursorHandler?.release?.();
      this.onPresentationStopped?.();
    }

    async prepareAudio() {
      this.ensureAudio();
      if (this.context.state !== "running") await this.context.resume();
      if (this.context.state !== "running") throw new Error("Audio output is not running");
    }

    async startTransport({ allowLoopLeadIn = false, recordingLeadIn = null } = {}) {
      if (!this.api || this.playing || this.starting || this.preparing) return;
      if (this.beforeStart?.()) return;
      const request = ++this.transportRequest;
      this.preparing = true;
      this.onPreparationChanged?.();
      try {
        // Activate inside the gesture, before AlphaTab marks playback started.
        await this.prepareAudio();
        if (request === this.transportRequest) {
          this.allowLoopLeadIn = allowLoopLeadIn;
          this.recordingLeadIn = Number.isFinite(recordingLeadIn) ? recordingLeadIn
            : this.basePosition < 0 ? this.basePosition : null;
          if (this.basePosition >= this.duration - 0.005) this.api.tickPosition = 0;
          this.api.play();
        }
      } catch (error) {
        if (request !== this.transportRequest) return;
        console.error(error);
        showToast("Audio could not start", "error");
      } finally {
        if (request === this.transportRequest) {
          this.preparing = false;
          this.onPreparationChanged?.();
        }
      }
    }

    pauseTransport() {
      // AlphaTab can still be stopped while audio preparation is pending.
      this.pause();
      this.api?.pause();
    }

    toggleTransport() {
      if (this.playing || this.starting || this.preparing) this.pauseTransport();
      else void this.startTransport();
    }

    async play() {
      if (this.playing || this.starting) return;
      const request = ++this.startRequest;
      this.starting = true;
      try {
        await this.prepareAudio();
        if (request !== this.startRequest) return;
        // AlphaTab's initial cursor can land ~1 ms past zero. That rounding
        // offset must not make the scheduler discard every opening note.
        const leadIn = this.recordingLeadIn;
        this.recordingLeadIn = null;
        if (Number.isFinite(leadIn)) this.basePosition = leadIn;
        else if (Math.abs(this.basePosition) <= 0.002 || this.basePosition >= this.duration - 0.005) this.basePosition = 0;
        // Ordinary loop playback parks inside the loop. An explicit recording
        // start preserves the singer's position, including manual preparation.
        if (this.hasLoop() && !this.withinLoop(this.basePosition)
          && !Number.isFinite(leadIn)
          && !(this.allowLoopLeadIn && this.basePosition < this.loopStartSeconds)) this.basePosition = this.loopStartSeconds;
        this.allowLoopLeadIn = false;
        this.loopArmed = this.withinLoop(this.basePosition);
        this.playing = true;
        this.anchorTime = this.context.currentTime;
        this.onTransportChange?.("play");
        // A recording listener can cancel an unexpected play during count-in.
        if (request !== this.startRequest || !this.playing) return;
        this.resetScheduler(SCHEDULER_LEAD_SECONDS, {carryHeldNotes: Number.isFinite(leadIn)});
        window.clearInterval(this.timer);
        this.timer = window.setInterval(() => this.update(), SCHEDULER_INTERVAL_MS);
        this.update();
        this.startPresentation();
      } catch (error) {
        if (request !== this.startRequest) return;
        console.error(error);
        showToast("Audio could not start", "error");
        this.api?.pause();
      } finally {
        this.allowLoopLeadIn = false;
        if (request === this.startRequest) this.starting = false;
      }
    }

    pause() {
      this.allowLoopLeadIn = false;
      this.recordingLeadIn = null;
      this.onTransportChange?.("pause");
      ++this.startRequest;
      ++this.transportRequest;
      this.starting = false;
      if (this.preparing) {
        this.preparing = false;
        this.onPreparationChanged?.();
      }
      if (this.playing) this.basePosition = this.currentSeconds();
      this.playing = false;
      this.stopPresentation();
      window.clearInterval(this.timer);
      this.timer = 0;
      this.stopVoices();
    }

    seek(seconds) {
      // A seek goes where it was asked to go, even past the loop end: moving
      // out there is how the loop's end gets moved further out. Playback only
      // wraps once it has been inside the loop, so landing beyond it plays on
      // instead of snapping straight back.
      const requested = clamp(seconds, this.secondsAtTick(this.leadInTicks), this.duration);
      if (Math.abs(requested - this.currentSeconds()) > 0.02) this.onTransportChange?.("seek");
      this.basePosition = requested;
      this.loopArmed = this.withinLoop(requested);
      if (this.context) this.anchorTime = this.context.currentTime;
      this.stopVoices();
      if (this.playing) this.resetScheduler();
      this.pushPosition();
    }

    setRate(nextRate) {
      const next = clamp(Number(nextRate) || 1, 0.25, 1.5);
      if (Math.abs(next - this.rate) < 0.000001) return;
      this.onTransportChange?.("rate");
      this.basePosition = this.currentSeconds();
      this.rate = next;
      this.balanceTakeLayers();
      if (this.context) this.anchorTime = this.context.currentTime;
      if (this.playing && this.context && this.transition) {
        const now = this.context.currentTime;
        this.transition.gain.cancelScheduledValues(now);
        this.transition.gain.setValueAtTime(Math.max(0.0001, this.transition.gain.value), now);
        this.transition.gain.linearRampToValueAtTime(0.0001, now + 0.018);
        this.stopVoices(0.018);
        this.resetScheduler(0.045, { carryHeldNotes: true });
        this.transition.gain.setValueAtTime(0.0001, now + 0.026);
        this.transition.gain.linearRampToValueAtTime(1, now + 0.075);
      }
      this.pushPosition();
    }

    setMetronome(value) {
      this.metronomeVolume = clamp(Number(value) || 0, 0, METRONOME_VALUES.at(-1)) / 100;
      if (this.playing) this.nextClickIndex = this.findNext(this.clicks, this.currentSeconds(), "time");
    }

    setPracticeDivisi(track, line) {
      const key = this.practiceRoles.length ? `role:${track}` : "mixer";
      if (this.divisiPlaybackKey === key) return;
      this.divisiPlaybackKey = key;
      const routed = this.practiceRoles.length ? window.MeletePracticeRoutes.playbackNotes(this.notes, this.practiceRoles, track,
        tick => this.secondsAtTick(tick)) : this.notes;
      this.playbackNotes = window.MeleteDivisiMixer.route(routed, mixerParts,
        (notes, part, selectedLine) => divisiPlaybackNotes(notes, part, selectedLine, tick => this.secondsAtTick(tick)));
      if (this.playing && this.context) {
        this.basePosition = this.currentSeconds();
        this.anchorTime = this.context.currentTime;
        this.stopVoices(0.018);
        this.resetScheduler(0.028, { carryHeldNotes: true });
      }
    }

    setLoop(startTick, endTick) {
      const valid = Number.isFinite(startTick) && Number.isFinite(endTick) && endTick > startTick;
      const nextStart = valid ? this.secondsAtTick(startTick) : null;
      const nextEnd = valid ? this.secondsAtTick(endTick) : null;
      if (nextStart !== this.loopStartSeconds || nextEnd !== this.loopEndSeconds) {
        this.onTransportChange?.("range");
        this.stopTakeReviewAudio();
      }
      if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick <= startTick) {
        this.loopStartSeconds = null;
        this.loopEndSeconds = null;
        return;
      }
      this.loopStartSeconds = this.secondsAtTick(startTick);
      this.loopEndSeconds = this.secondsAtTick(endTick);
      this.loopArmed = this.withinLoop(this.currentSeconds());
      if (this.playing && (this.currentSeconds() < this.loopStartSeconds || this.currentSeconds() >= this.loopEndSeconds)) this.seek(this.loopStartSeconds);
    }

    hasLoop() { return Number.isFinite(this.loopStartSeconds) && Number.isFinite(this.loopEndSeconds); }

    withinLoop(position) {
      return this.hasLoop() && position >= this.loopStartSeconds && position < this.loopEndSeconds;
    }

    playbackEndSeconds(position = this.currentSeconds()) {
      return this.hasLoop() && (this.loopArmed || position < this.loopEndSeconds)
        ? this.loopEndSeconds : this.duration;
    }

    updateMix(audible, volumes, pans, immediate = false) {
      if (!this.context || !this.trackStrips.length) return;
      const now = this.context.currentTime;
      this.trackStrips.forEach((strip, index) => {
        const target = audible.has(index) ? clamp((Number(volumes[index]) || 0) / 100, 0, VOLUME_VALUES.at(-1) / 100) : 0;
        strip.gain.gain.cancelScheduledValues(now);
        if (immediate) strip.gain.gain.setValueAtTime(target, now);
        else strip.gain.gain.setTargetAtTime(target, now, 0.012);
        if (strip.panner) {
          const pan = clamp((Number(pans[index]) || 0) / 100, -1, 1);
          strip.panner.pan.cancelScheduledValues(now);
          if (immediate) strip.panner.pan.setValueAtTime(pan, now);
          else strip.panner.pan.setTargetAtTime(pan, now, 0.018);
        }
      });
    }

    findNext(items, position, field) {
      // Tick-to-time conversions can round an exact onset slightly into the past.
      const boundary = position - 0.000001;
      let low = 0;
      let high = items.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (items[middle][field] < boundary) low = middle + 1;
        else high = middle;
      }
      return low;
    }

    // Earlier held notes stay silent on a fresh start, except a slurred phrase:
    // its later written notes must still sound when seeking inside it.
    // Speed/mix changes carry all held notes without changing the transport.
    resetScheduler(minimumLead = SCHEDULER_LEAD_SECONDS, { carryHeldNotes = false } = {}) {
      this.scheduleTakeReview(minimumLead);
      const position = this.basePosition;
      const notes = this.playbackNotes || this.notes;
      this.nextNoteIndex = this.findNext(notes, position, "start");
      this.nextClickIndex = this.findNext(this.clicks, position, "time");
      notes.slice(0, this.nextNoteIndex).forEach((note) => {
        if ((carryHeldNotes || note.segments) && note.end > position) this.scheduleNote(note, position, minimumLead);
      });
      this.scheduleAhead(minimumLead);
    }

    scheduleAhead(minimumLead = SCHEDULER_LEAD_SECONDS) {
      if (!this.playing || !this.context) return;
      this.scheduleTakeReview(minimumLead);
      const position = this.currentSeconds();
      const limit = Math.min(this.playbackEndSeconds(position), position + SCHEDULER_HORIZON_SECONDS * this.rate);
      const notes = this.playbackNotes || this.notes;
      while (this.nextNoteIndex < notes.length && notes[this.nextNoteIndex].start <= limit) {
        this.scheduleNote(notes[this.nextNoteIndex], position, minimumLead);
        this.nextNoteIndex += 1;
      }
      if (this.metronomeVolume > 0) {
        while (this.nextClickIndex < this.clicks.length && this.clicks[this.nextClickIndex].time <= limit) {
          this.scheduleClick(this.clicks[this.nextClickIndex], position, minimumLead);
          this.nextClickIndex += 1;
        }
      }
    }

    scheduleNote(note, position, minimumLead, limit = this.playbackEndSeconds(position), voices = this.scheduled) {
      if (!this.context || note.end <= position || note.start >= limit) return;
      const noteStart = Math.max(note.start, position);
      const noteEnd = Math.min(note.end, limit);
      const startDelay = Math.max(minimumLead, (noteStart - position) / this.rate);
      const endDelay = (noteEnd - position) / this.rate;
      if (endDelay <= startDelay + 0.001) return;
      const start = this.context.currentTime + startDelay;
      const end = this.context.currentTime + endDelay;
      const audibleFrom = position + startDelay * this.rate;
      const segments = note.segments?.filter(segment => segment.end > audibleFrom && segment.start < noteEnd)
        .map(segment => ({ ...segment, start: segment.start / this.rate, end: Math.min(segment.end, noteEnd) / this.rate }));
      if (segments && !segments.length) return;
      note = { ...note, ...(segments ? segments[0] : {}), start: noteStart / this.rate, end: noteEnd / this.rate, segments };
      const frequency = n => 440 * 2 ** ((n.key - 69) / 12);

      const oscillator = this.context.createOscillator();
      oscillator.setPeriodicWave(this.wave);
      this.pitchContour(oscillator.frequency, note, start, end, frequency);
      const vibrato = this.context.createOscillator();
      const vibratoDepth = this.context.createGain();
      vibrato.frequency.value = 5.05 + note.track * 0.08;
      vibratoDepth.gain.value = 3.8;
      vibrato.connect(vibratoDepth).connect(oscillator.detune);

      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      this.pitchContour(filter.frequency, note, start, end, n => clamp(frequency(n) * 5.2, 900, 5200));
      filter.Q.value = 0.48;
      const envelope = this.context.createGain();
      const levelFor = n => 0.112 * 10 ** (clamp((55 - n.key) * 0.72, 0, 9) / 20)
        * clamp((n.velocity || 84) / 84, 0.45, 1.28);
      const level = levelFor(note);
      const firstEnd = segments?.length > 1 ? end - (note.end - segments[0].end) : end;
      const lastDuration = segments ? segments.at(-1).end - segments.at(-1).start : end - start;
      const attackEnd = start + Math.min(0.026, (firstEnd - start) * 0.22);
      const releaseStart = Math.max(attackEnd, end - Math.min(0.058, lastDuration * 0.28));
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(level, attackEnd);
      if (segments) {
        const sustainAt = Math.min(releaseStart, attackEnd + Math.min(0.02, (firstEnd - attackEnd) * 0.25));
        this.sustainPhrase(envelope.gain, note, sustainAt, releaseStart, end, n => levelFor(n) * 0.88);
      } else envelope.gain.setValueAtTime(level * 0.88, releaseStart);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(filter).connect(envelope);
      if (note.mixChannels?.length) {
        const split = this.context.createGain();
        split.gain.value = 1 / note.mixChannels.length;
        envelope.connect(split);
        note.mixChannels.forEach(index => split.connect(this.trackStrips[index]?.gain || this.master));
      } else envelope.connect(this.trackStrips[note.track]?.gain || this.master);

      const voice = { oscillator, vibrato, envelope };
      voices.add(voice);
      oscillator.addEventListener("ended", () => voices.delete(voice), { once: true });
      vibrato.start(start);
      oscillator.start(start);
      vibrato.stop(end + 0.01);
      oscillator.stop(end + 0.01);
    }

    pitchContour(parameter, note, start, end, valueFor) {
      let value = valueFor(note), previousAt = start;
      parameter.setValueAtTime(value, start);
      for (const segment of (note.segments || []).slice(1)) {
        const at = end - (note.end - segment.start);
        // Get It Right's 3 ms glide arrives on the written onset, with no new attack.
        parameter.setValueAtTime(value, Math.max(previousAt, at - 0.003));
        value = valueFor(segment);
        parameter.exponentialRampToValueAtTime(value, at);
        previousAt = at;
      }
    }

    sustainPhrase(gain, note, from, until, end, levelFor) {
      let level = levelFor(note);
      gain.linearRampToValueAtTime(level, from);
      for (const segment of (note.segments || []).slice(1)) {
        const at = Math.max(from, Math.min(until, end - (note.end - segment.start)));
        gain.setValueAtTime(level, Math.max(from, at - 0.012));
        level = levelFor(segment);
        gain.linearRampToValueAtTime(level, at);
      }
      gain.setValueAtTime(level, until);
    }

    holdNote(key, track, { fullChord = false, channel } = {}) {
      this.ensureAudio();
      const resuming = this.context.state === "running" ? null : this.context.resume();
      const start = this.context.currentTime;
      const frequency = 440 * 2 ** ((key - 69) / 12);
      const oscillator = this.context.createOscillator();
      oscillator.setPeriodicWave(this.wave);
      oscillator.frequency.setValueAtTime(frequency, start);
      const vibrato = this.context.createOscillator();
      const vibratoDepth = this.context.createGain();
      vibrato.frequency.value = 5.05 + track * 0.08;
      vibratoDepth.gain.value = 3.8;
      vibrato.connect(vibratoDepth).connect(oscillator.detune);
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = clamp(frequency * 5.2, 900, 5200);
      filter.Q.value = 0.48;
      const envelope = this.context.createGain();
      const level = 0.112 * 10 ** (clamp((55 - key) * 0.72, 0, 9) / 20)
        / (fullChord ? Math.sqrt(Math.max(1, parts.length)) : 1);
      const attackEnd = start + 0.026;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(level, attackEnd);
      // The audition follows the part's own volume and pan, but a part turned
      // down to silence would otherwise have nothing to listen to, so that one
      // goes straight to the master instead. Full chords bypass vocal levels
      // and mutes while retaining pan, without changing the saved practice mix.
      channel ??= mixerParts.findIndex(p => p.source === track && (track !== practicePartIndex || p.line === practiceDivisi[track]));
      const strip = this.trackStrips[channel]?.gain;
      oscillator.connect(filter).connect(envelope)
        .connect(fullChord ? this.trackStrips[channel]?.panner || this.master
          : strip && strip.gain.value > 0.0005 ? strip : this.master);

      const voice = { oscillator, vibrato, envelope };
      this.held.add(voice);
      oscillator.start(start);
      vibrato.start(start);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.held.delete(voice);
        const now = this.context.currentTime;
        if (this.context.state !== "running") {
          // A released cold-start preview must not sound after resume resolves.
          try { oscillator.stop(now); } catch {}
          try { vibrato.stop(now); } catch {}
          return;
        }
        const gain = envelope.gain;
        // Preserve the attack's current level before canceling automation.
        const current = Math.max(0.0001, Number(gain.value) || 0.0001);
        if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
        else {
          gain.cancelScheduledValues(now);
          // Canceling its future endpoint also removes an unfinished attack.
          if (now < attackEnd) gain.exponentialRampToValueAtTime(current, now);
        }
        // A completed attack may leave no automation event at `now`. Anchor
        // the release explicitly so it cannot ramp from the old attack time.
        gain.setValueAtTime(current, now);
        gain.exponentialRampToValueAtTime(0.0001, now + PITCH_AUDITION_RELEASE_SECONDS);
        const silent = now + PITCH_AUDITION_RELEASE_SECONDS + 0.03;
        try { oscillator.stop(silent); } catch {}
        try { vibrato.stop(silent); } catch {}
      };
      if (resuming) void resuming.catch(release);
      return { release };
    }

    scheduleClick(click, position, minimumLead) {
      if (!this.context || click.time < position - 0.002) return;
      const start = this.context.currentTime + Math.max(minimumLead, (click.time - position) / this.rate);
      const oscillator = this.context.createOscillator();
      oscillator.type = "triangle";
      // Same short, fixed-pitch click as Solstice Auditions; no pitch sweep.
      oscillator.frequency.value = click.downbeat || click.accent ? 1320 : 880;
      const envelope = this.context.createGain();
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.metronomeVolume * 0.16), start + 0.003);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
      oscillator.connect(envelope).connect(this.master);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + 0.05);
    }

    setTakeReview(review) {
      const previous = this.takeReview;
      this.takeReview = review;
      if (previous && previous.id !== review?.id && !this.pinnedTakeIds.has(previous.id)) this.removeTakeLayer(previous.id);
      if (!review) return;
      this.addTakeLayer(review);
      this.takeReview = this.takeLayers.get(review.id);
    }

    get takeReviewSource() { return this.takeReview && this.takeLayers.get(this.takeReview.id)?.source || null; }

    addTakeLayer(review, pin = false, deferMix = false) {
      if (pin) this.pinnedTakeIds.add(review.id);
      const layers = review.reference ? this.referenceLayers : this.takeLayers;
      if (layers.has(review.id)) return;
      review.gain = this.context.createGain();
      review.gain.gain.value = review.reference ? (review.playbackGain || 1) : (review.loudness?.gain || 0);
      if (review.reference) {
        review.panner = this.context.createStereoPanner();
        review.panner.pan.value = review.pan || 0;
        review.gain.connect(review.panner).connect(this.master);
      } else {
        this.takeBus ||= window.MeleteTakeMix.bus(this.context, this.transition, takeReverbControl.value(), takeVolumeControl.value());
        review.gain.connect(this.takeBus.input);
      }
      // Native media playback provides pitch-preserving stretch when the current
      // practice speed differs. Matching-speed takes retain the sample-clock path.
      review.audio = new Audio();
      review.audio.preload = "auto";
      review.audio.preservesPitch = true;
      review.url = URL.createObjectURL(review.blob);
      review.audio.src = review.url;
      review.mediaSource = this.context.createMediaElementSource(review.audio);
      review.mediaSource.connect(review.gain);
      layers.set(review.id, review);
      review.octave = review.reference ? 0 : takeOctave(review.id);
      if (review.octave || review.reference) this.prepareTakeStretch(review);
      if (!deferMix) {
        if (!review.reference) this.balanceTakeLayers();
        this.scheduleTakeReview(SCHEDULER_LEAD_SECONDS);
      }
    }

    setTakeOctave(id, octave) {
      const review = this.takeLayers.get(id);
      if (!review) return;
      this.stopTakeLayerAudio(review);
      review.octave = octave;
      review.stretchFailed = false;
      if (octave) this.prepareTakeStretch(review);
      this.balanceTakeLayers();
      this.scheduleTakeReview(SCHEDULER_LEAD_SECONDS);
    }

    prepareTakeStretch(review) {
      if (review.stretchNode || review.stretchPending || review.stretchFailed) return;
      review.stretchPending = true;
      void window.MeleteTakeStretch.create(this.context, review.buffer).then(node => {
        if ((review.reference ? this.referenceLayers : this.takeLayers).get(review.id) !== review) { node.disconnect(); node.port.close(); return; }
        review.stretchNode = node;
        this.scheduleTakeReview(SCHEDULER_LEAD_SECONDS);
      }).catch(error => {
        if ((review.reference ? this.referenceLayers : this.takeLayers).get(review.id) !== review) return;
        review.stretchFailed = true;
        showToast(`${review.reference ? 'Reference' : 'Octave'} playback unavailable: ${error.message}. Original audio is unchanged.`, "error");
      }).finally(() => { review.stretchPending = false; updateTakePreview(); });
    }

    removeTakeLayer(id, deferMix = false) {
      const review = this.takeLayers.get(id) || this.referenceLayers?.get(id);
      this.pinnedTakeIds.delete(id);
      if (!review) return;
      this.stopTakeLayerAudio(review);
      review.stretchNode?.disconnect();
      review.stretchNode?.port.close();
      review.stretchNode = null;
      review.mediaSource.disconnect();
      review.gain.disconnect();
      review.panner?.disconnect();
      review.audio.removeAttribute("src");
      review.audio.load();
      URL.revokeObjectURL(review.url);
      this.takeLayers.delete(id);
      this.referenceLayers?.delete(id);
      if (!review.reference && !deferMix) this.balanceTakeLayers();
    }

    updateTakeLayers(add = [], remove = []) {
      const changed = remove.some(id => this.takeLayers.has(id)) || add.some(review => !this.takeLayers.has(review.id));
      for (const id of remove) this.removeTakeLayer(id, true);
      for (const review of add) this.addTakeLayer(review, true, true);
      if (changed) {
        this.balanceTakeLayers();
        this.scheduleTakeReview(SCHEDULER_LEAD_SECONDS);
      }
    }

    balanceTakeLayers() {
      this.takeBalanceRevision = (this.takeBalanceRevision || 0) + 1;
      if (!this.takeBus) return;
      // Safe while the complete, actually summed mix is measured. No live
      // envelope follower or per-phrase gain is used.
      this.takeBus.setNormalization(1 / Math.max(1, this.takeLayers.size));
      if (this.takeBalanceJob) return;
      this.takeBalanceJob = (async () => {
        let revision;
        do {
          revision = this.takeBalanceRevision;
          const layers = [...this.takeLayers.values()];
          if (!layers.length) break;
          for (const layer of layers) {
            layer.loudness ||= await window.MeleteTakeLoudness.track(layer.buffer);
            if (this.takeLayers.get(layer.id) === layer) layer.gain.gain.setTargetAtTime(layer.loudness.gain, this.context.currentTime, .03);
          }
          if (revision !== this.takeBalanceRevision) continue;
          const result = await window.MeleteTakeMix.prepare(layers.map(layer => ({...layer})), {
            duration:this.duration, rate:this.rate, reverb:takeReverbControl.value(), sampleRate:this.context.sampleRate});
          if (revision === this.takeBalanceRevision) {
            this.takeMixLoudness = result.normalization;
            this.takeBus.setNormalization(result.normalization.gain);
          }
        } while (revision !== this.takeBalanceRevision);
      })().catch(error => {
        for (const layer of this.takeLayers.values()) if (!layer.loudness) layer.gain.gain.setTargetAtTime(1, this.context.currentTime, .03);
        showToast(`${error.message}. Original recordings are unchanged.`, "error");
      }).finally(() => { this.takeBalanceJob = null; });
    }

    clearTakeLayers() {
      this.updateTakeLayers([], [...this.takeLayers.keys()]);
    }

    setOverdubTarget(key, singerId=null) {
      this.overdubLayerId = key == null ? null : 'comp:' + key;
      this.recordingSingerId=singerId;
      if (singerId) for(const layer of this.takeLayers.values()) if(layer.singerId!==singerId) this.stopTakeLayerAudio(layer);
      const prior = this.takeLayers.get(this.overdubLayerId);
      if (prior) this.stopTakeLayerAudio(prior);
    }

    stopTakeLayerAudio(review) {
      const source = review.source;
      review.source = null;
      if (!source) return;
      try { source.stop(); } catch {}
      source.disconnect();
    }

    stopTakeReviewAudio() {
      for (const review of this.takeLayers.values()) this.stopTakeLayerAudio(review);
      for (const review of this.referenceLayers?.values() || []) this.stopTakeLayerAudio(review);
    }

    takeReviewWindow(lead = 0, review = this.takeReview) {
      if (!review) return null;
      return window.MeleteRecording.takePlaybackWindow(review, this.currentSeconds(), this.rate,
        this.playbackEndSeconds(), lead);
    }

    scheduleTakeReview(minimumLead) {
      for (const review of this.takeLayers.values()) this.scheduleTakeLayer(review, minimumLead);
      for (const review of this.referenceLayers?.values() || []) this.scheduleTakeLayer(review, minimumLead);
    }

    scheduleTakeLayer(review, minimumLead) {
      if (!review || !this.playing || !this.context || (this.overdubLayerId && review.id === this.overdubLayerId)) return;
      if (this.recordingSingerId && !review.reference && review.singerId!==this.recordingSingerId) return;
      const window = this.takeReviewWindow(minimumLead, review);
      const current = review.source ? this.takeReviewWindow(0, review) : null;
      if (review.source?.stretch && (!current || this.context.currentTime >= review.source.endTime)) this.stopTakeLayerAudio(review);
      if (review.source?.media) {
        if (!current) this.stopTakeLayerAudio(review);
        else if (review.source.started && !review.audio.paused
          && Math.abs(review.audio.currentTime - current.from) > 0.08) {
          review.audio.currentTime = current.from;
        }
      }
      if (review.source || !window) return;
      if (review.octave || review.reference) {
        if (!review.stretchNode) { this.prepareTakeStretch(review); return; }
        const node = review.stretchNode, gate = this.context.createGain();
        const start = this.context.currentTime + window.delay;
        const endTime = start + (window.until - window.from) / window.ratio;
        const fade = Math.min(.003, (endTime - start) / 2);
        gate.gain.setValueAtTime(0, this.context.currentTime);
        gate.gain.setValueAtTime(0, start);
        gate.gain.linearRampToValueAtTime(1, start + fade);
        gate.gain.setValueAtTime(1, endTime - fade);
        gate.gain.linearRampToValueAtTime(0, endTime);
        node.connect(gate).connect(review.gain);
        // Buffered stretch compensates its own look-ahead; all layers use the
        // transport's AudioContext clock, not wall-clock timers or playbackRate pitch.
        void node.start({active: true, output: start, input: window.from,
          rate: window.ratio, semitones: review.octave * 12,
          formantSemitones: 0, formantCompensation: !review.reference});
        review.source = {stretch: true, endTime, stop: () => { void node.stop(); },
          disconnect: () => { node.disconnect(gate); gate.disconnect(); }};
        return;
      }
      if (Math.abs(window.ratio - 1) > 1e-6) {
        if (window.delay > SCHEDULER_HORIZON_SECONDS || review.audio.readyState < 1 || review.mediaFailed) return;
        const source = {media: true, started: false, stop: () => {
          clearTimeout(source.timer);
          review.audio.pause();
        }, disconnect() {}};
        review.source = source;
        source.timer = setTimeout(() => {
          if (review.source !== source || !this.playing) return;
          const next = this.takeReviewWindow(0, review);
          if (!next) { this.stopTakeLayerAudio(review); return; }
          review.audio.currentTime = next.from;
          review.audio.playbackRate = next.ratio;
          source.started = true;
          void review.audio.play().catch(() => {
            if (review.source !== source) return;
            this.stopTakeLayerAudio(review);
            review.mediaFailed = true;
            showToast("The recording could not play at this speed. Your practice settings are unchanged.", "error");
          });
        }, window.delay * 1000);
        return;
      }
      const source = this.context.createBufferSource();
      source.buffer = review.buffer;
      source.connect(review.gain);
      source.start(this.context.currentTime + window.delay, window.from, window.until - window.from);
      source.onended = () => {
        source.disconnect();
        if (review.source === source) review.source = null;
      };
      review.source = source;
    }

    stopVoices(release = 0.024) {
      this.stopTakeReviewAudio();
      this.releaseVoices(this.scheduled,release);
    }

    releaseVoices(voices, release = 0.024) {
      if (!this.context) return;
      const now = this.context.currentTime;
      const stopAt = now + release + 0.006;
      voices.forEach(({ oscillator, vibrato, envelope }) => {
        const gain = envelope.gain;
        if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
        else {
          const current = Math.max(0.0001, Number(gain.value) || 0.0001);
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(current, now);
        }
        gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.006, release));
        try { oscillator.stop(stopAt); } catch {}
        try { vibrato.stop(stopAt); } catch {}
      });
      voices.clear();
    }

    pushPosition(seconds = this.currentSeconds()) {
      // AlphaTab rewinds when handed the exact end. Keep its cursor on the
      // final chord while our own clock and elapsed-time display reach the end.
      const last = this.secondsAtTick(Math.max(0, this.endTick - Math.max(1, this.division / 16)));
      this.visualSeconds = seconds;
      this.onPresentation?.(seconds);
      this.output?.updatePosition((clamp(seconds, 0, last) / this.rate) * 1000);
      if (this.playing) this.api?.customCursorHandler?.sync?.(this.api.tickPosition);
    }

    update() {
      if (!this.playing) return;
      const position = this.currentSeconds();
      if (!this.loopArmed) this.loopArmed = this.withinLoop(position);
      if (this.loopArmed && this.hasLoop() && position >= this.loopEndSeconds - 0.002) {
        this.basePosition = this.loopStartSeconds;
        this.anchorTime = this.context.currentTime;
        this.onTransportChange?.("loop");
        this.stopVoices(0.012);
        this.resetScheduler(0.032);
        this.pushPosition();
        return;
      }
      if (position >= this.duration) {
        this.onTransportChange?.("end");
        this.playing = false;
        this.stopPresentation();
        window.clearInterval(this.timer);
        this.timer = 0;
        this.stopVoices();
        this.api?.pause();
        // Pausing AlphaTab seeks its external output to the last beat onset.
        // Restore the completed audio clock after that callback, not before it.
        this.basePosition = this.duration;
        this.pushPosition();
        return;
      }
      this.scheduleAhead();
    }
  }

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function firstLyricLetterRange(text) {
    const source = String(text || "");
    const letterMatch = source.match(/[\p{L}\p{N}]/u);
    const fallbackMatch = source.match(/\S/u);
    const match = letterMatch || fallbackMatch;
    if (!match) return { index: 0, length: Math.min(1, source.length) };
    const character = Array.from(source.slice(match.index))[0] || "";
    return { index: match.index, length: character.length };
  }

  function measuredSvgTextLength(element, start, length) {
    try {
      const measured = start === undefined
        ? element.getComputedTextLength()
        : element.getSubStringLength(start, length);
      if (Number.isFinite(measured)) return measured;
    } catch {
      // Fall through to a conservative estimate for unusual SVG engines.
    }
    const text = element.textContent || "";
    const portion = start === undefined ? text : text.slice(start, start + length);
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || LYRIC_FONT_SIZE;
    return portion.length * fontSize * 0.52;
  }

  function alignPitchBarLyricsToFirstLetter(systems) {
    systems.forEach(({ svg }) => {
      svg.querySelectorAll(".bar-lyric-text").forEach((lyricText) => {
        const text = lyricText.textContent || "";
        const onsetX = Number(lyricText.dataset.onsetX);
        const { index, length } = firstLyricLetterRange(text);
        const firstLetterWidth = measuredSvgTextLength(lyricText, index, length);
        const throughFirstLetterWidth = measuredSvgTextLength(lyricText, 0, index + length);
        const left = onsetX - (throughFirstLetterWidth - firstLetterWidth / 2);
        lyricText.setAttribute("x", String(left));
      });
    });
  }

  // A syllable is drawn on its note's onset, so wherever notes come quickly the
  // words run into each other. Holding the view wider would override the
  // Stretch setting across the whole score for the sake of a few crowded bars,
  // so a syllable that cannot fit beside its neighbour drops to the next line
  // instead and only the crowded places pay for it. Lanes are filled greedily
  // in reading order, which keeps everything on the first line wherever it
  // fits and lets a run of three crowded syllables use three lines rather than
  // ping-pong between two. The system grows by whatever lines it ends up using.
  // First fit, in reading order: a syllable takes the topmost line whose last
  // word ends far enough to its left, so everything stays on one line wherever
  // it fits and a crowded run steps down as far as it must.
  function assignLyricLanes(syllables, gap) {
    const laneEnds = [];
    const lanes = syllables.map((syllable) => {
      let lane = laneEnds.findIndex((end) => end + gap <= syllable.left);
      if (lane < 0) lane = laneEnds.push(-Infinity) - 1;
      laneEnds[lane] = syllable.left + syllable.width;
      return lane;
    });
    return { lanes, lineCount: Math.max(1, laneEnds.length) };
  }

  // A word-splitting hyphen only earns its width when the syllables it joins
  // are far enough apart to read as separate words anyway. Measured from the
  // last letter, the dash needs room for itself and as much again to sit in;
  // any tighter and it is about to touch what follows, so it goes, and
  // "Fa mil iar" on one line reads better than "Fa- iar" with "mil-" stranded
  // underneath. This runs before lanes are handed out, so the packing sees the
  // width the dashes give back.
  function relaxLyricHyphens(syllables) {
    syllables.forEach((syllable, index) => {
      const next = syllables[index + 1];
      if (!next || !syllable.hyphenWidth) return;
      const reach = next.left - (syllable.left + syllable.width - syllable.hyphenWidth);
      if (reach >= syllable.hyphenWidth * PITCH_BAR_HYPHEN_LEEWAY) return;
      syllable.width -= syllable.hyphenWidth;
      syllable.trimmed = true;
    });
  }

  // Dropping the hyphen does not always buy enough room, and a word broken
  // across two lines needs its dash back to still read as one word. Lanes are
  // settled by now, so a hyphen can return whenever its own lane has room for
  // it; where it does not, the overlap would be worse than the missing dash.
  // Keep the same readable gap when restoring a dash on an occupied lane.
  function restoreSplitWordHyphens(syllables, lanes, gap = 0) {
    const nextOnLane = new Map();
    const previousOnLane = new Map();
    syllables.forEach((syllable, index) => {
      const earlier = previousOnLane.get(lanes[index]);
      if (earlier !== undefined) nextOnLane.set(earlier, syllable);
      previousOnLane.set(lanes[index], index);
    });
    syllables.forEach((syllable, index) => {
      if (!syllable.trimmed || lanes[index + 1] === lanes[index]) return;
      const follower = nextOnLane.get(index);
      const limit = follower ? follower.left - gap : Infinity;
      if (syllable.left + syllable.width + syllable.hyphenWidth > limit) return;
      syllable.width += syllable.hyphenWidth;
      syllable.trimmed = false;
    });
  }

  function packPitchBarLyrics(systems) {
    systems.forEach(({ svg, lyricTop, lyricLineHeight, lyricVerses }) => {
      if (!lyricVerses?.length || !Number.isFinite(lyricTop)) return;
      const byVerse = new Map();
      svg.querySelectorAll(".bar-lyric-text").forEach((text) => {
        const verse = Number(text.dataset.verse) || 0;
        const written = text.dataset.syllable ?? text.textContent ?? "";
        const hyphenated = written.length > 1 && written.endsWith("-");
        text.dataset.syllable = written;
        text.textContent = written;
        let left = Number(text.getAttribute("x")) || 0;
        let width = measuredSvgTextLength(text);
        try {
          // Italic ink can extend past its advance, especially before a capital A.
          const ink = text.getBBox();
          if (Number.isFinite(ink.x) && Number.isFinite(ink.width) && ink.width > 0) {
            const right = Math.max(left + width, ink.x + ink.width);
            left = Math.min(left, ink.x);
            width = right - left;
          }
        } catch { /* Detached SVGs retain the conservative advance estimate. */ }
        if (!byVerse.has(verse)) byVerse.set(verse, []);
        byVerse.get(verse).push({
          text,
          written,
          left,
          width,
          hyphenWidth: hyphenated ? measuredSvgTextLength(text, written.length - 1, 1) : 0,
        });
      });

      let usedLines = 0;
      lyricVerses.forEach((verse) => {
        const syllables = (byVerse.get(verse) || []).sort((left, right) => left.left - right.left);
        const gap = lyricLineHeight * 0.15;
        relaxLyricHyphens(syllables);
        const { lanes, lineCount } = assignLyricLanes(syllables, gap);
        restoreSplitWordHyphens(syllables, lanes, gap);
        syllables.forEach((syllable, index) => {
          if (syllable.trimmed) syllable.text.textContent = syllable.written.slice(0, -1);
          syllable.text.setAttribute("y", String(lyricTop + (usedLines + lanes[index]) * lyricLineHeight));
        });
        usedLines += lineCount;
      });

      const box = (svg.getAttribute("viewBox") || "").split(" ").map(Number);
      if (box.length !== 4 || !box.every(Number.isFinite)) return;
      svg.setAttribute("viewBox", `${box[0]} ${box[1]} ${box[2]} ${lyricTop + usedLines * lyricLineHeight + 3}`);
    });
  }

  function pitchLabel(midi) {
    const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function pitchesOfClassInRange(minPitch, maxPitch, pitchClass) {
    const first = Math.ceil((minPitch - pitchClass) / 12) * 12 + pitchClass;
    const pitches = [];
    for (let pitch = first; pitch <= maxPitch; pitch += 12) pitches.push(pitch);
    return pitches;
  }

  function pitchGuideRange(baseMinPitch, baseMaxPitch) {
    const priorities = [
      { kind: "tonic", pitchClass: scoreKeyPitchClasses.tonic },
      { kind: "dominant", pitchClass: scoreKeyPitchClasses.dominant },
      { kind: "third", pitchClass: scoreKeyPitchClasses.third },
    ];
    const middle = (baseMinPitch + baseMaxPitch) / 2;
    for (const priority of priorities) {
      const available = pitchesOfClassInRange(baseMinPitch, baseMaxPitch, priority.pitchClass);
      if (!available.length) continue;
      const referencePitch = available.sort((left, right) =>
        Math.abs(left - middle) - Math.abs(right - middle) || left - right)[0];
      return { minPitch: baseMinPitch, maxPitch: baseMaxPitch, referencePitch, referenceKind: priority.kind };
    }

    // A very narrow range can miss all three harmonic anchors. Expand only
    // as far as needed to include the nearest tonic, fifth, or third; class
    // priority breaks equal-distance ties without wasting vertical space.
    const candidates = priorities.flatMap((priority, priorityIndex) =>
      pitchesOfClassInRange(baseMinPitch - 12, baseMaxPitch + 12, priority.pitchClass).map((pitch) => ({
        ...priority,
        pitch,
        priorityIndex,
        rangeDistance: pitch < baseMinPitch ? baseMinPitch - pitch : pitch > baseMaxPitch ? pitch - baseMaxPitch : 0,
        centerDistance: Math.abs(pitch - middle),
      })));
    candidates.sort((left, right) => left.rangeDistance - right.rangeDistance
      || left.priorityIndex - right.priorityIndex
      || left.centerDistance - right.centerDistance
      || left.pitch - right.pitch);
    const reference = candidates[0];
    return {
      minPitch: Math.min(baseMinPitch, reference.pitch),
      maxPitch: Math.max(baseMaxPitch, reference.pitch),
      referencePitch: reference.pitch,
      referenceKind: reference.kind,
    };
  }

  // A key signature names two keys, a major and its relative minor, and
  // MuseScore often exports the signature without saying which. Autumn is in
  // A minor but exports as bare "no sharps or flats", so the guides would
  // otherwise centre on C. The music decides: whichever of the two tonics the
  // piece actually dwells on, measured by how long its pitch class sounds.
  // Major keeps the benefit of the doubt unless the minor is clearly ahead.
  function soundsMinor(majorTonic) {
    const weights = new Map();
    for (const [, startTick, endTick, key] of sequence?.notes || []) {
      const pitchClass = ((key % 12) + 12) % 12;
      weights.set(pitchClass, (weights.get(pitchClass) || 0) + Math.max(0, endTick - startTick));
    }
    const major = weights.get(majorTonic) || 0;
    const relativeMinor = weights.get((majorTonic + 9) % 12) || 0;
    return relativeMinor > major * 1.2;
  }

  function configurePitchGuides(xml) {
    try {
      const documentXml = new DOMParser().parseFromString(xml, "application/xml");
      const fifths = Number([...documentXml.getElementsByTagName("*")]
        .find((element) => element.localName === "fifths")?.textContent || 0);
      // An absent mode is not a declaration of major; it is the question the
      // music has to answer below.
      const mode = String([...documentXml.getElementsByTagName("*")]
        .find((element) => element.localName === "mode")?.textContent || "").toLowerCase();
      const majorTonic = ((7 * fifths) % 12 + 12) % 12;
      const declared = mode.includes("minor") ? "minor" : mode.includes("major") ? "major" : null;
      const minor = declared ? declared === "minor" : soundsMinor(majorTonic);
      const tonic = minor ? (majorTonic + 9) % 12 : majorTonic;
      scoreKeyPitchClasses = {
        tonic,
        dominant: (tonic + 7) % 12,
        third: (tonic + (minor ? 3 : 4)) % 12,
      };
    } catch {
      scoreKeyPitchClasses = { tonic: 0, dominant: 7, third: 4 };
    }
  }

  function shortestPitchBarNoteTicks(xml, playback) {
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");
    let shortest = Infinity;
    // Use written durations, not MIDI gate lengths or time borrowed by grace
    // notes. Scan every part once so visibility and practice-part changes do
    // not change the horizontal scale.
    for (const part of documentXml.querySelectorAll("score-partwise > part")) {
      let divisions = 0;
      for (const measure of part.children) {
        for (const element of measure.children) {
          if (element.localName === "attributes") {
            const next = Number(element.querySelector("divisions")?.textContent);
            if (Number.isFinite(next) && next > 0) divisions = next;
          }
          if (element.localName !== "note" || !divisions
            || element.querySelector("rest, grace")) continue;
          const duration = Number(element.querySelector("duration")?.textContent);
          const ticks = duration / divisions * playback.division;
          if (Number.isFinite(ticks) && ticks > 0) shortest = Math.min(shortest, ticks);
        }
      }
    }
    if (Number.isFinite(shortest)) return shortest;
    for (const [, start, end] of playback.notes || []) {
      const duration = end - start;
      if (Number.isFinite(duration) && duration > 0) shortest = Math.min(shortest, duration);
    }
    return Number.isFinite(shortest) ? shortest : playback.division || 960;
  }

  function pitchBarRows(measures, pixelsPerTick, availableWidth, continuous) {
    const rows = [];
    let first = 0;
    while (first < measures.length) {
      const startTick = measures[first][0];
      let last = first;
      while (last + 1 < measures.length) {
        const next = measures[last + 1];
        if (!continuous && (next[0] + next[1] - startTick) * pixelsPerTick > availableWidth) break;
        last += 1;
      }
      const endTick = measures[last][0] + measures[last][1];
      rows.push({ first, measures: measures.slice(first, last + 1), startTick, endTick,
        plotWidth: (endTick - startTick) * pixelsPerTick });
      first = last + 1;
    }
    return rows;
  }

  function visiblePitchNotes() {
    return mixerParts.flatMap((part, channel) => visibleChannels.has(channel)
      ? part.barNotes.map(([start, end, pitch]) => [channel, start, end, pitch]) : []);
  }

  function buildPitchSegments(rawNotes) {
    const byPitch = new Map();
    rawNotes.forEach(([track, startTick, endTick, pitch]) => {
      const events = byPitch.get(pitch) || new Map();
      const event = (tick) => {
        if (!events.has(tick)) events.set(tick, { starts: [], ends: [] });
        return events.get(tick);
      };
      event(startTick).starts.push(track);
      event(endTick).ends.push(track);
      byPitch.set(pitch, events);
    });
    const segments = [];
    byPitch.forEach((events, pitch) => {
      const active = new Map();
      const ticks = [...events.keys()].sort((left, right) => left - right);
      for (let index = 0; index < ticks.length - 1; index += 1) {
        const tick = ticks[index];
        events.get(tick).ends.forEach((track) => {
          const count = (active.get(track) || 0) - 1;
          if (count > 0) active.set(track, count);
          else active.delete(track);
        });
        events.get(tick).starts.forEach((track) => active.set(track, (active.get(track) || 0) + 1));
        const endTick = ticks[index + 1];
        if (active.size && endTick > tick) {
          segments.push({ pitch, startTick: tick, endTick, tracks: [...active.keys()].sort((a, b) => a - b) });
        }
      }
    });
    return segments.sort((left, right) => left.startTick - right.startTick || left.pitch - right.pitch);
  }

  function buildPitchReattacks(rawNotes) {
    const endings = new Set(rawNotes.map(([track, , endTick, pitch]) => `${track}:${pitch}:${endTick}`));
    return rawNotes.flatMap(([track, startTick, , pitch]) =>
      endings.has(`${track}:${pitch}:${startTick}`) ? [{ track, tick: startTick, pitch }] : []);
  }

  function pitchBarLyrics() {
    if (!Number.isInteger(practicePartIndex) || practicePartIndex < 0 || practicePartIndex >= parts.length) return [];
    const track = practicePartIndex;
    const hidden = lyricsMode === "changes" ? sharedNotationTools.repeatedLyrics(sequence.lyrics || [], sequence.notes || [], sequence.division) : new Set();
    return (sequence.lyrics || []).flatMap((lyric) => {
      if (lyric[0] !== track || hidden.has(lyric)) return [];
      const text = String(lyric[3] || "").trim();
      const normalized = /^doo?m?$/iu.test(text) ? "doo" : text;
      const key = Number(lyric[2]) || 0;
      return [[track, Number(lyric[1]), key, normalized]];
    });
  }

  // Every beat boundary strictly inside a span, each with the weight of the
  // beat it falls on: the downbeat, the middle of the bar where the meter has
  // one, then the rest. The grid is the bar's and never the note's, so a
  // syncopated note's first tick comes wherever the next pulse falls rather
  // than a beat after its onset: these are for feeling the pulse, not for
  // counting off a note's own length. Anything shorter than a beat has none, so only notes
  // worth counting are marked, and nothing below the beat is marked at all —
  // a long note is counted in beats and bars, not in its subdivisions.
  // Compound meters count in dotted beats, the way they are conducted, rather
  // than in their notated eighths.
  function beatTicksWithin(fromTick, toTick) {
    const ticks = [];
    for (let index = measureIndexAtTick(fromTick); index < sequence.measures.length; index += 1) {
      const measure = sequence.measures[index];
      if (measure[0] >= toTick) break;
      for (const {tick,level} of GuideEngine.measurePulses(measure,sequence.division,config.beatGroups)) {
        if (tick <= fromTick || tick >= toTick) continue;
        ticks.push({ tick, level });
      }
    }
    return ticks;
  }

  // A part's divisi, worked out from the notes: the build folds both encodings
  // — a second voice, and a chord inside one voice — into a single track, so
  // what is left to go on is how many pitches the part sounds at once. Lines
  // are numbered from the top, the way divisi are labelled.
  function analysePartDivisi() {
    return parts.map((_, track) => {
      const notes = (sequence.notes || []).filter((note) => note[0] === track);
      const edges = [...new Set(notes.flatMap((note) => [note[1], note[2]]))].sort((a, b) => a - b);
      const spans = [];
      let maxLines = 1;
      for (let index = 0; index < edges.length - 1; index += 1) {
        const [start, end] = [edges[index], edges[index + 1]];
        const pitches = [...new Set(notes.filter((note) => note[1] <= start && note[2] >= end).map((note) => note[3]))]
          .sort((a, b) => b - a);
        if (!pitches.length) continue;
        maxLines = Math.max(maxLines, pitches.length);
        const previous = spans.at(-1);
        // One span per stack, so a held chord is not chopped at its neighbours'
        // edges.
        if (previous && previous.end === start && previous.pitches.join() === pitches.join()) previous.end = end;
        else spans.push({ start, end, pitches });
      }
      return { maxLines, spans };
    });
  }

  // Which line to sing where the part divides into fewer lines than the singer
  // chose from. The position is kept proportional, so a middle voice stays in
  // the middle instead of being pushed to the floor and leaving the middle line
  // unsung; a singer who falls exactly between two lines goes to the lower one,
  // which is the side that wants the extra body.
  function divisiLineFor(chosen, maxLines, available) {
    if (available <= 1 || maxLines <= 1) return 0;
    const position = clamp(chosen, 0, maxLines - 1) / (maxLines - 1);
    return clamp(Math.round(position * (available - 1)), 0, available - 1);
  }

  function divisiPlaybackNotes(notes, track, line, secondsAtTick) {
    const analysis = partDivisi[track];
    if (!Number.isInteger(track) || !Number.isInteger(line) || !analysis
      || analysis.maxLines < 2 || line < 0 || line >= analysis.maxLines) return notes;
    const spans = analysis.spans.map((span) => ({
      start: secondsAtTick(span.start), end: secondsAtTick(span.end),
      key: span.pitches[divisiLineFor(line, analysis.maxLines, span.pitches.length)],
    }));
    return notes.flatMap((note) => {
      if (note.track !== track) return [note];
      const source = note.segments || [note];
      const kept = [];
      // Split held notes only where the selected line changes. Keep contiguous
      // slur segments together so filtering does not replace legato with attacks.
      for (const segment of source) {
        let previous = null;
        for (const span of spans) {
          const start = Math.max(segment.start, span.start);
          const end = Math.min(segment.end, span.end);
          if (span.key !== segment.key || end - start <= 1e-7) continue;
          if (previous && Math.abs(previous.end - start) < 1e-7) previous.end = end;
          else {
            previous = { ...segment, start, end };
            kept.push(previous);
          }
        }
      }
      if (kept.length === source.length && kept.every((segment, index) =>
        Math.abs(segment.start - source[index].start) < 1e-7
        && Math.abs(segment.end - source[index].end) < 1e-7)) return [note];
      const groups = [];
      for (const segment of kept) {
        const group = groups.at(-1);
        if (group && Math.abs(group.at(-1).end - segment.start) < 1e-7) group.push(segment);
        else groups.push([segment]);
      }
      return groups.map((segments) => segments.length === 1 ? segments[0]
        : { ...segments[0], end: segments.at(-1).end, segments });
    }).sort((left, right) => left.start - right.start || left.track - right.track);
  }

  function divisiSpanAt(track, tick) {
    const spans = partDivisi[track]?.spans || [];
    let low = 0;
    let high = spans.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (spans[middle].end <= tick) low = middle + 1;
      else high = middle;
    }
    const span = spans[low];
    return span && span.start <= tick ? span : null;
  }

  function pitchStripe(defs, systemIndex, tracks, cache) {
    if (tracks.length === 1) return mixerParts[tracks[0]].color;
    const key = tracks.join("-");
    if (cache.has(key)) return cache.get(key);
    const id = `pitch-stripe-${systemIndex}-${key}`;
    const pattern = createSvgElement("pattern", { id, width: tracks.length * 6, height: 6, patternUnits: "userSpaceOnUse" });
    tracks.forEach((track, index) => {
      const stripe = createSvgElement("rect", { x: index * 6, y: 0, width: 6, height: 6 });
      stripe.style.fill = mixerParts[track].color;
      pattern.append(stripe);
    });
    defs.append(pattern);
    const fill = `url(#${id})`;
    cache.set(key, fill);
    return fill;
  }

  // The pitch a singer is meant to be on. With a part chosen there is a real
  // answer, so it is graded against that part alone, and against the chosen
  // line where the part divides: singing the other line, or another part
  // altogether, is exactly what a singer wants to be told about. With no part
  // chosen there is no "mine", so the nearest note on screen stands in.
  let pitchNoteSource = null, pitchNoteCount = 0, pitchNotesByPart = new Map();
  let restTraceSource = null;
  const restTraceReferences = new Map();
  function pitchRestState(tick, part = practicePartIndex, line = practiceDivisi[part] ?? null) {
    if (tick < 0 && tick >= pitchTraceOriginTick()) return "preparation";
    if (!Number.isInteger(part) || !partDivisi[part] || !engine) return "sing";
    if (restTraceSource !== sequence.notes) { restTraceSource = sequence.notes; restTraceReferences.clear(); }
    const key = `${part}:${line}`;
    if (!restTraceReferences.has(key)) restTraceReferences.set(key,
      window.MeleteTakePitch.reference({spans: partDivisi[part].spans.map(span => ({...span, pitches: Number.isInteger(line)
        ? [span.pitches[divisiLineFor(line, partDivisi[part].maxLines, span.pitches.length)]] : span.pitches})),
        secondsAtTick: t => engine.secondsAtTick(t), start: 0, end: sequence.endTick, rate: 1,
        fingerprint: "display", part, line, measures: sequence.measures, division: sequence.division}));
    const ref = restTraceReferences.get(key), seconds = engine.secondsAtTick(tick);
    if (!window.MeleteTakePitch.containsTime(ref.restPolicy.keep, seconds)) return "discard";
    return window.MeleteTakePitch.containsTime(ref.restPolicy.guards, seconds) ? "rest" : "sing";
  }
  function expectedPitchAt(tick, line = practiceDivisi[practicePartIndex] ?? null, part = practicePartIndex) {
    const mine = Number.isInteger(part);
    if (pitchNoteSource !== sequence.notes || pitchNoteCount !== sequence.notes?.length) {
      pitchNoteSource = sequence.notes; pitchNoteCount = sequence.notes?.length; pitchNotesByPart = new Map();
      for (const note of sequence.notes || []) {
        if (!pitchNotesByPart.has(note[0])) pitchNotesByPart.set(note[0], []);
        pitchNotesByPart.get(note[0]).push(note);
      }
    }
    const pool = mine ? (pitchNotesByPart.get(part) || [])
      : (sequence.notes || []).filter(([track]) => visibleTracks.has(track));
    let candidates = pool.filter(([, startTick, endTick]) => tick >= startTick && tick < endTick);
    // A contour recorded on one line is judged against that line, so drifting
    // onto the other one reads as the wrong note rather than as a second take.
    if (mine && candidates.length > 1 && Number.isInteger(line)) {
      const span = divisiSpanAt(part, tick);
      const lines = partDivisi[part]?.maxLines || 1;
      if (span && span.pitches.length > 1 && lines > 1) {
        const wanted = span.pitches[divisiLineFor(line, lines, span.pitches.length)];
        const onThatLine = candidates.filter((note) => note[3] === wanted);
        if (onThatLine.length) candidates = onThatLine;
      }
    }
    if (!candidates.length) {
      // Between phrases, hold the last note of whatever is being graded rather
      // than letting the trace drift to some other part's note.
      const latestEnd = pool.reduce((latest, [, , endTick]) => endTick <= tick ? Math.max(latest, endTick) : latest, -1);
      if (latestEnd >= 0) candidates = pool.filter(([, , endTick]) => endTick === latestEnd);
      else if (mine) {
        const nextStart = pool.reduce((next, [, startTick]) => startTick > tick ? Math.min(next, startTick) : next, Infinity);
        candidates = pool.filter(([, startTick]) => startTick === nextStart);
      }
    }
    if (mine && Number.isInteger(line) && candidates.length > 1) {
      const pitches = [...new Set(candidates.map(n => n[3]))].sort((a, b) => b - a);
      const wanted = pitches[divisiLineFor(line, partDivisi[part]?.maxLines || 1, pitches.length)];
      candidates = candidates.filter(n => n[3] === wanted);
    }
    return candidates;
  }

  function expectedPitchErrorCents(tick, pitchCents, line = practiceDivisi[practicePartIndex] ?? null, part = practicePartIndex) {
    if (pitchRestState(tick, part, line) !== "sing") return null;
    const candidates = expectedPitchAt(tick, line, part);
    if (!candidates.length) return null;
    return candidates.reduce((best, note) => {
      const error = window.MeleteTakePitch.octaveError(pitchCents - note[3] * 100);
      return best === null || Math.abs(error) < Math.abs(best) ? error : best;
    }, null);
  }

  function pitchTraceColor(errorCents) {
    if (errorCents === "preparation") return "var(--muted)";
    if (!Number.isFinite(errorCents)) return "rgb(255 0 0)";
    const distance = clamp(
      (Math.abs(window.MeleteTakePitch.octaveError(errorCents)) - PITCH_TRACE_GREEN_TOLERANCE_CENTS) /
        (PITCH_TRACE_RED_CENTS - PITCH_TRACE_GREEN_TOLERANCE_CENTS),
      0,
      1,
    );
    const red = Math.round(distance * 255);
    return `rgb(${red} ${255 - red} 0)`;
  }

  function pitchTraceBinTicks() {
    return (Number(sequence?.division) || 1) / PITCH_TRACE_BINS_PER_QUARTER;
  }

  function pitchTraceBinCount() {
    return Math.max(1, Math.ceil(((Number(sequence?.endTick) || 0) - pitchTraceOriginTick()) / pitchTraceBinTicks()) + 1);
  }

  function countInBeats() { return Math.max(1, Math.min(16, Number(config.recordingCountInBeats) || 4)); }
  function pitchTraceOriginTick() {
    return -countInBeats() * (Number(sequence?.division) || 1) * 4 / (sequence?.measures?.[0]?.[3] || 4);
  }

  function pitchTraceBinAtTick(tick, stride = 1) {
    const bin = Math.round(((Number(tick) || 0) - pitchTraceOriginTick()) / (pitchTraceBinTicks() * stride)) * stride;
    return clamp(bin, 0, pitchTraceBinCount() - 1);
  }

  function pitchTraceStrideAt(tick, hopMs) {
    const segments = engine.tempoSegments;
    let tempo = segments[0];
    for (const candidate of segments) {
      if (candidate.tick > tick) break;
      tempo = candidate;
    }
    const binMs = 60000 / tempo.bpm / engine.rate / PITCH_TRACE_BINS_PER_QUARTER;
    const minimumMs = Math.max(PITCH_CAPTURE_INTERVAL_MS, Number(hopMs) || 0);
    // Round duration upward, never samples/beat upward. The finest storage
    // grid stays stable across tempo/speed changes; coarser captures are sparse.
    return 2 ** Math.max(0, Math.ceil(Math.log2(minimumMs / binMs) - 1e-9));
  }

  function pitchTraceLane(line, { create = false } = {}) {
    const existing = pitchTraceLanes.get(line);
    if (existing || !create) return existing || null;
    const bins = pitchTraceBinCount();
    const lane = { pitches: new Uint16Array(bins), breaks: new Uint8Array(bins) };
    pitchTraceLanes.set(line, lane);
    return lane;
  }

  const pitchTraceLaneList = () => [...pitchTraceLanes.entries()].sort(([left], [right]) => left - right);

  // A practice target is a fixed division, never whichever line is nearest
  // to the sung pitch. The fallback is only for an unassigned display.
  function pitchTraceLaneAt(tick, cents, part = practicePartIndex) {
    if (!Number.isInteger(part)) return 0;
    if (Number.isInteger(practiceDivisi[part])) return practiceDivisi[part];
    const lines = partDivisi[part]?.maxLines || 1;
    if (lines < 2) return 0;
    const span = divisiSpanAt(part, tick);
    if (!span || span.pitches.length < 2) return 0;
    let nearest = 0;
    let smallest = Infinity;
    let nearestRegister = Infinity;
    span.pitches.forEach((pitch, index) => {
      const register = Math.abs(cents - pitch * 100);
      const error = Math.abs(window.MeleteTakePitch.octaveError(cents - pitch * 100));
      if (error < smallest || error === smallest && register < nearestRegister) {
        smallest = error;
        nearestRegister = register;
        nearest = index;
      }
    });
    // The nearest pitch is a position in this passage's stack; the lane is the
    // line that position stands for where the part divides furthest.
    return span.pitches.length === lines
      ? nearest
      : clamp(Math.round((nearest / (span.pitches.length - 1)) * (lines - 1)), 0, lines - 1);
  }

  function pitchTraceTickAtBin(bin) {
    return clamp(pitchTraceOriginTick() + bin * pitchTraceBinTicks(), pitchTraceOriginTick(), Number(sequence?.endTick) || 0);
  }

  function resetPitchTraceGrid() {
    pitchTraceLanes.clear();
    pitchTraceCount = 0;
    pitchOctaveHistory = [];
  }

  function previousOccupiedPitchBin(lane, bin) {
    for (let index = Math.min(bin - 1, lane.pitches.length - 1); index >= 0; index -= 1) {
      if (lane.pitches[index]) return index;
    }
    return -1;
  }

  function nextOccupiedPitchBin(lane, bin) {
    for (let index = Math.max(0, bin + 1); index < lane.pitches.length; index += 1) {
      if (lane.pitches[index]) return index;
    }
    return -1;
  }

  // Bounds are in score pixels, including clefs, octave transpositions and
  // accidentals. Keep a written staff position separate from sounding pitch.
  function buildStaffTraceSystems(lookup) {
    const rows = new Map();
    const references = new Map();
    sequence.measures.forEach(([startTick, duration], measureIndex) => {
      const master = lookup?.findMasterBarByIndex?.(measureIndex);
      const source = master?.staffSystemBounds;
      const box = source?.realBounds;
      if (!box || !(box.w > 0 && box.h > 0)) return;
      if (!rows.has(source.index)) rows.set(source.index, {
        box, startTick, endTick: startTick + duration, measures: new Map(), references,
      });
      const system = rows.get(source.index);
      system.endTick = startTick + duration;
      const measure = { startTick, endTick: startTick + duration, parts: new Map() };
      const columns = new Map();
      system.measures.set(measureIndex, measure);
      for (const bounds of master.bars || []) {
        const track = partIndexForTrack(bounds.bar?.staff?.track);
        const staff = bounds.bar?.staff;
        const staffBox = bounds.visualBounds;
        if (!visibleTracks.has(track) || staff?.isPercussion || !staffBox?.h) continue;
        const lineCount = Number(staff.standardNotationLineCount) || 5;
        if (lineCount < 2) continue;
        const step = staffBox.h / (2 * (lineCount - 1));
        for (const beat of bounds.beats || []) {
          const tick = performedScoreTick(Number(beat.beat?.absolutePlaybackStart));
          if (!Number.isFinite(tick)) continue;
          const notes = (beat.notes || []).filter((note) => note.noteHeadBounds
            && Number.isFinite(note.note?.realValue));
          const x = notes.length ? Math.min(...notes.map((note) => note.noteHeadBounds.x)) : beat.realBounds?.x;
          const previous = columns.get(tick);
          const hasHead = notes.length > 0;
          if (Number.isFinite(x) && (!previous || hasHead && !previous.hasHead
            || hasHead === previous.hasHead && x < previous.x)) {
            columns.set(tick, { tick, x, hasHead });
          }
          for (const note of notes) {
            const head = note.noteHeadBounds;
            const key = `${track}:${note.note.realValue}`;
            if (!references.has(key)) references.set(key, []);
            references.get(key).push({
              tick, staffIndex: staff.index,
              staffPosition: (head.y + head.h / 2 - staffBox.y) / step,
            });
          }
        }
        if (!measure.parts.has(track)) measure.parts.set(track, new Map());
        measure.parts.get(track).set(staff.index, { top: staffBox.y, step });
      }
      measure.anchors = [...columns.values()].sort((a, b) => a.tick - b.tick);
      if (!measure.anchors.length) measure.anchors.push({ tick: startTick, x: master.realBounds.x });
      measure.anchors.push({ tick: startTick + duration, x: master.realBounds.x + master.realBounds.w });
    });
    references.forEach((notes) => notes.sort((a, b) => a.tick - b.tick));
    return [...rows.values()];
  }

  function staffTracePoint(system, tick, cents, line, part = practicePartIndex) {
    if (tick < system.startTick || tick >= system.endTick) return null;
    const rest = pitchRestState(tick, part, line);
    if (rest === "discard") return null;
    const measure = system.measures.get(measureIndexAtTick(tick));
    const target = expectedPitchAt(tick, line, part).filter(([track]) => measure?.parts.has(track))
      .sort((a, b) => Math.abs(window.MeleteTakePitch.octaveError(cents - a[3] * 100))
        - Math.abs(window.MeleteTakePitch.octaveError(cents - b[3] * 100))
        || Math.abs(cents - a[3] * 100) - Math.abs(cents - b[3] * 100))[0];
    if (!target) return null;
    const [track, , , pitch] = target;
    const notes = system.references.get(`${track}:${pitch}`) || [];
    let low = 0, high = notes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (notes[middle].tick <= tick) low = middle + 1;
      else high = middle;
    }
    const reference = notes[Math.max(0, low - 1)];
    const staff = reference && measure.parts.get(track)?.get(reference.staffIndex);
    if (!staff) return null;
    const anchors = measure.anchors;
    let x = anchors[0].x;
    for (let index = 1; index < anchors.length; index++) {
      const left = anchors[index - 1], right = anchors[index];
      const fraction = clamp((tick - left.tick) / Math.max(1, right.tick - left.tick), 0, 1);
      x = left.x + fraction * (right.x - left.x);
      if (tick < right.tick) break;
    }
    const error = window.MeleteTakePitch.octaveError(cents - pitch * 100);
    return { x, y: staff.top + (reference.staffPosition - error / STAFF_TRACE_CENTS_PER_STEP) * staff.step,
      track, error: rest === "rest" ? null : error };
  }

  function renderStaffPitchTrace() {
    if (scoreView !== "standard" || notationRenderInFlight) return;
    const lookup = api?.boundsLookup || api?.renderer?.boundsLookup;
    staffTraceSystems = buildStaffTraceSystems(lookup);
    elements.score.querySelectorAll(".score-pitch-trace").forEach((layer) => layer.remove());
    staffTraceSystems.forEach((system) => {
      const { x, y, w, h } = system.box;
      const svg = createSvgElement("svg", {
        class: "score-pitch-trace", viewBox: `${x} ${y} ${w} ${h}`,
        width: w, height: h, "aria-hidden": "true",
      });
      svg.style.left = `${x}px`;
      svg.style.top = `${y}px`;
      system.traceLayer = createSvgElement("g", { class: "bar-pitch-trace-layer" });
      system.traceEdges = new Map();
      system.traceEdgesByBin = new Map();
      system.pointAtPitch = (tick, cents, line, part) => staffTracePoint(system, tick, cents, line, part);
      svg.append(system.traceLayer);
      system.traceSvg = svg;
    });
    mountStaffPitchTraces();
    renderPitchTrace(staffTraceSystems);
  }

  function mountStaffPitchTraces() {
    // AlphaTab attaches/recycles SVG tiles after renderFinished. Reattach the
    // existing contour when a tile arrives; no new paths or pitch analysis.
    if (scoreView !== "standard") return;
    const surfaces = [...elements.score.querySelectorAll(".at-surface-svg")].map(svg => ({svg,
      left:parseFloat(svg.parentElement.style.left) || 0, top:parseFloat(svg.parentElement.style.top) || 0,
      height:parseFloat(svg.getAttribute("height")) || 0}));
    for (const system of staffTraceSystems) {
      const {x,y,w,h} = system.box, trace = system.traceSvg;
      const surface = surfaces.find(s => y + h / 2 >= s.top - 1 && y + h / 2 <= s.top + s.height + 1);
      if (!surface || !trace || trace.parentElement === surface.svg) continue;
      let staff = surface.svg.querySelector(":scope > .melete-staff-lines");
      if (!staff) {
        staff = createSvgElement("g", {class:"melete-staff-lines"});
        for (const line of surface.svg.querySelectorAll(':scope > rect[fill="#A5A5A5"]')) staff.append(line);
        surface.svg.prepend(staff);
      }
      trace.setAttribute("x", x - surface.left); trace.setAttribute("y", y - surface.top);
      trace.style.removeProperty("left"); trace.style.removeProperty("top");
      staff.after(trace);
    }
  }

  function occupiedPitchBinsForSystem(lane, system) {
    const first = clamp(Math.ceil((system.startTick - pitchTraceOriginTick()) / pitchTraceBinTicks()), 0, lane.pitches.length - 1);
    const last = clamp(Math.floor((system.endTick - pitchTraceOriginTick()) / pitchTraceBinTicks()), first, lane.pitches.length - 1);
    const bins = [];
    for (let bin = first; bin <= last; bin += 1) {
      if (lane.pitches[bin]) bins.push(bin);
    }
    return bins;
  }

  function pitchTraceBinIsInSystem(system, bin) {
    const tick = pitchTraceTickAtBin(bin);
    return tick >= system.startTick && tick <= system.endTick;
  }

  function removePitchTraceEdge(system, key) {
    const edge = system.traceEdges?.get(key);
    if (!edge) return;
    const fromBin = Number(edge.dataset.fromBin);
    const toBin = Number(edge.dataset.toBin);
    edge.remove();
    system.traceEdges.delete(key);
    const line = edge.dataset.line;
    [fromBin, toBin].forEach((bin) => {
      const keys = system.traceEdgesByBin.get(`${line}:${bin}`);
      keys?.delete(key);
      if (!keys?.size) system.traceEdgesByBin.delete(`${line}:${bin}`);
    });
  }

  function removePitchTraceEdgesAtBin(system, line, bin) {
    [...(system.traceEdgesByBin?.get(`${line}:${bin}`) || [])].forEach((key) => removePitchTraceEdge(system, key));
  }

  function appendPitchTraceEdge(system, line, lane, fromBin, toBin) {
    if (!liveTraceVisible()) return;
    const key = `${line}:${fromBin}:${toBin}`;
    if (system.traceEdges?.has(key)) return;
    const fromCents = lane.pitches[fromBin];
    const toCents = lane.pitches[toBin];
    if (!fromCents || !toCents || lane.breaks[toBin]) return;
    const fromTick = pitchTraceTickAtBin(fromBin);
    const toTick = pitchTraceTickAtBin(toBin);
    if (pitchRestState(fromTick) === "discard" || pitchRestState(toTick) === "discard") return;
    const fromSeconds = engine.secondsAtTick(fromTick);
    const toSeconds = engine.secondsAtTick(toTick);
    const gap = Math.abs(toSeconds - fromSeconds);
    if (gap > PITCH_TRACE_MAX_DRAW_GAP_SECONDS || Math.abs(toCents - fromCents) > PITCH_TRACE_RENDER_JUMP_CENTS) return;
    const startPitch = fromCents / 100, endPitch = toCents / 100;
    if (Math.min(startPitch, endPitch) < system.minPitch || Math.max(startPitch, endPitch) > system.maxPitch) return;
    const x1 = system.xAtTick(fromTick), y1 = system.yAtPitch(startPitch);
    const x2 = system.xAtTick(toTick), y2 = system.yAtPitch(endPitch);
    const traceColor = toTick < 0 ? "var(--muted)" : pitchTraceColor(expectedPitchErrorCents(toTick, toCents, line));
    const edge = createSvgElement("g", {
      class: "bar-pitch-trace-edge",
      "data-line": line,
      "data-from-bin": fromBin,
      "data-to-bin": toBin,
      "aria-hidden": "true",
    });
    edge.append(
      createSvgElement("line", { class: "bar-pitch-trace-halo", x1, y1, x2, y2 }),
      createSvgElement("line", { class: "bar-pitch-trace", x1, y1, x2, y2, stroke: traceColor }),
    );
    system.traceLayer.append(edge);
    system.traceEdges.set(key, edge);
    [fromBin, toBin].forEach((bin) => {
      const indexKey = `${line}:${bin}`;
      if (!system.traceEdgesByBin.has(indexKey)) system.traceEdgesByBin.set(indexKey, new Set());
      system.traceEdgesByBin.get(indexKey).add(key);
    });
  }

  function pitchTraceRange(startTick, endTick) {
    let min = Infinity, max = -Infinity;
    const reviews = audibleTraceReviews();
    const include = cents => {
      if (!Number.isFinite(cents)) return;
      min = Math.min(min, cents / 100); max = Math.max(max, cents / 100);
    };
    for (const [, lane] of liveTraceVisible() ? pitchTraceLaneList() : []) {
      for (const bin of occupiedPitchBinsForSystem(lane, {startTick, endTick})) {
        if (pitchRestState(pitchTraceTickAtBin(bin)) === "discard") continue;
        include(lane.pitches[bin]);
      }
    }
    for (const review of reviews) {
      const [from, to] = window.MeleteTakeRender.frameRange(review.frames,
        (engine.secondsAtTick(startTick) - review.start) / review.rate,
        (engine.secondsAtTick(endTick) - review.start) / review.rate);
      for (let index = from; index < to; index++) {
        const cents = review.frames[index].cents;
        if (Number.isFinite(cents)) include(cents + (review.octave || 0) * 1200);
      }
    }
    return {min, max};
  }

  function renderPitchTrace(systems = scoreView === "bars" ? barSystems : staffTraceSystems) {
    if (scoreView === "bars" && barTraceResumeTimer) return;
    pitchTraceDirty.clear();
    const reviews = audibleTraceReviews();
    const ensemble = scoreView === "bars" && visibleChannels.size > 1;
    systems.forEach((system) => {
      system.traceLayer.replaceChildren();
      system.traceEdges.clear();
      system.traceEdgesByBin.clear();
      for (const review of reviews) renderTakeTrace(system, review, !ensemble && review.id !== takeReview?.id);
      (liveTraceVisible() ? pitchTraceLaneList() : []).forEach(([line, lane]) => {
        const bins = occupiedPitchBinsForSystem(lane, system);
        for (let index = 1; index < bins.length; index += 1) {
          appendPitchTraceEdge(system, line, lane, bins[index - 1], bins[index]);
        }
      });
    });
    updatePitchCaptureAppearance();
  }

  // `changed` maps a line to the bins that moved in it, so a take of one line
  // never redraws — or erases — another line's contour.
  function updatePitchTraceIncrementally(changed) {
    if (scoreView !== "bars" || barTraceResumeTimer) {
      updatePitchCaptureAppearance();
      return;
    }
    const systems = barSystems;
    if (!changed?.size || !systems.length) {
      updatePitchCaptureAppearance();
      return;
    }
    if (!recordingBarRanges && [...changed].some(([line, bins]) => [...bins].some(bin => {
      const pitch = pitchTraceLane(line)?.pitches[bin] / 100;
      return pitch > 0 && systems.some(system => pitchTraceBinIsInSystem(system, bin)
        && (pitch < system.minPitch || pitch > system.maxPitch));
    }))) {
      // Reflow only when a newly sung register needs room, never on every sample.
      if (!barRenderFrame) scheduleBarRender();
      return;
    }
    changed.forEach((bins, line) => {
      const lane = pitchTraceLane(line);
      if (!lane) return;
      const affected = new Set(bins);
      bins.forEach((bin) => {
        const previous = previousOccupiedPitchBin(lane, bin);
        const next = nextOccupiedPitchBin(lane, bin);
        if (previous >= 0) affected.add(previous);
        if (next >= 0) affected.add(next);
      });
      systems.forEach((system) => {
        affected.forEach((bin) => removePitchTraceEdgesAtBin(system, line, bin));
        affected.forEach((bin) => {
          if (!lane.pitches[bin] || !pitchTraceBinIsInSystem(system, bin)) return;
          const previous = previousOccupiedPitchBin(lane, bin);
          const next = nextOccupiedPitchBin(lane, bin);
          if (previous >= 0 && pitchTraceBinIsInSystem(system, previous)) appendPitchTraceEdge(system, line, lane, previous, bin);
          if (next >= 0 && pitchTraceBinIsInSystem(system, next)) appendPitchTraceEdge(system, line, lane, bin, next);
        });
      });
    });
    updatePitchCaptureAppearance();
  }

  // ||: and :|| drawn the way they are engraved — thick bar, thin bar, two
  // dots facing the music they enclose — sized to sit beside a measure number
  // without crowding it. `facing` is +1 for an opening sign drawn rightward
  // from the barline, -1 for a closing one drawn leftward.
  function pitchBarRepeatSign(barlineX, baseline, height, facing) {
    const thick = Math.max(1.1, height * 0.2);
    const thin = Math.max(0.55, height * 0.085);
    const gap = Math.max(0.9, height * 0.14);
    const dot = Math.max(0.6, height * 0.095);
    const top = baseline - height;
    const from = (offset, width) => facing > 0 ? barlineX + offset : barlineX - offset - width;
    const group = createSvgElement("g", { class: "bar-repeat-sign" });
    group.append(
      createSvgElement("rect", { x: from(0, thick), y: top, width: thick, height }),
      createSvgElement("rect", { x: from(thick + gap, thin), y: top, width: thin, height }),
    );
    const dotX = from(thick + gap + thin + gap, dot * 2) + dot;
    group.append(
      createSvgElement("circle", { cx: dotX, cy: top + height * 0.3, r: dot }),
      createSvgElement("circle", { cx: dotX, cy: top + height * 0.7, r: dot }),
    );
    return { group, width: thick + gap + thin + gap + dot * 2 };
  }

  function renderBarScore() {
    barRenderFrame = 0;
    if (!sequence?.measures?.length || !elements.barScore.clientWidth) return;
    stopBarPlayheadMotion();
    cancelPitchAuditions();
    cancelScoreScrub();
    const rawNotes = visiblePitchNotes();
    const segments = buildPitchSegments(rawNotes);
    const reattacks = buildPitchReattacks(rawNotes);
    const lyrics = pitchBarLyrics();
    const chapters = new Set(autoChapters().map((chapter) => measureIndexAtTick(chapter.tick)));
    const continuous = flow === "continuous";
    const availableWidth = elements.barScore.clientWidth;
    const pixelsPerTick = PITCH_BAR_UNIT_WIDTH * horizontalControl.value() / 100 / pitchBarUnitTicks;
    const typographyScale = verticalControl.value() / 100;
    const pitchStep = clamp(5.5 * typographyScale, 3, 10);
    const lyricFontSize = LYRIC_FONT_SIZE * typographyScale;
    const lyricLineHeight = 17.5 * typographyScale;
    const measureFontSize = 11 * typographyScale;
    const repeatSignHeight = measureFontSize * 0.78;
    const leftPad = 34;
    // Leave a gutter for the next-line pitch cues beyond the closing barline.
    const rightPad = pitchStep * 2 + 2;
    const measures = [[pitchTraceOriginTick(), -pitchTraceOriginTick(), countInBeats(), sequence.measures[0][3]], ...sequence.measures];
    const rows = pitchBarRows(measures, pixelsPerTick, availableWidth - leftPad - rightPad, continuous);
    rows.forEach(row => { row.first -= 1; });
    elements.barScore.classList.toggle("has-horizontal-overflow",
      rows.some((row) => row.plotWidth + leftPad + rightPad > availableWidth));
    elements.barScore.style.setProperty("--bar-measure-font-size", `${measureFontSize}px`);
    elements.barScore.style.setProperty("--bar-lyric-font-size", `${lyricFontSize}px`);
    const fragment = document.createDocumentFragment();
    const nextSystems = [];

    for (const [systemIndex, row] of rows.entries()) {
      const { first, measures: rowMeasures, startTick, endTick, plotWidth } = row;
      const rowSegments = segments.filter((segment) => segment.endTick > startTick && segment.startTick < endTick);
      const rowPitches = rowSegments.map((segment) => segment.pitch);
      // Where each part goes at the line break. A leap is only readable if you
      // can see both ends of it, so the pitch it lands on is marked at the end
      // of the line it leaves, and counts towards this line's pitch range so it
      // is never off the top or bottom. Only parts singing on this line are
      // marked: without a note to leap from there is no leap to show, and an
      // entry from another register would stretch the line for nothing.
      const nextEndTick = rows[systemIndex + 1]?.endTick ?? endTick;
      const continuations = [...new Set(rowSegments.flatMap((segment) => segment.tracks))].flatMap((track) => {
        const next = segments.find((segment) => segment.tracks.includes(track)
          && segment.endTick > endTick && segment.startTick < nextEndTick);
        return next ? [{ track, pitch: next.pitch }] : [];
      });
      const reachPitches = continuations.map((continuation) => continuation.pitch);
      const rangeKey = startTick + ":" + endTick;
      let range = recordingBarRanges?.get(rangeKey);
      if (!range) {
        const traceRange = recordingBarRanges ? {min:Infinity, max:-Infinity} : pitchTraceRange(startTick, endTick);
        const low = Math.min(rowPitches.length ? Math.min(...rowPitches, ...reachPitches) : 60, Math.floor(traceRange.min)) - 1;
        const high = Math.max(rowPitches.length ? Math.max(...rowPitches, ...reachPitches) : 60, Math.ceil(traceRange.max)) + 1;
        range = pitchGuideRange(low, high);
        recordingBarRanges?.set(rangeKey, range);
      }
      const { minPitch, maxPitch, referencePitch } = range;
      const topPad = 18;
      const plotHeight = (maxPitch - minPitch + 2) * pitchStep;
      const rowLyrics = lyrics.filter((lyric) => lyric[1] >= startTick && lyric[1] < endTick);
      const lyricVerses = [...new Set(rowLyrics.map((lyric) => lyric[2]))].sort((a, b) => a - b);
      const lyricLane = new Map(lyricVerses.map((verse, index) => [verse, index]));
      const lyricTop = topPad + plotHeight + lyricFontSize + 2;
      const viewHeight = lyricTop + (lyricVerses.length ? lyricVerses.length * lyricLineHeight + 3 : 2);
      const viewWidth = leftPad + plotWidth + rightPad;
      const xAtTick = (tick) => leftPad + clamp((tick - startTick) / Math.max(1, endTick - startTick), 0, 1) * plotWidth;
      const yAtPitch = (pitch) => topPad + (maxPitch - pitch + 1) * pitchStep;

      const shell = document.createElement("div");
      shell.className = "bar-system";
      shell.dataset.startTick = String(startTick);
      shell.dataset.endTick = String(endTick);
      shell.style.width = `${viewWidth}px`;
      const svg = createSvgElement("svg", {
        viewBox: `0 0 ${viewWidth} ${viewHeight}`,
        role: "img",
        "aria-label": `${first < 0 ? "Count-in and measures 1" : `Measures ${first + 1}`} through ${first + rowMeasures.length}, pitch range ${pitchLabel(minPitch)} through ${pitchLabel(maxPitch)}`,
        preserveAspectRatio: "xMinYMin meet",
      });
      const defs = createSvgElement("defs");
      const clipId = `pitch-trace-clip-${systemIndex}`;
      const clip = createSvgElement("clipPath", { id: clipId });
      clip.append(createSvgElement("rect", { x: leftPad, y: topPad, width: plotWidth, height: plotHeight }));
      defs.append(clip);
      svg.append(defs, createSvgElement("rect", { class: "bar-system-background", x: leftPad, y: topPad, width: plotWidth, height: plotHeight }));

      // The closing sign is what makes a loop; an opening one is drawn only
      // when the repeat starts somewhere other than the top, exactly as it is
      // printed.
      const hasLoop = Number.isInteger(loopEndMeasure);
      const hasOpening = hasLoop && Number.isInteger(loopStartMeasure);
      const loopRange = loopTickRange();

      rowMeasures.forEach((measure, offset) => {
        if (measure[0] < 0) {
          for (let beat = 0; beat < countInBeats(); beat++) {
            const tick = measure[0] + beat * measure[1] / countInBeats(), x = xAtTick(tick);
            svg.append(createSvgElement("line", {class:"bar-measure-line bar-count-in", x1:x, x2:x, y1:topPad, y2:topPad + plotHeight}));
            const label = createSvgElement("text", {class:"bar-measure-number bar-count-in-label", x:x + 3, y:12});
            label.textContent = String(beat + 1); svg.append(label);
          }
          return;
        }
        const x = xAtTick(measure[0]);
        const number = first + offset + 1;
        svg.append(createSvgElement("line", {
          class: `bar-measure-line${offset === 0 ? " is-system-edge" : ""}`,
          x1: x, x2: x, y1: topPad, y2: topPad + plotHeight,
        }));
        // Both signs stand on the barlines they belong to, the way they are
        // engraved: the opening one just before its measure's number, the
        // closing one at the end of the last measure the loop covers.
        let numberX = x + 3;
        if (hasOpening && first + offset === loopStartMeasure) {
          const sign = pitchBarRepeatSign(xAtTick(loopRange.start) + 1, 11, repeatSignHeight, 1);
          svg.append(sign.group);
          if (loopRange.start === measure[0]) numberX = x + sign.width + 4;
        }
        const label = createSvgElement("text", {
          class: `bar-measure-number${chapters.has(first + offset) ? " is-chapter" : ""}`,
          x: numberX, y: 11,
        });
        label.textContent = String(number);
        svg.append(label);
        if (hasLoop && first + offset === loopEndMeasure) {
          svg.append(pitchBarRepeatSign(xAtTick(loopRange.end) - 1, 11, repeatSignHeight, -1).group);
        }
      });
      svg.append(createSvgElement("line", {
        class: "bar-measure-line is-system-edge", x1: leftPad + plotWidth, x2: leftPad + plotWidth,
        y1: topPad, y2: topPad + plotHeight,
      }));

      // A triangle, not a bar: nothing in the score is that shape, so it cannot
      // be mistaken for a note to sing, and it points on to where the note
      // really is. Its vertical edge stands on the closing barline at a bar
      // note's height, it is as wide as it is tall, and its apex marks the
      // pitch.
      continuations.forEach(({ track, pitch }) => {
        const edge = leftPad + plotWidth;
        const middle = topPad + (maxPitch - pitch + 1) * pitchStep;
        const cue = createSvgElement("polygon", {
          class: "bar-next-pitch",
          points: `${edge},${middle - pitchStep} ${edge + pitchStep * 2},${middle} ${edge},${middle + pitchStep}`,
        });
        cue.style.fill = mixerParts[track].color;
        svg.append(cue);
      });

      const guidePitches = [];
      for (let pitch = minPitch; pitch <= maxPitch; pitch += 1) {
        const pitchClass = ((pitch % 12) + 12) % 12;
        if (Object.values(scoreKeyPitchClasses).includes(pitchClass)) guidePitches.push(pitch);
      }
      [...new Set([...guidePitches, referencePitch])].forEach((pitch) => {
        const pitchClass = ((pitch % 12) + 12) % 12;
        const kind = pitchClass === scoreKeyPitchClasses.tonic ? "tonic"
          : pitchClass === scoreKeyPitchClasses.dominant ? "dominant"
            : pitchClass === scoreKeyPitchClasses.third ? "third" : "reference";
        const y = yAtPitch(pitch);
        svg.append(createSvgElement("line", { class: `pitch-guide is-${kind}`, x1: leftPad, x2: leftPad + plotWidth, y1: y, y2: y }));
        if (pitch === referencePitch) {
          const label = createSvgElement("text", { class: "pitch-guide-label", x: leftPad - 4, y: y + 3, "text-anchor": "end" });
          label.textContent = pitchLabel(pitch);
          svg.append(label);
        }
      });

      const patternCache = new Map();
      rowSegments.forEach((segment) => {
        const x = xAtTick(Math.max(startTick, segment.startTick));
        const endX = xAtTick(Math.min(endTick, segment.endTick));
        const note = createSvgElement("rect", {
          class: "bar-note", x, y: topPad + (maxPitch - segment.pitch) * pitchStep,
          width: Math.max(0.8, endX - x), height: pitchStep * 2,
          'data-pitch':segment.pitch,'data-tracks':[...new Set(segment.tracks.map(i=>mixerParts[i].source))].join(','),
          'data-start':segment.startTick,'data-end':segment.endTick,
        });
        note.style.fill = pitchStripe(defs, systemIndex, segment.tracks, patternCache);
        svg.append(note);
      });

      // Counted from the notes rather than the drawn bars: a bar splits wherever
      // another part joins or leaves the same pitch, and a note is a note either
      // way. Two parts in unison therefore ask for the same tick twice.
      const drawnBeatTicks = new Set();
      rawNotes.forEach(([, noteStart, noteEnd, pitch]) => {
        if (noteEnd <= startTick || noteStart >= endTick) return;
        const top = topPad + (maxPitch - pitch) * pitchStep;
        beatTicksWithin(noteStart, noteEnd).forEach(({ tick, level }) => {
          if (tick <= startTick || tick >= endTick) return;
          const key = `${pitch}:${tick}`;
          if (drawnBeatTicks.has(key)) return;
          drawnBeatTicks.add(key);
          svg.append(createSvgElement("line", {
            class: "bar-beat-tick", x1: xAtTick(tick), x2: xAtTick(tick),
            y1: top + pitchStep * 2 * (1 - BEAT_TICK_HEIGHTS[level]), y2: top + pitchStep * 2,
          }));
        });
      });

      rowLyrics.forEach(([track, tick, verse, text]) => {
        const onsetX = xAtTick(tick);
        const lyric = createSvgElement("text", {
          class: "bar-lyric-text", x: onsetX, y: lyricTop + (lyricLane.get(verse) || 0) * lyricLineHeight,
          "data-track": track, "data-tick": tick, "data-verse": verse, "data-onset-x": onsetX,
          "text-anchor": "start",
        });
        lyric.textContent = text;
        svg.append(lyric);
      });

      const traceLayer = createSvgElement("g", { class: "bar-pitch-trace-layer", "clip-path": `url(#${clipId})`, "aria-hidden": "true" });
      svg.append(traceLayer);

      reattacks.filter((marker) => marker.tick >= startTick && marker.tick < endTick).forEach((marker) => {
        const y = topPad + (maxPitch - marker.pitch) * pitchStep;
        svg.append(createSvgElement("line", {
          class: "bar-reattack-line", x1: xAtTick(marker.tick), x2: xAtTick(marker.tick), y1: y, y2: y + pitchStep * 2,
        }));
      });

      // A separate HTML layer can move on the compositor while SVG traces repaint.
      const cursor = document.createElement("div");
      cursor.className = "bar-playhead";
      cursor.setAttribute("aria-hidden", "true");
      cursor.style.top = `${topPad}px`;
      cursor.style.height = `${plotHeight}px`;
      const system = {
        shell, svg, cursor, traceLayer, startTick, endTick, leftPad, plotWidth, minPitch, maxPitch, referencePitch, xAtTick, yAtPitch,
        lyricTop, lyricLineHeight, lyricVerses,
        traceEdges: new Map(), traceEdgesByBin: new Map(),
      };
      const pointAt = (pointerEvent) => {
        const matrix = svg.getScreenCTM();
        if (!matrix) return null;
        const point = svg.createSVGPoint();
        point.x = pointerEvent.clientX;
        point.y = pointerEvent.clientY;
        const local = point.matrixTransform(matrix.inverse());
        const ratio = clamp((local.x - leftPad) / plotWidth, 0, 0.999999);
        return {
          tick: clamp(Math.round(startTick + ratio * (endTick - startTick)), startTick, Math.max(startTick, endTick - 1)),
          pitch: maxPitch + 1 - (local.y - topPad) / pitchStep,
          above: local.y >= 0 && local.y < topPad && local.x >= leftPad && local.x <= leftPad + plotWidth,
          inside: local.x >= leftPad && local.x <= leftPad + plotWidth && local.y >= 0 && local.y <= viewHeight,
        };
      };
      const sounding = (at) => rawNotes.filter(([, start, end]) => at.tick >= start && at.tick < end);
      const chordAt = at => sounding(at).map(([channel, , , key]) => ({key, channel, track:mixerParts[channel].source}));
      const scrubTarget = (pointerEvent) => {
        const at = pointAt(pointerEvent);
        if (!at) return null;
        const active = sounding(at)
          .sort((left, right) => Math.abs(left[3] - at.pitch) - Math.abs(right[3] - at.pitch));
        return {
          tick: at.tick,
          partIndex: active.length ? mixerParts[active[0][0]].source : currentScorePartIndex(),
          snapStartTick: startTick,
          snapEndTick: endTick,
        };
      };
      const barUnder = (pointerEvent, nearest = false) => {
        const at = pointAt(pointerEvent);
        const note = at?.inside ? barNoteAt(rawNotes, at.tick, at.pitch, nearest,
          {startTick, endTick, tickScale: plotWidth / (endTick - startTick), pitchStep}) : null;
        if(note) note.paint=[...svg.querySelectorAll('.bar-note')].filter(node=>
          Number(node.dataset.pitch)===note.key && node.dataset.tracks.split(',').includes(String(note.track))
          && Number(node.dataset.end)>note.tick && Number(node.dataset.start)<note.endTick)
          .sort((a,b) => Math.max(Number(a.dataset.start)-at.tick,at.tick-Number(a.dataset.end),0)
            - Math.max(Number(b.dataset.start)-at.tick,at.tick-Number(b.dataset.end),0))[0];
        return note;
      };
      svg.addEventListener('pointermove',event=>{
        if(event.pointerType==='touch')return;
        const at=pointAt(event);
        hoverNote(lyricInteractionTarget(event) || at?.above ? null : barUnder(event,true));
      });
      svg.addEventListener('pointerleave',()=>hoverNote(null));
      svg.addEventListener("pointerdown", (event) => {
        const at = pointAt(event);
        let note = barUnder(event);
        const fullChord = !note && at?.above;
        if (!note && !fullChord) note = barUnder(event, true);
        const preview = note || (fullChord ? { notes: chordAt(at), fullChord: true } : null);
        const follow = (pointer) => {
          const next = pointAt(pointer);
          return fullChord ? next?.inside ? { notes: chordAt(next) } : null : barUnder(pointer, true);
        };
        if (!beginPitchAudition(event, preview, follow, scrubTarget)) beginScoreScrub(event, scrubTarget);
      });

      shell.append(svg, cursor);
      fragment.append(shell);
      nextSystems.push(system);
    }

    elements.barScore.replaceChildren(fragment);
    barSystems = nextSystems;
    activeBarSystemIndex = -1;
    alignPitchBarLyricsToFirstLetter(nextSystems);
    packPitchBarLyrics(nextSystems);
    decoratePitchBarLyrics();
    renderPitchTrace(nextSystems);
    updateBarPlayhead(engine ? engine.tickAtSeconds(engine.presentationSeconds()) : 0);
    requestAnimationFrame(revealPendingLoopStart);
  }

  function scheduleBarRender() {
    cancelAnimationFrame(barRenderFrame);
    barRenderFrame = requestAnimationFrame(renderBarScore);
  }

  function deferBarPitchTrace() {
    if (scoreView !== "bars") return;
    window.clearTimeout(barTraceResumeTimer);
    elements.barScore.classList.add("is-rescaling");
    // Keep note geometry responsive; capture/storage continue while the dense
    // overlay is hidden, then redraw from the latest data at the settled scale.
    barTraceResumeTimer = window.setTimeout(() => {
      barTraceResumeTimer = 0;
      elements.barScore.classList.remove("is-rescaling");
      if (scoreView === "bars" && !barRenderFrame) renderPitchTrace(barSystems);
    }, 200);
  }

  function stopBarPlayheadMotion() {
    barPlayheadMotion?.animations.forEach(animation => animation.cancel());
    barPlayheadMotion = null;
  }

  const barCursorTransform = x => `translate3d(${x - 1}px, 0, 0)`;

  function placeBarPlayhead(tick) {
    const next = barSystems.findIndex((system, index) => tick >= system.startTick
      && (tick < system.endTick || (index === barSystems.length - 1 && tick <= system.endTick)));
    if (activeBarSystemIndex !== next) {
      const previous = barSystems[activeBarSystemIndex];
      if (previous) previous.cursor.style.opacity = "0";
    }
    activeBarSystemIndex = next;
    const system = barSystems[next];
    if (!system) return;
    system.cursor.style.opacity = "1";
    system.cursor.style.transform = barCursorTransform(system.xAtTick(tick));
  }

  function barPlayheadKeyframes(system, clock, startSeconds, endSeconds) {
    // Tempo boundaries need real-time offsets, not evenly spaced musical ticks.
    const times = [startSeconds, ...clock.tempoSegments.map(segment => segment.seconds)
      .filter(seconds => seconds > startSeconds && seconds < endSeconds), endSeconds];
    return times.map(seconds => ({
      offset: (seconds - startSeconds) / (endSeconds - startSeconds),
      transform: barCursorTransform(system.xAtTick(clock.tickAtSeconds(seconds))), opacity: 1,
    }));
  }

  function updateBarPlayhead(tick) {
    if (!barSystems.length) return;
    if (scoreView !== "bars") { stopBarPlayheadMotion(); return; }
    if (!engine?.playing || typeof barSystems[0].cursor.animate !== "function") {
      stopBarPlayheadMotion();
      placeBarPlayhead(tick);
      return;
    }
    const now = performance.now(), seconds = engine.secondsAtTick(tick);
    const frameTime = typeof document !== "undefined" ? document.timeline?.currentTime : null;
    const timelineTime = Number.isFinite(frameTime) ? frameTime : now;
    const motion = barPlayheadMotion;
    if (motion && motion.systems === barSystems && motion.anchor === engine.anchorTime
      && motion.base === engine.basePosition && motion.rate === engine.rate
      && motion.end === engine.loopEndSeconds) {
      const expected = motion.seconds + (now - motion.now) / 1000 * engine.rate;
      // Do not restart an animation each frame or chase timestamp jitter. Re-anchor
      // only a genuine clock discontinuity (e.g. a changed output device).
      if (Math.abs(expected - seconds) / engine.rate < 0.025) {
        // DocumentTimeline is sampled at frame start; audio is sampled when
        // this callback actually runs. Keep the same compositor animations,
        // but align their phase even when the callback arrives late in a frame.
        const shift = timelineTime - motion.timelineTime - (seconds - motion.seconds) / engine.rate * 1000;
        for (const animation of motion.animations) animation.startTime += shift;
        motion.timelineTime += shift;
        return;
      }
    }
    stopBarPlayheadMotion();
    const animations = [];
    const end = engine.hasLoop() && engine.withinLoop(seconds) ? engine.loopEndSeconds : engine.duration;
    for (const system of barSystems) {
      system.cursor.style.opacity = "0";
      const from = Math.max(seconds, engine.secondsAtTick(system.startTick));
      const until = Math.min(end, engine.secondsAtTick(system.endTick));
      if (until <= from) continue;
      const animation = system.cursor.animate(barPlayheadKeyframes(system, engine, from, until), {
        duration: (until - from) / engine.rate * 1000, easing: "linear",
        fill: from === seconds ? "backwards" : "none",
      });
      // Use the timeline's sampled time, not the later performance.now().
      animation.startTime = timelineTime + (from - seconds) / engine.rate * 1000;
      animations.push(animation);
    }
    activeBarSystemIndex = -1;
    barPlayheadMotion = {animations, systems: barSystems, anchor: engine.anchorTime,
      base: engine.basePosition, rate: engine.rate, end: engine.loopEndSeconds, seconds, now, timelineTime};
  }

  function pitchCaptureSupported() {
    return Boolean(window.isSecureContext && window.MeleteMicrophoneCheck.mediaDevicesFor(window)?.getUserMedia && window.Pitchy?.PitchDetector);
  }

  function pitchCaptureEnabled() {
    return pitchCaptureState === "armed" || pitchCaptureState === "recording";
  }

  function updatePitchCaptureAppearance() {
    const requesting = takeState === "requesting" || pitchCaptureState === "requesting";
    const armed = pitchCaptureEnabled();
    const recording = ["counting", "recording"].includes(takeState);
    const keeping=recording && captureIsAudio, rec=document.getElementById("recordAudio");
    rec.disabled=!ready || conductorMode;
    rec.setAttribute("aria-pressed",String(recordAudio));
    rec.dataset.state=keeping ? "recording" : recordAudio ? "armed" : "off";
    rec.setAttribute("aria-label",recordAudio ? "Disarm audio recording" : "Arm audio recording");
    rec.title=rec.dataset.help=keeping ? "Saving audio and pitch. Disarm to keep only pitch."
      : recordAudio ? "Audio armed. Press Play to record."
        : "Record from the playhead while playing, or arm the next Play.";
    elements.pitchCapture.disabled = !ready;
    elements.pitchCapture.setAttribute("aria-pressed", String(wantsPitchCapture()));
    elements.pitchCapture.setAttribute("aria-busy", String(requesting));
    elements.pitchCapture.dataset.state = takeState === "off" && wantsPitchCapture() ? "waiting" : takeState;
    elements.pitchCapture.classList.toggle("is-pending", wantsPitchCapture() && !recording);
    elements.pitchCapture.classList.toggle("is-recording", keeping);
    elements.pitchCapture.setAttribute("aria-label", requesting
      ? "Cancel microphone request"
      : wantsPitchCapture() ? "Turn off Sing" : "Turn on Sing");
    elements.pitchCapture.dataset.help = !pitchCaptureSupported()
      ? "Microphone requires HTTPS or localhost."
      : requesting ? "Waiting for microphone access."
        : recording ? (keeping ? "Saving microphone audio and pitch locally." : "Saving pitch only; no audio is kept.")
          : takeState === "stopping" ? "Saving this pass locally."
            : wantsPitchCapture() ? pitchCaptureNotice || (recordAudio ? "Play to save audio and pitch." : "Play to save pitch feedback without audio.")
              : "Sing arms pitch tracking. Play saves a local pitch-only trace.";
    if (!Number.isInteger(practicePartIndex)) elements.pitchCapture.dataset.help += " Show one part in See to record; otherwise Play is playback only.";
    elements.pitchCapture.dataset.help += " Use headphones. Hold to clear the live display.";
    elements.pitchCapture.title = elements.pitchCapture.dataset.help;
    elements.settingsToggle.classList.toggle("has-active-microphone", armed);
  }

  // What a saved contour must match is the music it was sung against, not the
  // build that produced the page: rebuilding the same score should not throw
  // practice away. The playback hash covers the notes and their timing.
  function pitchTraceFingerprint(part = practicePartIndex) {
    return String(buildMetadata.build?.practiceReferenceFingerprints?.[part]
      || buildMetadata.build?.sourcePlaybackSha256 || buildMetadata.build?.playbackSha256
      || buildMetadata.build?.fingerprint || buildMetadata.fingerprint || config.slug || config.title || "score");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function packedPitchTraceBreaks(breaks) {
    const packed = new Uint8Array(Math.ceil(breaks.length / 8));
    breaks.forEach((value, index) => {
      if (value) packed[index >> 3] |= 1 << (index & 7);
    });
    return packed;
  }

  function unpackPitchTraceBreaks(bytes, length) {
    const unpacked = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) unpacked[index] = (bytes[index >> 3] >> (index & 7)) & 1;
    return unpacked;
  }

  function readPitchTraceLane(source, length, binTicks) {
    if (typeof source?.pitches !== "string" || typeof source?.breaks !== "string") return false;
    const pitchBytes = base64ToBytes(source.pitches);
    const breakBytes = base64ToBytes(source.breaks);
    if (pitchBytes.byteLength !== length * Uint16Array.BYTES_PER_ELEMENT
      || breakBytes.byteLength !== Math.ceil(length / 8)) return false;
    const savedPitches = new Uint16Array(pitchBytes.buffer.slice(
      pitchBytes.byteOffset,
      pitchBytes.byteOffset + pitchBytes.byteLength,
    ));
    const savedBreaks = unpackPitchTraceBreaks(breakBytes, length);
    const pitches = new Uint16Array(pitchTraceBinCount());
    const breaks = new Uint8Array(pitches.length);
    let count = 0;
    savedPitches.forEach((cents, index) => {
      if (cents < 2000 || cents > 11000) return;
      // Older coarse grids retain only their real observations. Do not fill
      // the newly available positions with interpolated pitch readings.
      const bin = pitchTraceBinAtTick(index * binTicks);
      if (!pitches[bin]) count += 1;
      pitches[bin] = cents;
      breaks[bin] |= savedBreaks[index];
    });
    // Legacy grids have no recording-speed history. Replay verified repairs,
    // never guess the duration of an apparent island from score ticks alone.
    const repairs = Array.isArray(source.octaveRepairs) ? source.octaveRepairs
      .filter(r => Array.isArray(r) && r.length === 3 && Number.isInteger(r[0]) && r[0] >= 0 && r[0] < length)
      .map(([bin, before, after]) => [pitchTraceBinAtTick(bin * binTicks), before, after]) : [];
    return {...window.MeleteVocalPitch.restorePitchGrid(pitches, repairs), breaks, count};
  }

  function loadPitchTraceV3(stored) {
    if (!Number.isFinite(stored.binTicks) || stored.binTicks < pitchTraceBinTicks()
      || stored.length !== Math.ceil(sequence.endTick / stored.binTicks) + 1
      || !Array.isArray(stored.lanes) || stored.lanes.length > 16) return false;
    const loaded = new Map();
    for (const source of stored.lanes) {
      const line = source?.line;
      if (!Number.isInteger(line) || line < 0 || line > 15 || loaded.has(line)) return false;
      const lane = readPitchTraceLane(source, stored.length, stored.binTicks);
      if (!lane) return false;
      loaded.set(line, lane);
    }
    // A malformed later lane must not leave a partially adopted contour.
    resetPitchTraceGrid();
    loaded.forEach(({ pitches, breaks, count, rawOctaves }, line) => {
      if (!count) return;
      pitchTraceLanes.set(line, { pitches, breaks, rawOctaves });
      pitchTraceCount += count;
    });
    return true;
  }

  // A contour saved before lines existed is one voice's worth of singing, so it
  // becomes the top line.
  function loadPitchTraceV2(stored) {
    return loadPitchTraceV3({ ...stored, lanes: [{ ...stored, line: 0 }] });
  }

  function migratePitchTraceV1(stored) {
    if (!Array.isArray(stored.samples)) return false;
    resetPitchTraceGrid();
    const lane = pitchTraceLane(0, { create: true });
    let previousSegment = null;
    stored.samples.map((sample) => Array.isArray(sample) ? sample.map(Number) : [])
      .filter(([tick, cents, clarity, segment]) => Number.isInteger(tick) && tick >= 0 && tick <= sequence.endTick
        && Number.isInteger(cents) && cents >= 2000 && cents <= 11000
        && Number.isInteger(clarity) && clarity >= 0 && clarity <= 255
        && Number.isInteger(segment) && segment >= 0)
      .sort((left, right) => left[0] - right[0] || left[3] - right[3])
      .forEach(([tick, cents, , segment]) => {
        const bin = pitchTraceBinAtTick(tick);
        if (!lane.pitches[bin]) pitchTraceCount += 1;
        lane.pitches[bin] = cents;
        if (previousSegment !== null && segment !== previousSegment) lane.breaks[bin] = 1;
        previousSegment = segment;
      });
    return true;
  }

  // A trace carries the fingerprint of the music it was sung against, so one
  // saved under any older name still belongs to this song when they match.
  // Adoption by name only rescues a trace this same build wrote; this rescues
  // the ones whose key named a build that no longer exists, which is every
  // trace recorded before the names carried the song's slug.
  function adoptedPitchTrace() {
    if (pitchTraceBaseKey && pitchTraceKey.startsWith(`${pitchTraceBaseKey}:part:`)) {
      // Pre-scope traces may mix several singers/parts. Keep them on disk,
      // but never attach their unknown pitches to a new practice part.
      try {
        const value = localStorage.getItem(pitchTraceKey), saved = JSON.parse(value || "null");
        return saved?.scope === pitchTraceKey ? value : null;
      } catch { return null; }
    }
    const named = storedValueFor(pitchTraceKey, legacyPitchTraceKeys);
    if (named !== null) return named;
    const wanted = pitchTraceFingerprint();
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith("choir-practice:") || !key.includes("pitch-trace")) continue;
        const value = localStorage.getItem(key);
        // Cheap reject before parsing what can be a megabyte of samples.
        if (!value?.includes(wanted) || JSON.parse(value)?.fingerprint !== wanted) continue;
        localStorage.setItem(pitchTraceKey, value);
        localStorage.removeItem(key);
        return value;
      }
    } catch {
      // Device-local storage is optional.
    }
    return null;
  }

  function loadPitchTrace() {
    resetPitchTraceGrid();
    pitchTraceLoaded = false;
    // IndexedDB recordings own saved contours. Leave old trace-only data
    // untouched, but never restore it as an independent display layer.
  }

  function savePitchTraceNow() {
    clearTimeout(pitchTraceSaveTimer);
    pitchTraceSaveTimer = 0;
  }

  function schedulePitchTraceSave() {
    // The PCM journal and cached take analysis own persistence.
  }

  function clearPitchTrace() {
    pitchCaptureWorker?.invalidate();
    resetPitchTraceGrid();
    pitchCapturePreviousTick = null;
    try { localStorage.removeItem(pitchTraceKey); } catch {}
    renderPitchTrace();
    updatePitchCaptureAppearance();
    showToast("Pitch contour cleared");
  }

  function pitchFrequencyIsValid(frequency) {
    return Number.isFinite(frequency) && frequency >= PITCH_CAPTURE_MIN_FREQUENCY && frequency <= PITCH_CAPTURE_MAX_FREQUENCY;
  }

  function centsForFrequency(frequency) {
    return Math.round((69 + 12 * Math.log2(frequency / 440)) * 100);
  }

  function resetPitchEvidence() {
    pitchLastAcceptedCents = null;
    pitchPendingEvidence = null;
    pitchCaptureMisses = 0;
  }

  function acceptPitchEvidence(pitchCents, clarity, seconds, backfill = null, breakBefore = false) {
    pitchLastAcceptedCents = pitchCents;
    pitchPendingEvidence = null;
    pitchCaptureMisses = 0;
    return { accepted: true, pitchCents, clarity, seconds, backfill, breakBefore };
  }

  function evaluatePitchEvidence(frequency, clarity, seconds, frame) {
    const threshold = PITCH_CONFIDENCE_THRESHOLD;
    const evidenceThreshold = Math.min(threshold, Math.max(0.4, threshold - 0.3));
    if (!pitchFrequencyIsValid(frequency) || !Number.isFinite(clarity) || clarity < evidenceThreshold) {
      pitchCaptureMisses += 1;
      if (pitchCaptureMisses >= 5) resetPitchEvidence();
      return { accepted: false, unvoiced: true };
    }
    pitchCaptureMisses = 0;
    const cents = centsForFrequency(frequency);
    const matchesPending = pitchPendingEvidence
      && seconds - pitchPendingEvidence.seconds >= 0
      && seconds - pitchPendingEvidence.seconds <= 0.3
      && Math.abs(cents - pitchPendingEvidence.cents) <= 100;
    const stable = Number.isFinite(pitchLastAcceptedCents) && Math.abs(cents - pitchLastAcceptedCents) <= 180;
    if (stable && (clarity >= threshold || Math.abs(cents - pitchLastAcceptedCents) <= 100)) {
      return acceptPitchEvidence(cents, clarity, seconds);
    }
    const required = clarity >= threshold ? 2 : 3;
    const count = matchesPending ? pitchPendingEvidence.count + 1 : 1;
    const previous = matchesPending ? pitchPendingEvidence : null;
    pitchPendingEvidence = { cents, clarity, seconds, count, frame };
    if (count < required) return { accepted: false };
    const backfill = previous ? { ...previous.frame, pitchCents: previous.cents,
      pitchSeconds: previous.seconds, clarity: previous.clarity } : null;
    return acceptPitchEvidence(cents, clarity, seconds, backfill, Number.isFinite(pitchLastAcceptedCents));
  }

  function replacePitchTraceWindows(frames) {
    const accepted = frames.filter((frame) => frame && Number.isFinite(frame.pitchCents)
      && pitchRestState(frame.tick) !== "discard");
    if (!accepted.length) return;
    const changed = new Map();
    const binTicks = pitchTraceBinTicks();
    const mark = (line, bin) => {
      if (!changed.has(line)) changed.set(line, new Set());
      changed.get(line).add(bin);
    };
    // Grouped by the line each frame was sung on, so re-singing the upper line
    // replaces the upper contour and leaves the lower one where it was.
    const byLine = new Map();
    accepted.forEach((frame) => {
      const line = pitchTraceLaneAt(frame.tick, frame.pitchCents);
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push(frame);
    });
    byLine.forEach((lineFrames, line) => {
      const lane = pitchTraceLane(line, { create: true });
      lineFrames.forEach((frame) => {
        const target = pitchTraceBinAtTick(frame.tick, frame.stride);
        const first = clamp(Math.min(target, Math.ceil((frame.startTick - pitchTraceOriginTick()) / binTicks)), 0, lane.pitches.length - 1);
        const last = clamp(Math.max(target, Math.floor((frame.endTick - pitchTraceOriginTick()) / binTicks)), first, lane.pitches.length - 1);
        for (let bin = first; bin <= last; bin += 1) {
          if (lane.pitches[bin]) pitchTraceCount -= 1;
          lane.pitches[bin] = 0;
          lane.breaks[bin] = 0;
          lane.rawOctaves?.delete(bin);
          mark(line, bin);
        }
        const next = nextOccupiedPitchBin(lane, last);
        if (next >= 0) {
          lane.breaks[next] = 1;
          mark(line, next);
        }
      });
      const updates = new Map();
      lineFrames.sort((left, right) => left.tick - right.tick).forEach((frame) => {
        const bin = pitchTraceBinAtTick(frame.tick, frame.stride);
        const previous = updates.get(bin);
        updates.set(bin, {
          cents: Math.round(frame.pitchCents),
          breakBefore: Boolean(frame.breakBefore || previous?.breakBefore),
        });
      });
      updates.forEach(({ cents, breakBefore }, bin) => {
        if (!lane.pitches[bin]) pitchTraceCount += 1;
        lane.rawOctaves?.delete(bin);
        lane.pitches[bin] = clamp(cents, 2000, 11000);
        lane.breaks[bin] = breakBefore ? 1 : 0;
        mark(line, bin);
      });
    });
    queuePitchTracePaint(changed);
    schedulePitchTraceSave();
  }

  function queuePitchTracePaint(changed) {
    if (scoreView !== "bars") return; // Captured bins are still available on switching back to Pitchbar.
    for (const [line, bins] of changed) {
      if (!pitchTraceDirty.has(line)) pitchTraceDirty.set(line, new Set());
      for (const bin of bins) pitchTraceDirty.get(line).add(bin);
    }
    if (pitchTracePaintFrame) return;
    pitchTracePaintFrame = requestAnimationFrame(() => {
      pitchTracePaintFrame = 0;
      updatePitchTraceIncrementally(pitchTraceDirty);
      pitchTraceDirty.clear();
    });
  }

  function repairLivePitchOctaves(frames) {
    for (const frame of frames.filter(Boolean)) {
      const previous = pitchOctaveHistory.at(-1), seconds = frame.pitchSeconds;
      if (!Number.isFinite(seconds)) continue;
      if (previous) {
        const gap = seconds - previous.start;
        if (gap <= 0 || gap > 0.025) pitchOctaveHistory = [];
        else previous.end = seconds;
      }
      pitchOctaveHistory.push({start: seconds, end: seconds + Math.min(0.02, pitchCaptureCadenceMs / 1000),
        cents: frame.pitchCents, frame});
      pitchOctaveHistory = pitchOctaveHistory.filter(item => seconds - item.start <= 0.5);
    }
    const repaired = window.MeleteVocalPitch.cleanPitchFrames(pitchOctaveHistory);
    const updates = new Map(), removed = new Map();
    repaired.forEach((item, index) => {
      const original = pitchOctaveHistory[index];
      if (item === original || original.repaired) return;
      // The bad octave may have been assigned to another divisi lane. Erase
      // only that observation, never neighboring work or a newer replacement.
      const line = pitchTraceLaneAt(original.frame.tick, original.cents), lane = pitchTraceLane(line);
      const bin = pitchTraceBinAtTick(original.frame.tick, original.frame.stride);
      // Silence may already have erased this rest observation, or a newer
      // reading may own its bin. A delayed repair cannot bring it back.
      if (lane?.pitches[bin] !== Math.round(original.cents)) return;
      original.repaired = true;
      lane.rawOctaves?.delete(bin);
      lane.pitches[bin] = 0; lane.breaks[bin] = 0; pitchTraceCount--;
      if (!removed.has(line)) removed.set(line, new Set());
      removed.get(line).add(bin);
      if (Number.isFinite(item.cents)) updates.set(index, {...original.frame, pitchCents: item.cents,
        breakBefore: index > 0 && !Number.isFinite(pitchOctaveHistory[index - 1].cents)});
      const next = repaired[index + 1];
      if (Number.isFinite(next?.cents)) {
        const rawNext = pitchOctaveHistory[index + 1];
        const oldPitch = rawNext.repaired ? next.cents : rawNext.cents;
        const nextLane = pitchTraceLane(pitchTraceLaneAt(next.frame.tick, oldPitch));
        const nextBin = pitchTraceBinAtTick(next.frame.tick, next.frame.stride);
        if (nextLane?.pitches[nextBin] === Math.round(oldPitch)) {
          updates.set(index + 1, {...next.frame, pitchCents: next.cents, breakBefore: false});
        }
      }
    });
    if (!updates.size && !removed.size) return;
    queuePitchTracePaint(removed);
    replacePitchTraceWindows([...updates].sort(([a], [b]) => a - b).map(([, frame]) => frame));
  }

  function clearSilentRestTrace(frame) {
    const line = pitchTraceLaneAt(frame.tick, NaN);
    const lane = pitchTraceLane(line);
    if (!lane) return;
    const binTicks = pitchTraceBinTicks();
    const first = Math.max(0, Math.ceil((frame.startTick - pitchTraceOriginTick()) / binTicks));
    const last = Math.min(lane.pitches.length - 1, Math.floor((frame.endTick - pitchTraceOriginTick()) / binTicks));
    const changed = new Set();
    for (let bin = first; bin <= last; bin += 1) {
      // A detector window may straddle an entrance. Silence only repairs rests,
      // never a neighboring sung note or another divisi lane's saved work.
      if (!lane.pitches[bin] || pitchRestState(pitchTraceOriginTick() + bin * binTicks) !== "rest") continue;
      lane.pitches[bin] = 0;
      lane.breaks[bin] = 0;
      lane.rawOctaves?.delete(bin);
      pitchTraceCount -= 1;
      changed.add(bin);
    }
    if (!changed.size) return;
    const next = nextOccupiedPitchBin(lane, Math.max(...changed));
    if (next >= 0) {
      lane.breaks[next] = 1;
      changed.add(next);
    }
    queuePitchTracePaint(new Map([[line, changed]]));
    schedulePitchTraceSave();
  }

  function pitchInputIsLive() {
    const track = pitchCaptureStream?.getAudioTracks()[0];
    return track?.readyState === "live" && track.enabled && !track.muted
      && pitchCaptureAnalyser?.context.state === "running";
  }

  function beginPitchCapturePass() {
    pitchCaptureWorker?.invalidate();
    pitchCaptureIntervalMs = PITCH_CAPTURE_INTERVAL_MS;
    pitchCaptureCadenceMs = PITCH_CAPTURE_INTERVAL_MS;
    pitchCapturePreviousAudioTime = null;
    pitchCapturePreviousTick = null;
    pitchCapturePreviousSeconds = null;
    pitchCaptureWasSilent = true;
    pitchCaptureUnvoicedFrame = null;
    pitchOctaveHistory = [];
    resetPitchEvidence();
  }

  function capturePitchSample() {
    if (!pitchCaptureEnabled() || !playing || !engine?.playing || !engine.context
      || !pitchInputIsLive() || !pitchCaptureWorker || !pitchCaptureBuffer) {
      pitchCaptureUnvoicedFrame = null;
      pitchOctaveHistory = [];
      return;
    }
    if (pitchCaptureWorker.pending) return;
    const context = engine.context;
    const audioTime = pitchCaptureAnalyser.context.currentTime;
    const captureRate = pitchCaptureAnalyser.context.sampleRate;
    if (pitchCapturePreviousAudioTime !== null
      && audioTime - pitchCapturePreviousAudioTime < 128 / captureRate - 1e-6) return;
    pitchCaptureAnalyser.getFloatTimeDomainData(pitchCaptureBuffer);
    const analysisLatency = PITCH_CAPTURE_BUFFER_SIZE / (2 * captureRate);
    const firstTick = Math.min(0, (practiceWriter || takeJournal)?.spec.initial?.start || 0);
    const scoreSeconds = clamp(engine.currentSeconds() - (analysisLatency + recordingLatency()) * engine.rate, engine.secondsAtTick(firstTick), engine.duration);
    const tick = clamp(engine.tickAtSeconds(scoreSeconds), firstTick, sequence.endTick);
    if (pitchCapturePreviousTick !== null && (tick < pitchCapturePreviousTick - 2
      || pitchCapturePreviousSeconds === null || scoreSeconds - pitchCapturePreviousSeconds > 0.5)) {
      beginPitchCapturePass();
    }
    if (pitchCapturePreviousAudioTime !== null) {
      const hopMs = Math.max(0, (audioTime - pitchCapturePreviousAudioTime) * 1000);
      pitchCaptureCadenceMs += 0.2 * (hopMs - pitchCaptureCadenceMs);
    }
    pitchCapturePreviousAudioTime = audioTime;
    const hopMs = Math.max(pitchCaptureIntervalMs, pitchCaptureCadenceMs);
    const halfWindow = Math.min(hopMs, PITCH_CAPTURE_FALLBACK_INTERVAL_MS) / 2000 * engine.rate;
    const frame = {
      tick,
      audioFrame: (audioTime - analysisLatency) * captureRate,
      audioWidth: Math.min(hopMs, PITCH_CAPTURE_FALLBACK_INTERVAL_MS) / 1000 * captureRate,
      stride: pitchTraceStrideAt(tick, hopMs),
      startTick: clamp(engine.tickAtSeconds(scoreSeconds - halfWindow), firstTick, sequence.endTick),
      endTick: clamp(engine.tickAtSeconds(scoreSeconds + halfWindow), firstTick, sequence.endTick),
    };
    pitchCaptureWorker.submit(pitchCaptureBuffer, {sampleRate: captureRate, previous: pitchLastAcceptedCents,
      minimum: PITCH_CAPTURE_MIN_FREQUENCY, maximum: PITCH_CAPTURE_MAX_FREQUENCY},
      {frame, seconds: context.currentTime});
    pitchCapturePreviousTick = tick;
    pitchCapturePreviousSeconds = scoreSeconds;
  }

  function acceptPitchSample([frequency, clarity], {frame, seconds}, cost) {
    if (!pitchCaptureEnabled() || !playing || !engine?.playing || !pitchInputIsLive()) {
      pitchCaptureUnvoicedFrame = null;
      pitchOctaveHistory = [];
      return;
    }
    pitchCaptureIntervalMs = Math.max(pitchCaptureIntervalMs,
      clamp(cost / 0.5, PITCH_CAPTURE_INTERVAL_MS, PITCH_CAPTURE_FALLBACK_INTERVAL_MS));
    const decision = evaluatePitchEvidence(frequency, clarity, seconds, frame);
    if(practiceWriter) {
      const observe=(f,c)=>practiceWriter.observe(engine.secondsAtTick(f.startTick),engine.secondsAtTick(f.endTick),
        pitchRestState(f.tick)==="discard"?null:c);
      if(decision.backfill)observe(decision.backfill,decision.backfill.pitchCents);
      if(decision.accepted || decision.unvoiced)observe(frame,decision.accepted?decision.pitchCents:null);
    } else if(captureIsAudio) {
      takeJournal?.observePitch(frame.audioFrame, frame.audioWidth, decision.accepted ? decision.pitchCents : null);
      if (decision.backfill) takeJournal?.observePitch(decision.backfill.audioFrame, decision.backfill.audioWidth, decision.backfill.pitchCents);
    }
    if (decision.accepted) {
      pitchCaptureUnvoicedFrame = null;
      const startsStroke = pitchCaptureWasSilent || decision.breakBefore;
      pitchCaptureWasSilent = false;
      const accepted = [
        decision.backfill ? { ...decision.backfill, breakBefore: startsStroke } : null,
        { ...frame, pitchCents: decision.pitchCents, pitchSeconds: seconds,
          breakBefore: startsStroke && !decision.backfill },
      ];
      replacePitchTraceWindows(accepted);
      repairLivePitchOctaves(accepted);
    } else if (decision.unvoiced) {
      pitchCaptureWasSilent = true;
      const previous = pitchCaptureUnvoicedFrame;
      const windowSeconds = PITCH_CAPTURE_BUFFER_SIZE / pitchCaptureAnalyser.context.sampleRate;
      const overlapping = previous && seconds >= previous.seconds && seconds - previous.seconds <= windowSeconds
        && frame.tick >= previous.frame.tick;
      // Overlapping unvoiced input windows cover the jitter between callbacks.
      // Never bridge a gap longer than the audio the detector actually observed.
      clearSilentRestTrace({ ...frame, startTick: overlapping
        ? Math.min(frame.startTick, previous.frame.tick) : frame.startTick });
      pitchCaptureUnvoicedFrame = { frame, seconds };
      repairLivePitchOctaves([{...frame, pitchSeconds: seconds, pitchCents: null}]);
    } else pitchCaptureUnvoicedFrame = null;
  }

  function ensurePitchWorker() {
    if (pitchCaptureWorker) return;
    const url = URL.createObjectURL(new Blob([window.MeleteLivePitch.workerSource(embeddedText("pitchy-runtime"))],
      {type: "text/javascript"}));
    try {
      pitchCaptureWorker = new window.MeleteLivePitch.Channel(new Worker(url), acceptPitchSample, error => {
        console.error(error);
        disablePitchCapture(false, { preservePreference: true, reason: "Pitch tracking unavailable; press Play to retry." });
        showToast("Background pitch tracking unavailable; playback is unchanged", "error");
      });
    } finally { URL.revokeObjectURL(url); }
  }

  function stopPitchSampling() {
    pitchCaptureWorker?.invalidate();
    clearTimeout(pitchCaptureTimer);
    pitchCaptureTimer = 0;
    if (pitchCaptureEnabled()) pitchCaptureState = "armed";
    savePitchTraceNow();
    updatePitchCaptureAppearance();
  }

  function runPitchSampling() {
    pitchCaptureTimer = 0;
    if (!pitchCaptureEnabled() || !playing) return;
    const started = performance.now();
    try { capturePitchSample(); }
    catch (error) {
      console.error(error);
      disablePitchCapture(false, { preservePreference: true, reason: "Pitch tracking stopped; press Play to retry." });
      showToast("Microphone pitch tracking stopped unexpectedly", "error");
      return;
    }
    const elapsed = performance.now() - started;
    const required = clamp(elapsed / 0.5, PITCH_CAPTURE_INTERVAL_MS, PITCH_CAPTURE_FALLBACK_INTERVAL_MS);
    // Back off immediately under load and recover gradually, leaving time for
    // playback and UI work. Actual delivered audio hops also limit the grid.
    pitchCaptureIntervalMs = Math.max(required, pitchCaptureIntervalMs * 0.9);
    pitchCaptureTimer = window.setTimeout(runPitchSampling, Math.max(4, pitchCaptureIntervalMs - elapsed));
  }

  function startPitchSampling() {
    if (!pitchCaptureEnabled() || !pitchCaptureStream || !playing || pitchCaptureTimer
      || !["counting", "recording"].includes(takeState)) return;
    ensurePitchWorker();
    beginPitchCapturePass();
    pitchCaptureState = "recording";
    updatePitchCaptureAppearance();
    pitchCaptureTimer = window.setTimeout(runPitchSampling, PITCH_CAPTURE_INTERVAL_MS);
  }

  function disablePitchCapture(announce = true, { preservePreference = false, reason = "" } = {}) {
    preparingCapture=null;recordAudio=false;
    if (!preservePreference) singEnabled = false;
    if (reason) retainRecordingInput = false;
    pitchCaptureNotice = reason;
    stopPitchSampling();
    pitchCaptureWorker?.close();
    pitchCaptureWorker = null;
    pitchCaptureState = "off";
    microphoneCheck?.close();
    if (reason) microphoneCheck?.fail(reason);
    try { if (pitchCaptureAnalyser) pitchCaptureSource?.disconnect(pitchCaptureAnalyser); } catch {}
    if (takeState !== "off" && takeState !== "stopping") {
      void stopTakeRecording(reason, false, {discardShortTail: !reason});
    }
    syncMicrophoneActivity();
    updatePitchCaptureAppearance();
    savePreferences();
    if (announce) showToast("Microphone off");
  }

  function activateCachedPitchCapture({ quiet = false } = {}) {
    pitchCaptureNotice = "";
    ensurePitchWorker();
    pitchCaptureStream.getAudioTracks().forEach((track) => { track.enabled = true; });
    pitchCaptureSource.connect(pitchCaptureAnalyser);
    pitchCaptureState = "armed";
    void microphoneCheck?.start();
    if (playing) startPitchSampling();
    else beginPitchCapturePass();
    updatePitchCaptureAppearance();
    savePreferences();
    if (!quiet) showToast("Sing on · recordings stay in this browser");
  }

  function syncMicrophoneActivity() {
    const visible = pitchCapturePageActive && !document.hidden;
    const active = visible && (pitchCaptureState !== "off" || takeState !== "off" && takeState !== "stopping" || Boolean(microphoneCheck?.active || microphoneCheck?.calibrating));
    if (active && recordAudio && pitchCaptureStream) retainRecordingInput = true;
    pitchCaptureStream?.getAudioTracks().forEach(track => { track.enabled = active; });
    if (!active) {
      // A disabled track supplies silence. Keeping the authorized stream while
      // this song is visible lets Rec punch back in without another permission request.
      if (!retainRecordingInput || !visible) releaseMicrophoneInput();
      if (pitchCaptureContext && pitchCaptureContext !== engine?.context) void pitchCaptureContext.suspend();
    }
    elements.takeMicrophone.disabled = active;
    elements.takeMicrophone.title = active ? "Turn Sing off to change input" : "Microphone for Sing and recording";
    microphoneCheck?.syncSelector(elements.takeMicrophone);
  }

  function readMicrophoneChoice() {
    try { microphoneDeviceId = localStorage.getItem("choir-practice:microphone:v1") || ""; } catch {}
    return microphoneDeviceId;
  }

  function timingKey() {
    const track=pitchCaptureStream?.getAudioTracks()[0], settings=track?.getSettings?.() || {};
    const input=settings.groupId || track?.label, output=engine.context?.sinkId || timingOutputDevice;
    return input && typeof output==="string" && output ? "melete:roundtrip:v1:"+JSON.stringify([input,output,pitchCaptureContext?.sampleRate,engine.context?.sampleRate]) : null;
  }
  function recordingLatency() {
    const key=timingKey();
    if(key && timingCache.key!==key){
      let saved=null;try{saved=localStorage.getItem(key);}catch{}
      const n=Number(saved);timingCache={key,seconds:saved!==null && Number.isFinite(n) && n>=0 && n<=.55?n:null};
    }
    if(key && timingCache.seconds!==null)return timingCache.seconds;
    return Math.max(0,Number(pitchCaptureStream?.getAudioTracks()[0]?.getSettings?.().latency)||0)
      +Math.max(0,(Number(engine.context?.baseLatency)||0)+(Number(engine.context?.outputLatency)||0));
  }
  async function measureRecordingTiming() {
    const message=document.getElementById("timingCheckStatus"), button=document.getElementById("measureTiming"), close=document.getElementById("closeTimingCheck");
    if(microphoneCheck.calibrating) return;
    if(engine.playing || takeState!=="off" || preparingCapture){message.textContent="Stop playback and finish the current take before measuring.";return;}
    microphoneCheck.calibrating=true;button.disabled=close.disabled=true;
    let capture;const nodes=[];
    try {
      message.textContent="Measuring with three quiet chirps…";
      await ensureMicrophoneInput();await refreshMicrophoneChoices();
      const key=timingKey(), ctx=engine.context, mic=pitchCaptureContext, track=pitchCaptureStream.getAudioTracks()[0];
      if(!key)throw Error("This browser could not identify the current microphone and output; no timing setting was changed.");
      const blocks=[];let failure=null;
      capture=await window.MeleteRecording.PcmCapture.create(mic,pitchCaptureSource,(frame,samples)=>blocks.push([frame,samples]),e=>{failure=e;});
      const pattern=window.MeleteMicrophoneCheck.timingChirp(ctx.sampleRate), buf=ctx.createBuffer(1,pattern.length,ctx.sampleRate);
      buf.copyToChannel(pattern,0);
      const anchor=ctx.currentTime, micAnchor=mic.currentTime, offsets=[.28,1.00,1.72];
      for(const delta of offsets){const n=ctx.createBufferSource();n.buffer=buf;n.connect(engine.master);n.start(anchor+delta);nodes.push(n);}
      await new Promise(resolve=>setTimeout(resolve,2480));
      await capture.stop();capture=null;
      if(failure || track.readyState!=="live" || document.hidden || !blocks.length || key!==timingKey())throw Error("The device changed or the check was interrupted. No timing setting was changed.");
      const first=blocks[0][0], last=blocks.at(-1);
      const data=new Float32Array(last[0]+last[1].length-first);for(const [frame,samples] of blocks)data.set(samples,frame-first);
      const seconds=window.MeleteMicrophoneCheck.measuredLatency(data,mic.sampleRate,offsets.map(v=>micAnchor+v-first/mic.sampleRate));
      if(seconds===null)throw Error("Couldn’t identify two matching chirps. Hold the earpiece closer and try again. The previous timing setting is unchanged.");
      localStorage.setItem(key,String(seconds));timingCache={key,seconds};
      message.textContent="Measured "+Math.round(1000*seconds)+" ms. New recordings on this microphone and output will use this alignment.";
    }catch(e){message.textContent=e?.message || "No timing setting was changed.";}
    finally {for(const n of nodes){try{n.stop();n.disconnect();}catch{}}try{await capture?.stop();}catch{}microphoneCheck.calibrating=false;syncMicrophoneActivity();button.disabled=close.disabled=false;}
  }

  async function refreshMicrophoneChoices() {
    const devicesApi = window.MeleteMicrophoneCheck.mediaDevicesFor(window);
    if (!devicesApi?.enumerateDevices) return;
    try {
      const allDevices=await devicesApi.enumerateDevices();
      const output=allDevices.find(d=>d.kind==="audiooutput" && d.deviceId==="default");
      timingOutputDevice=output?.groupId || output?.label || "";
      const devices = allDevices.filter(device => device.kind === "audioinput");
      const selected = readMicrophoneChoice();
      const defaultInput = devices.find(device => device.deviceId === "default");
      const options = [new Option(defaultInput?.label || "System default", "")];
      devices.filter(device => device.deviceId && !["default", "communications"].includes(device.deviceId))
        .forEach((device, index) => options.push(new Option(device.label || `Microphone ${index + 1}`, device.deviceId)));
      if (selected && !options.some(option => option.value === selected)) {
        options.push(new Option("Selected microphone (unavailable)", selected));
      }
      elements.takeMicrophone.replaceChildren(...options);
      elements.takeMicrophone.value = selected;
      microphoneCheck?.syncSelector(elements.takeMicrophone);
    } catch { /* Device labels may be unavailable until microphone access is granted. */ }
  }

  function releaseMicrophoneInput() {
    retainRecordingInput = false;
    const stream = pitchCaptureStream;
    pitchCaptureStream = null;
    try { pitchCaptureSource?.disconnect(); } catch {}
    pitchCaptureSource = null;
    stream?.getAudioTracks().forEach(track => track.stop());
  }

  function microphoneFailureMessage(error, retryAction = "try again") {
    if (error?.name === "NotAllowedError") return `Microphone blocked. Allow access in browser settings, then ${retryAction}.`;
    if (["NotFoundError", "OverconstrainedError"].includes(error?.name)) return "Microphone unavailable. Choose another input or reconnect it.";
    if (["NotReadableError", "AbortError"].includes(error?.name)) return "Microphone could not start. Choose another input or check the device.";
    if (error?.message === "No microphone samples arrived") return "No microphone audio arrived. Choose another input or reconnect it.";
    return "Microphone could not start. Check its connection and browser permissions.";
  }

  async function ensureMicrophoneInput({ waitForAudio = true } = {}) {
    engine.ensureAudio();
    // Keep capture independent of synth-voice graph churn and isolated outputs.
    if (!pitchCaptureContext) {
      pitchCaptureContext = new (window.AudioContext || window.webkitAudioContext)({latencyHint: "interactive"});
      new Set([pitchCaptureContext, engine.context]).forEach(context => {
        context.addEventListener("statechange", () => {
          if (["counting", "armed", "recording"].includes(takeState) && context.state !== "running") {
            void stopTakeRecording("Stopped: audio interrupted", true, {discardShortTail: false});
          }
        });
      });
    }
    const resumed = Promise.all([engine.context.resume(), pitchCaptureContext.resume()]);
    // Restoring a granted stream must not wait indefinitely for an autoplay
    // gesture. Play resumes both contexts before live pitch sampling starts.
    if (waitForAudio) await resumed;
    else void resumed.catch(() => {});
    const deviceId = readMicrophoneChoice();
    if (pitchCaptureStream?.getAudioTracks()[0]?.readyState === "live" && pitchCaptureSource
      && microphoneStreamDeviceId === deviceId) {
      syncMicrophoneActivity();
      return;
    }
    if (!microphoneRequest) {
      microphoneRequest = (async () => {
        releaseMicrophoneInput();
        const stream = await window.MeleteMicrophoneCheck.mediaDevicesFor(window).getUserMedia({ audio: {
          ...(deviceId ? {deviceId: {exact: deviceId}} : {}),
          channelCount: { ideal: 1 }, latency: {ideal:0}, echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false }, autoGainControl: { ideal: false },
        } });
        stream.getAudioTracks().forEach(track => {
          try { if ("contentHint" in track) track.contentHint = "music"; } catch {}
        });
        try { pitchCaptureSource?.disconnect(); } catch {}
        pitchCaptureStream = stream;
        microphoneStreamDeviceId = deviceId;
        pitchCaptureSource = pitchCaptureContext.createMediaStreamSource(stream);
        pitchCaptureAnalyser = pitchCaptureContext.createAnalyser();
        pitchCaptureAnalyser.fftSize = PITCH_CAPTURE_BUFFER_SIZE;
        pitchCaptureAnalyser.smoothingTimeConstant = 0;
        pitchCaptureBuffer = new Float32Array(PITCH_CAPTURE_BUFFER_SIZE);
        stream.getAudioTracks()[0]?.addEventListener("ended", () => {
          if (pitchCaptureStream !== stream) return;
          const active = pitchCaptureState !== "off" || takeState !== "off" || microphoneCheck?.active;
          const message = `Microphone disconnected: ${stream.getAudioTracks()[0].label || "input"}. Choose another input or reconnect it.`;
          if (microphoneCheck?.active) microphoneCheck.fail(message);
          releaseMicrophoneInput();
          disablePitchCapture(false, { preservePreference: true, reason: message });
          void stopTakeRecording(message, true, {discardShortTail: false});
          if (active) showToast(message, "error");
          void refreshMicrophoneChoices();
        }, { once: true });
        stream.getAudioTracks()[0]?.addEventListener("mute", () => {
          if (pitchCaptureStream === stream && takeState !== "off") {
            void stopTakeRecording("Microphone interrupted", true, {discardShortTail: false});
          }
        });
        syncMicrophoneActivity();
        void refreshMicrophoneChoices();
      })().finally(() => { microphoneRequest = null; });
    }
    await microphoneRequest;
  }

  function togglePitchCapture() {
    if (wantsPitchCapture()) {
      retainRecordingInput = false;
      disablePitchCapture();
    }
    else {
      singEnabled = true;
      pitchCaptureNotice = "";
      savePreferences();
      updatePitchCaptureAppearance();
      void armMicrophone();
    }
  }

  async function restorePitchCapture() {
    if (conductorMode) return;
    updatePitchCaptureAppearance();
    if (!wantsPitchCapture() || !pitchCapturePageActive || document.hidden) return;
    // Restoring the page may use an existing grant. Only a recording gesture
    // should open Chrome's permission prompt when the grant has expired.
    try {
      const permissions = window.MeleteMicrophoneCheck.microphoneNavigator(window).permissions;
      if ((await permissions?.query({name:'microphone'}))?.state==='granted') void armMicrophone();
    } catch { /* A browser without permission queries can arm on the next Play. */ }
  }

  async function armMicrophone() {
    if (!ready || !wantsPitchCapture() || !pitchCapturePageActive || document.hidden
      || pitchCaptureState !== "off") return;
    pitchCaptureState = "requesting";
    microphoneCheck?.paint("requesting", "Waiting for microphone...");
    updatePitchCaptureAppearance();
    try {
      await ensureMicrophoneInput({waitForAudio: false});
      if (!wantsPitchCapture() || !pitchCapturePageActive || document.hidden) { syncMicrophoneActivity(); return; }
      activateCachedPitchCapture({quiet: true});
    } catch (error) {
      if (!wantsPitchCapture() || !pitchCapturePageActive || document.hidden) return;
      const message = microphoneFailureMessage(error);
      disablePitchCapture(false, {preservePreference: true, reason: message});
      takeNotice = message;
      showTakePanel();
      renderTakePanel();
    }
  }

  function recordingLoopSpec() {
    if (!ready || !engine) return null;
    const position = engine.currentSeconds();
    const looping = engine.hasLoop() && position < engine.loopEndSeconds;
    const playhead = Math.abs(position) <= 0.002 ? 0 : clamp(engine.tickAtSeconds(position), pitchTraceOriginTick(), sequence.endTick);
    const range = looping ? loopTickRange() : {
      start: Math.max(0, playhead), end: sequence.endTick};
    const part = parts[practicePartIndex]?.short || parts[practicePartIndex]?.name || "voice";
    const start = range.start;
    const entry = looping ? window.MeleteRecording.recordingEntrance(
      window.MeleteRecording.auditionEntrances(config), range, part, loopAddressTick, null) : null;
    const seconds = (engine.secondsAtTick(range.end) - engine.secondsAtTick(start)) / engine.rate;
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const address = takeBoundaryLabel;
    const label = `${address(start)}-${address(range.end)}`;
    // Track recordings replace their passage; older takes lack this marker.
    const spec = {seconds, label, part, rate: engine.rate, start, end: range.end, mode: looping ? "loop" : "segment",
      replaces: true, trackSlot: compPanel?.slot() || null};
    // Ordinary practice starts at the playhead. Only a matching, enabled
    // audition preset may add preparation or move the first entrance.
    const initialStart = playhead;
    const plan = entry === null ? null : window.MeleteRecording.countInPlan(sequence.measures, sequence.division,
      entry, tick => engine.secondsAtTick(tick), engine.rate);
    const captureStart = plan?.start ?? initialStart;
    spec.initial = {start: captureStart, entry: entry ?? Math.max(0, initialStart),
      leadInSeconds: plan?.duration || Math.max(0, -engine.secondsAtTick(captureStart) / engine.rate), countInPlan: plan,
      label: `${captureStart < 0 ? "count-in + " : ""}${address(Math.max(0, captureStart))}-${address(range.end)}`,
      seconds: (engine.secondsAtTick(range.end) - engine.secondsAtTick(captureStart)) / engine.rate};
    return spec;
  }

  function takeSongKey() { return String(config.slug || config.title || "melete"); }

  function takePitchReference(spec, part = practicePartIndex, line = practiceDivisi[part] ?? null) {
    const analysis = partDivisi[part];
    if (!Number.isInteger(part) || !analysis) return null;
    const spans = analysis.spans.map(span => ({...span, pitches: Number.isInteger(line)
      ? [span.pitches[divisiLineFor(line, analysis.maxLines, span.pitches.length)]] : span.pitches}));
    const latency = recordingLatency();
    return window.MeleteTakePitch.reference({spans, secondsAtTick: tick => engine.secondsAtTick(tick),
      ...spec, captureStart: spec.start, start: spec.entry ?? spec.start,
      fingerprint: pitchTraceFingerprint(part), part, line, latency, measures: sequence.measures, division: sequence.division});
  }

  function cancelTakeScoring() { takeScoring?.cancel(); }

  const compDescriptors = new Map();
  function compDescriptor(part = practicePartIndex, line = practiceDivisi[part] ?? null) {
    if (!ready || !engine || !Number.isInteger(part) || !partDivisi[part]) return null;
    const cacheKey = JSON.stringify([part, line, engine.rate, sequence.endTick, pitchTraceFingerprint(part)]);
    if (!compDescriptors.has(cacheKey)) {
      const reference = takePitchReference({start: 0, end: sequence.endTick, rate: engine.rate}, part, line);
      reference.latency = 0;
      compDescriptors.set(cacheKey, {song: takeSongKey(), label: `${trackLabel(part, line)} \u00b7 ${Math.round(engine.rate * 100)}%`, reference});
    }
    return compDescriptors.get(cacheKey);
  }

  function trackLabel(part, line = null) {
    const option = line === null ? null : practiceDivisiOptions(part).find(choice => choice.value === line);
    return mixerParts.find(p => p.source === part && p.line === line)?.short
      || `${parts[part]?.short || parts[part]?.name || ""}${option ? ` ${option.label}` : ""}`;
  }

  function trackPaint(part,line=null) {
    return mixerParts.find(p=>p.source===part && p.line===line)?.color || parts[part]?.color || "";
  }

  function focusRecordingPart(ref) {
    cancelTakeHearBatch();
    const channel = mixerParts.findIndex(p => p.source === ref.part && p.line === (ref.line ?? null));
    if (channel < 0) return;
    cancelPracticeMixSession();
    practiceDivisi[ref.part] = ref.line ?? null;
    visibleChannels.clear(); visibleChannels.add(channel);
    audibleTracks.clear();
    mixerParts.forEach((_, i) => { if (i !== channel) audibleTracks.add(i); });
    syncPracticeFromSee();
    compPanel?.noteExplicitSelection();
    selectedScorePartIndex = null;
    updateMixerAppearance(); updateNoteActionLabel(); savePreferences(); scheduleRender();
  }

  function timedTake(t) {
    return {...t, playbackAdvance:window.MeleteStation.advanceMs(t)/1000, origin: t.pitchReference && engine
      ? engine.secondsAtTick(t.pitchReference.captureStart ?? t.start ?? t.pitchReference.start) / t.rate : null};
  }

  function ensureCompPanel() {
    if (compPanel || !window.MeleteCompPanel) return;
    compPanel = window.MeleteCompPanel.create({store: takeStore, song: takeSongKey, descriptor: compDescriptor, trackLabel, trackPaint,
      clearSingerMix: clearTakeLayers,
      showSingerPicker:()=>{setSettingsOpen(true,{persist:false});setSettingsSection('practice',true,{persist:false});document.getElementById('stationSinger').focus();},
      practicePersonChanged:changed=>{
        if(changed) void stopTakeRecording("",true);
        readPracticeTrace();
      },
      keepingAudio:()=>captureIsAudio,
      audition: () => Boolean(config.audition?.enabled), playback: singerPlayback,
      address: takeBoundaryLabel, tick: seconds => engine.tickAtSeconds(seconds),
      cloudConfig: config.cloud || {}, toast: showToast, selected: () => takePreviewId,
      rowSelected: id => id === takePreviewId && (scoreView !== "standard" || id === inspectedTakeId),
      inspectLoaded: id => {
        inspectedTakeId = id;
        renderPitchTrace(); updateTakePreview();
      },
      selectionRevision: () => takePreviewGeneration, focusPart: focusRecordingPart,
      cancelHearBatch: cancelTakeHearBatch,
      sort: () => takeSort,
      takes: () => allTakes().map(timedTake), timed: timedTake,
      context: () => { engine.ensureAudio(); return engine.context; }, wav: takeBlob,
      rawWav: take => takeJournal?.wav(take.id) || takeStore.wav(take.id),
      downloadBlob: downloadTakeBlob,
      changed: announceTakeChange, relist: renderTakePanel, reload: loadTakeLibrary, clear: stopTakePreview,
      trimmed: stored => {
        stored.forEach(({id, storedFrames}) => { const take = takeLibrary.get(id); if (take) take.storedFrames = storedFrames; });
        announceTakeChange(); renderTakePanel();
      },
      evicted: removed => {
        const own = removed.filter(t => t.song === takeSongKey()).map(t => t.id);
        own.forEach(id => { takeLibrary.delete(id); takeLayerLoads.delete(id); engine?.removeTakeLayer(id); });
        takeJournal?.drop(own);
        for (const song of new Set(removed.map(t => t.song))) announceTakeChange(song);
      },
      audible: id => Boolean(id && engine?.takeLayers.has(id)),
      octaveControl: updateTakeOctave,
      releaseOctave: element => { takeOctavePagers.delete(element); },
      hearControl: (button, id, activate) => attachTakeHear(button, id, activate),
      choosePart: (taken, then) => {
        const channels = mixerParts.filter(p => !taken.some(ref => ref.part === p.source && (ref.line ?? null) === p.line));
        if (!channels.length) { showToast("Every part already has a track"); return; }
        showPartChooser({channels, title: "Add a track for which part?",
          note: "Practice switches to this part; your next recording fills its track."});
        partChooserThen = then;
      },
      discard: ids => takeState === "off" && !takeActionBusy ? deleteTakes(ids, {quiet: true}) : [],
      loading: id => takeLayerLoads.has(id),
      hearReview: review => { engine.addTakeLayer(review, true); updateTakePreview(); },
      mute: id => { cancelTakeHearBatch(); takeLayerLoads.delete(id); takeVisualReviews.delete(id); engine?.removeTakeLayer(id); updateTakePreview(); },
      pendingRecording: (key, processed) => pendingCaptureTrace?.key === key
        && Boolean(pendingCaptureTrace.id && processed.includes(pendingCaptureTrace.id)),
      captureSettled: () => { pendingCaptureTrace = null; resetPitchTraceGrid(); renderPitchTrace(); },
      patchReview: (review, select) => {
        takeVisualReviews.set(review.id, review);
        if (select || takePreviewId === review.id) {
          if (takePreviewId !== review.id) inspectedTakeId = null;
          takePreviewId = review.id; takeReview = review;
          if (takeState === "off") { pendingCaptureTrace = null; resetPitchTraceGrid(); }
        }
        renderPitchTrace(); updateTakePreview();
      },
      replaceAudio: review => {
        const audible = engine.takeLayers.has(review.id), selected = takePreviewId === review.id;
        if (!audible && !selected) return;
        const pin = engine.pinnedTakeIds.has(review.id);
        engine.removeTakeLayer(review.id);
        engine.addTakeLayer(review, pin);
        if (selected) { takeReview = review; engine.takeReview = engine.takeLayers.get(review.id); }
        takeVisualReviews.delete(review.id);
        updateTakePreview();
      },
      review: (review, explicit) => {
        stopTakePreview(); takePreviewId = review.id; takeReview = review;
        if (explicit) inspectedTakeId = review.id;
        engine.setTakeReview(review); refreshTakePitchTrace(); updateTakePreview();
      }});
  }

  async function saveTakeAnalysis(take, result) {
    const {frames, ...metrics} = result;
    const contour = window.MeleteTakePitch.packContour(frames, take);
    const record = await takeStore.pitchScore(take.id, take.frames, take.pitchReference, metrics, contour);
    if (record) { takeLibrary.set(record.id, record); announceTakeChange(); compPanel?.invalidate(); }
    return record;
  }

  async function scoreNextTake() {
    if (takeScoring || !pitchCapturePageActive || document.hidden) return;
    const take = allTakes().find(item => !item.active && !item.unsaved && item.finalized && item.frames > 0
      && (!window.MeleteTakePitch.currentScore(item.pitchScore)
        || (item.pitchReference?.fingerprint === pitchTraceFingerprint(item.pitchReference?.part) && !window.MeleteTakePitch.readContour(item))
        || (item.pitchContour && !window.MeleteTakePitch.hasPitchBand(item.pitchScore)))
      && !takeScoreFailures.has(item.id)
      && window.MeleteTakePitch.validReference(item.pitchReference));
    if (!take) return;
    const job = {id: take.id, cancelled: false, cancel() { this.cancelled = true; this.abort?.(); }};
    takeScoring = job;
    renderTakePanel();
    let worker, url;
    try {
      const frames = window.MeleteTakePitch.readContour(take);
      let result;
      {
        const wav = frames ? null : await (await takeStore.wav(take.id)).arrayBuffer();
        if (job.cancelled) return;
        url = URL.createObjectURL(new Blob([window.MeleteTakePitch.workerSource(embeddedText("pitchy-runtime"))],
          {type: "text/javascript"}));
        worker = new Worker(url);
        result = await new Promise((resolve, reject) => {
          const finish = (error, value) => { window.clearTimeout(timer); error ? reject(error) : resolve(value); };
          const timer = window.setTimeout(() => finish(new Error("Pitch analysis timed out")), 60000);
          job.abort = () => finish(new DOMException("Pitch analysis canceled", "AbortError"));
          worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : null, event.data.result);
          worker.onerror = () => finish(new Error("Pitch analysis unavailable in this browser"));
          worker.postMessage({wav, frames, seconds:take.frames / take.sampleRate,
            reference: take.pitchReference, sampleRate: take.sampleRate, includeFrames: true}, wav ? [wav] : []);
        });
      }
      if (job.cancelled) return;
      await saveTakeAnalysis(take, result);
    } catch (error) {
      if (!job.cancelled) takeScoreFailures.set(take.id, error.message);
    } finally {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      if (takeScoring === job) takeScoring = null;
      renderTakePanel();
      void scoreNextTake();
    }
  }

  function wholeSongTakeScore(take) {
    const ref = take.pitchReference, score = take.pitchScore;
    if (!ref || !score) return score;
    const full = compDescriptor(ref.part, ref.line ?? null)?.reference;
    if (!full) return score;
    const expected = full.notes.reduce((sum, n) => sum + n[1] - n[0], 0) * (full.rate / ref.rate);
    return expected > 0 ? {...score, expectedSeconds: expected, coverage: Math.min(1, score.trackedSeconds / expected)} : score;
  }

  function takePitchLabel(take) {
    const pitch = wholeSongTakeScore(take);
    const date = `${new Date(take.createdAt).toLocaleString()} · ${Math.round(take.rate * 100)}% speed`;
    if (window.MeleteTakePitch.validScore(pitch)) {
      const measured = Number.isFinite(pitch.meanAbsCents);
      const tracked = pitch.expectedSeconds > 0 ? (pitch.coverage * 100).toFixed(1) : "\u2014";
      const error = measured ? pitch.meanAbsCents.toFixed(1) : "\u2014";
      const median = window.MeleteTakePitch.hasMedian(pitch) && Number.isFinite(pitch.medianAbsCents)
        ? pitch.medianAbsCents.toFixed(1) : "\u2014";
      const within = measured && window.MeleteTakePitch.hasPitchBand(pitch)
        ? (pitch.within50CentsSeconds / pitch.trackedSeconds * 100).toFixed(1) : "\u2014";
      const summary = pitch.expectedSeconds === 0 ? "No sung notes" : measured
        ? `${tracked}% tracked; ${error} cents mean absolute error; ${median} cents median absolute error`
        : "0.0% tracked; no reliable pitch detected";
      const band = within !== "\u2014"
        ? `Within \u00b150 cents: ${within}% of tracked singing; `
          + `${(pitch.within50CentsSeconds / pitch.expectedSeconds * 100).toFixed(1)}% of written singing. ` : "";
      return {tracked, error, median, within, text: band ? `${summary}. ${band.trim()}` : summary,
        title: `${date}\n${summary}. `
          + (measured ? `Stored mean: ${pitch.meanAbsCents.toFixed(3)} cents. ` : "")
          + (Number.isFinite(pitch.medianAbsCents) ? `Stored median: ${pitch.medianAbsCents.toFixed(3)} cents. ` : "")
          + band
          + window.MeleteTakePitch.restLabel(pitch) + " "
          + "Time-weighted mean and median absolute pitch error over tracked singing; lower is better. "
          + "Large jumps inflate the mean; the median can hide brief wrong notes. The 50-cent band is a diagnostic, not a performance grade. "
          + "Coverage is tracked / written singing time. Rests and count-in are excluded; untracked singing is not treated as zero error. "
          + "Tracking coverage is shown separately. "
          + "Octave-equivalent notes count as in tune; the pitchbar retains the actual sung register. Timing and microphone quality affect this estimate. "
          + "Headphones are recommended for reliable pitch scores: speakers can make the detector follow the backing instead of your voice."};
    }
    let text = "Pitch unavailable", reason = "No saved part reference for this take. Choose a practice part before recording. Existing audio is unchanged.";
    if (take.active || take.unsaved) { text = "Pitch after saving"; reason = "Each saved loop is analysed locally while the next one records."; }
    else if (window.MeleteTakePitch.validReference(take.pitchReference)) {
      if (pitch && pitch.expectedSeconds === 0) { text = "No sung notes"; reason = "Only written rests in this recording."; }
      else if (takeScoreFailures.has(take.id)) reason = takeScoreFailures.get(take.id);
      else if (!take.finalized) reason = "Recovered partial recording; no completed timing reference.";
      else { text = takeScoring?.id === take.id ? "Scoring pitch..." : "Pitch pending"; reason = "Local pitch analysis runs on each saved loop."; }
    }
    return {tracked: "\u2014", error: "\u2014", median: "\u2014", within: "\u2014", text, title: `${date}\n${text}. ${reason}`};
  }

  function allTakes(includeDeleted = false) {
    const merged = new Map([...takeLibrary].map(([id, record]) => [id, {...record,
      length: record.frames, seconds: record.frames / record.sampleRate, active: false, unsaved: false}]));
    for (const record of takeJournal?.views() || []) merged.set(record.id, record);
    return [...merged.values()].filter(take => includeDeleted || !take.deleteAfter)
      .sort(window.MeleteTakePitch.compareTakes);
  }

  function takeSizeLabel(bytes) { return `${(bytes / 1048576).toFixed(1)} MB`; }

  function storageTotalLabel(bytes) {
    return bytes < 1024 ** 3 ? `${Math.round(bytes / 1048576)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  function scheduleTakeDeletion() {
    window.clearTimeout(takeDeleteTimer);
    const pending = [...takeLibrary.values()].filter(take => take.deleteAfter);
    if (!pending.length) return;
    const deadline = Math.min(...pending.map(take => take.deleteAfter));
    takeDeleteTimer = window.setTimeout(() => {
      void loadTakeLibrary().then(announceTakeChange).catch(() => {
        takeNotice = "Deletion could not finish; audio was kept. Reopen settings to retry.";
        renderTakePanel();
      });
    }, Math.max(50, deadline - Date.now() + 20));
  }

  function refreshRecordingTime() {
    if (recordingTimeRequest) return recordingTimeRequest;
    const day = window.MeleteRecording.recordingDay();
    const element = document.getElementById("recordingToday"), output = element.querySelector("output");
    window.clearTimeout(recordingDayTimer);
    recordingTimeRequest = takeStore.recordingTime(day).then(seconds => {
      output.textContent = `${Math.round(seconds / 60)} min`;
      element.dataset.seconds = String(seconds);
      element.dataset.day = day;
    }).catch(() => {
      output.textContent = "-- min";
      delete element.dataset.seconds;
    }).finally(() => {
      recordingTimeRequest = null;
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      if (day !== window.MeleteRecording.recordingDay()) void refreshRecordingTime();
      else recordingDayTimer = window.setTimeout(refreshRecordingTime, next - Date.now() + 50);
    });
    return recordingTimeRequest;
  }

  function announceTakeChange(song = takeSongKey()) {
    if (typeof song !== "string") song = takeSongKey();
    takeChannel?.postMessage({song});
    void refreshRecordingTime();
  }

  async function loadTakeLibrary() {
    if (takeLibraryRequest) return takeLibraryRequest;
    takeLibraryRequest = (async () => {
      await takeStore.backfillRecordingTime();
      await refreshRecordingTime();
      await takeStore.purgeDeleted(takeSongKey());
      const library = await takeStore.usage();
      const records = library.filter(record => record.song === takeSongKey());
      let revised = false;
      // Score corrections regrade saved observations, never rewrite the audio.
      // Changed bar timing must be realigned explicitly instead of guessed.
      for (let i = 0; i < records.length; i++) {
        const record = records[i], ref = record.pitchReference, pitch = window.MeleteTakePitch;
        if (!engine || !record.finalized || record.deleteAfter || !pitch.validReference(ref)
          || !partDivisi[ref.part] || ref.fingerprint === pitchTraceFingerprint(ref.part)) continue;
        const name = String(record.part || "").split(" \u00b7 ")[0];
        if (name && ![parts[ref.part].short, parts[ref.part].name].includes(name)) continue;
        const current = {...takePitchReference({...ref, start: ref.captureStart ?? ref.start, entry: ref.start}, ref.part, ref.line),
          latency: ref.latency};
        if (!pitch.sameTimeline(ref, current)) continue;
        const updated = await takeStore.rebaseReference(record, current);
        if (updated) { records[i] = updated; revised = true; }
      }
      if (revised) { if (takePreviewId) stopTakePreview(); compPanel?.invalidate(); }
      // Update only this unchanged score's finalized recordings. Do not guess
      // rest timing for older scores, other songs, or active checkpoints.
      for (let i = 0; i < records.length; i++) {
        const record = records[i], ref = record.pitchReference, pitch = window.MeleteTakePitch;
        if (!record.finalized || record.deleteAfter || record.referenceUpdatedAt || !pitch.validReference(ref)
          || record.restAudioVersion === pitch.REST_POLICY_VERSION || ref.fingerprint !== pitchTraceFingerprint(ref.part)) continue;
        const current = takePitchReference({...ref, start: ref.captureStart ?? ref.start, entry: ref.start}, ref.part, ref.line);
        if (!pitch.samePassage(ref, current)) continue;
        const updated = pitch.trimReference({...ref, restPolicy: current.restPolicy}, ref.end, ref.seconds);
        records[i] = await takeStore.discardLongRests(record, updated);
        if (takePreviewId) stopTakePreview();
        compPanel?.invalidate();
      }
      takeOtherBytes = window.MeleteRecording.takeBytes(library.filter(record => record.song !== takeSongKey()));
      takeLibrary = new Map(records.map(record => [record.id, record]));
      for (const id of new Set([...takeLayerLoads.keys(), ...(engine?.takeLayers.keys() || [])])) {
        if (!id.startsWith("comp:") && (!takeLibrary.has(id) || takeLibrary.get(id).deleteAfter)) {
          takeLayerLoads.delete(id); engine?.removeTakeLayer(id);
        }
      }
      if (takePreviewId && !takePreviewId.startsWith("trace:") && !takePreviewId.startsWith("comp:") && (!takeLibrary.has(takePreviewId) || takeLibrary.get(takePreviewId).deleteAfter)) stopTakePreview();
      scheduleTakeDeletion();
      takeLibraryReady = true;
      if (revised) announceTakeChange();
      try { takePersistence = await navigator.storage?.persisted?.() || false; } catch {}
      if (!takeChannel && typeof BroadcastChannel !== "undefined") {
        try {
          takeChannel = new BroadcastChannel("melete-audio-takes-v1");
          takeChannel.onmessage = event => {
            if (event.data?.song) void loadTakeLibrary().catch(() => {});
          };
        } catch {} // Cross-tab refresh is optional; local saving is not.
      }
    })().catch(error => { takeLibraryReady = false; throw error; })
      .finally(() => { takeLibraryRequest = null; renderTakePanel(); void scoreNextTake(); });
    return takeLibraryRequest;
  }

  function takeSaveError(error) {
    return error?.name === "QuotaExceededError"
      ? "Storage full. Unsaved audio is still available to download."
      : "Local save failed. Unsaved audio is still available to download.";
  }

  async function checkTakeSpace(spec) {
    let estimate;
    try { estimate = await navigator.storage?.estimate?.(); } catch {}
    const required = Math.max(spec.seconds, spec.initial?.seconds || 0) * (pitchCaptureContext?.sampleRate || 48000) * 4 + 262144;
    if (Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage)
      && estimate.quota - estimate.usage < required) {
      throw new DOMException("Not enough local space for another take", "QuotaExceededError");
    }
  }

  function refreshTakePitchTrace({preserveGeometry = false} = {}) {
    if (scoreView !== "bars" || recordingBarRanges) { renderPitchTrace(); return; }
    if (preserveGeometry) {
      const needsRoom = barSystems.some(system => {
        const range = pitchTraceRange(system.startTick, system.endTick);
        return range.min < system.minPitch || range.max > system.maxPitch;
      });
      if (needsRoom) { if (!barRenderFrame) scheduleBarRender(); }
      else renderPitchTrace();
      return;
    }
    // A selected take replaces old observations, so its range can shrink too.
    // Keep the currently visible row anchored while earlier rows change height.
    const headerBottom = elements.transport.getBoundingClientRect().bottom;
    const anchor = barSystems.find(system => system.shell.getBoundingClientRect().bottom > headerBottom);
    const top = anchor?.shell.getBoundingClientRect().top;
    const left = elements.barScore.scrollLeft;
    cancelAnimationFrame(barRenderFrame);
    renderBarScore();
    const replacement = anchor && barSystems.find(system => system.startTick === anchor.startTick);
    if (replacement && Number.isFinite(top)) {
      automaticScrollUntil = Date.now() + 350;
      window.scrollTo({top: window.scrollY + replacement.shell.getBoundingClientRect().top - top, behavior: "auto"});
    }
    elements.barScore.scrollLeft = left;
  }

  function stopTakePreview() {
    cancelTakeHearBatch();
    const hadReview = Boolean(takeReview);
    takePreviewGeneration += 1;
    pendingCaptureTrace = null;
    takeReviewWorker?.cancel();
    takeReviewWorker = null;
    engine?.setTakeReview(null);
    takeReview = null;
    takePreviewId = null;
    inspectedTakeId = null;
    if (hadReview) refreshTakePitchTrace();
    else renderPitchTrace();
    updateTakePreview();
    void scoreNextTake();
  }

  const takeCleanAudio = new Map();
  async function takeBlob(take) {
    const key = JSON.stringify([take.id,take.frames,take.updatedAt,take.pitchContour?.analysisVersion,window.MeleteTakeCleanup.VERSION]);
    if (takeCleanAudio.has(key)) return takeCleanAudio.get(key).promise;
    const entry = {bytes: Math.max(0,take.frames||0)*2, promise:null};
    entry.promise = (async()=>{
      const blob = await (takeJournal?.wav(take.id) || takeStore.wav(take.id));
      if (!take.finalized) return blob;
      const frames = window.MeleteTakePitch.readContour(take);
      const result = await window.MeleteTakeCleanup.prepare(blob,take,frames,embeddedText("pitchy-runtime"));
      return result.blob;
    })().catch(error=>{takeCleanAudio.delete(key);throw error;});
    takeCleanAudio.set(key,entry);
    let bytes=[...takeCleanAudio.values()].reduce((n,e)=>n+e.bytes,0);
    for(const [old,item] of takeCleanAudio){
      if(takeCleanAudio.size<=8&&bytes<=64*1024*1024)break;
      takeCleanAudio.delete(old);bytes-=item.bytes;
    }
    return entry.promise;
  }

  function clearTakeLayers() {
    cancelTakeHearBatch();
    takeLayerLoads.clear();
    engine?.clearTakeLayers();
    updateTakePreview();
  }

  function takeReviewReference(take) {
    const ref = take.pitchReference;
    if (!window.MeleteTakePitch.validReference(ref) || !partDivisi[ref.part]) {
      throw new Error("This older take has no saved score reference. Its WAV is still available to download.");
    }
    const captureStart = ref.captureStart ?? take.start ?? ref.start;
    const analysis = partDivisi[ref.part];
    const spans = analysis.spans.map(span => ({...span, pitches: Number.isInteger(ref.line)
      ? [span.pitches[divisiLineFor(ref.line, analysis.maxLines, span.pitches.length)]] : span.pitches}));
    const current = window.MeleteTakePitch.reference({spans, secondsAtTick: tick => engine.secondsAtTick(tick),
      ...ref, captureStart, fingerprint: pitchTraceFingerprint(ref.part)});
    if (!window.MeleteTakePitch.samePassage(ref, current)) {
      throw new Error("This passage has changed since the take was recorded. Download its original audio to review it.");
    }
    return {ref, captureStart};
  }

  async function prepareLooseTake(take) {
    const {ref, captureStart} = takeReviewReference(take);
    engine.ensureAudio();
    const blob = await takeBlob(take);
    const buffer = await engine.context.decodeAudioData(await blob.arrayBuffer());
    return {id: take.id, singerId:window.MeleteStation.sourceSinger(take)?.id, label: `Take ${take.number || "..."}`, ref, buffer, blob,
      frames: shiftedReviewFrames(window.MeleteTakePitch.readContour(take) || [],take),
      track: ref.part, rate: ref.rate, start: engine.secondsAtTick(captureStart),
      end: engine.secondsAtTick(ref.end), latency:ref.latency+window.MeleteStation.advanceMs(take)/1000};
  }

  function shiftedReviewFrames(frames,take) {
    const advance=window.MeleteStation.advanceMs(take)/1000;
    return advance ? frames.map(f=>({...f,start:f.start-advance,end:f.end-advance})) : frames;
  }

  async function toggleTakeLayer(id) {
    if (takeLayerLoads.has(id)) { takeLayerLoads.delete(id); updateTakePreview(); return; }
    if (engine?.takeLayers.has(id)) { engine.removeTakeLayer(id); updateTakePreview(); return; }
    const take = allTakes().find(item => item.id === id);
    if (!take?.length || take.active) return;
    const token = {};
    takeLayerLoads.set(id, token);
    updateTakePreview();
    try {
      const review = await prepareLooseTake(take);
      if (takeLayerLoads.get(id) !== token) return;
      engine.addTakeLayer(review, true);
    } catch (error) {
      if (takeLayerLoads.get(id) === token) showToast(error.message || "Could not load this take", "error");
    } finally {
      if (takeLayerLoads.get(id) === token) takeLayerLoads.delete(id);
      updateTakePreview();
    }
  }

  function updateTakeHear(button, id, name) {
    if (!button) return;
    const audible = engine?.takeLayers.has(id), loading = takeLayerLoads.has(id) || engine?.takeLayers.get(id)?.stretchPending;
    button.setAttribute("aria-pressed", String(Boolean(audible)));
    button.setAttribute("aria-busy", String(loading));
    button.title = `${loading ? "Cancel loading" : audible ? "Mute" : "Hear"} ${name}. Hold to isolate; hold the only audible track to hear everyone.`;
    button.setAttribute("aria-label", `${audible ? "Mute" : "Hear"} ${name}`);
  }

  function attachTakeHear(button, id, activate) {
    attachHoldReset(button, () => {
      const pending = takeHearBatch?.ids.has(id());
      cancelTakeHearBatch();
      if (pending) updateTakePreview();
      else activate();
    }, () => { void cycleTakeHear(id()); }, "recording mix", {isolate: true});
  }

  function cancelTakeHearBatch() {
    if (!takeHearBatch) return;
    for (const id of takeHearBatch.ids) if (takeLayerLoads.get(id) === takeHearBatch) takeLayerLoads.delete(id);
    takeHearBatch = null;
  }

  async function cycleTakeHear(id) {
    cancelTakeHearBatch();
    const tracks = [...(compPanel?.layers() || []), ...looseTakes().filter(t => t.length && !t.active)
      .map(t => ({id: t.id, prepare: () => prepareLooseTake(t)}))];
    const target = tracks.find(t => t.id === id);
    if (!target) return;
    const everyone = engine.takeLayers.size === 1 && engine.takeLayers.has(id);
    if (!everyone) {
      engine.updateTakeLayers([], [...engine.takeLayers.keys()].filter(key => key !== id));
      takeLayerLoads.clear();
    }
    const chosen = everyone ? tracks : [target];
    const pending = chosen.filter(track => !engine.takeLayers.has(track.id));
    const batch = {ids: new Set(pending.map(track => track.id))};
    takeHearBatch = batch;
    for (const track of pending) takeLayerLoads.set(track.id, batch);
    updateTakePreview();
    const prepared = [];
    try {
      // Decode and measure off the audible graph. Only the complete group is
      // connected, so Hear all never runs normalization on intermediate mixes.
      for (const track of pending) {
        try {
          const review = await track.prepare();
          if (takeHearBatch !== batch) return;
          review.loudness ||= await window.MeleteTakeLoudness.track(review.buffer);
          if (takeHearBatch !== batch) return;
          if (takeLayerLoads.get(track.id) === batch) prepared.push(review);
        } catch (error) {
          if (takeHearBatch !== batch) return;
          if (error.name !== "AbortError") showToast(error.message || "Could not load this take", "error");
        }
      }
      if (takeHearBatch === batch) {
        engine.updateTakeLayers(prepared.filter(review => takeLayerLoads.get(review.id) === batch));
        for (const track of chosen) if (engine.takeLayers.has(track.id)) engine.pinnedTakeIds.add(track.id);
      }
    } finally {
      if (takeHearBatch === batch) cancelTakeHearBatch();
      updateTakePreview();
    }
  }

  function takeOctave(id) {
    if (!takeOctaves) {
      try { takeOctaves = JSON.parse(localStorage.getItem(`melete:take-octaves:${takeSongKey()}`) || "{}"); }
      catch { takeOctaves = {}; }
      if (!takeOctaves || typeof takeOctaves !== "object" || Array.isArray(takeOctaves)) takeOctaves = {};
    }
    const value = takeOctaves[id];
    return [-1, 0, 1].includes(value) ? value : 0;
  }

  function updateTakeOctave(element, id, name) {
    if (!element) return;
    element.dataset.takeId = id || "";
    element.inert = !id;
    element.setAttribute("aria-label", `Playback octave for ${name}`);
    if (!takeOctavePagers.has(element)) {
      takeOctavePagers.set(element, true);
      element.addEventListener("click", () => {
        const target = element.dataset.takeId;
        if (!target) return;
        takeOctaves[target] = {0: 1, 1: -1, [-1]: 0}[takeOctave(target)];
        try { localStorage.setItem(`melete:take-octaves:${takeSongKey()}`, JSON.stringify(takeOctaves)); } catch {}
        engine?.setTakeOctave(target, takeOctaves[target]);
        updateTakePreview();
      });
    }
    element.textContent = {0: "-", 1: "8va", [-1]: "8vb"}[takeOctave(id)];
    element.dataset.value = String(takeOctave(id));
    element.title = "Playback octave: - (original), 8va (up), 8vb (down). Click to cycle. Timing, original WAV and pitch scores are unchanged.";
  }

  let traceLayerSignature = "";
  function updateTakePreview() {
    document.getElementById("downloadMix").disabled = !engine?.takeLayers.size || takeActionBusy || takeState !== "off";
    const traceSignature = JSON.stringify([takePreviewId, [...(engine?.takeLayers.values() || [])].map(r => [r.id, r.octave])]);
    if (traceSignature !== traceLayerSignature) {
      traceLayerSignature = traceSignature;
      if (ready) refreshTakePitchTrace({preserveGeometry: true});
    }
    syncPlaybackButton();
    elements.exitTakeReview.hidden = !takePreviewId;
    const selectedTake = allTakes().find(take => take.id === takePreviewId);
    elements.exitTakeReview.querySelector("span").textContent = takeReview?.label || (selectedTake ? `Take ${selectedTake.number || "..."}` : "");
    elements.exitTakeReview.setAttribute("aria-busy", String(Boolean(takePreviewId && !takeReview)));
    for (const row of elements.takeList.children) {
      const selected = row.dataset.takeId === takePreviewId;
      updateTakeHear(row.querySelector(".take-hear"), row.dataset.takeId, `take ${row.dataset.takeNumber}`);
      updateTakeOctave(row.querySelector(".take-octave"), row.dataset.takeId, `take ${row.dataset.takeNumber}`);
      row.classList.toggle("is-selected", selected);
      const button = row.querySelector(".take-select");
      if (!button) continue;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-label", `${selected ? "Deselect" : "Review"} take ${row.dataset.takeNumber}`);
      const action = selected ? "Deselect this contour; takes enabled with Hear stay audible" : "Review this take's audio, contour and bounds; other Hear-enabled takes stay audible";
      button.title = row.dataset.comparison ? `${row.dataset.comparison}. ${action}` : action;
    }
    compPanel?.selected();
    paintPracticeTraceRow();
    updateTakeTimeline();
  }

  function takeTimelineLabelAt(seconds) {
    if (!takeTimeline) return "";
    const contains = ([a, b]) => seconds >= a && seconds < b;
    if (!contains(takeTimeline.scope)) return "Outside recording";
    const segment = takeTimeline.segments.find(s => seconds >= s.from && seconds < s.to);
    const gap = takeTimeline.gaps.find(contains);
    const status = gap ? `Missing singing (${((gap[1] - gap[0]) / takeReview.rate).toFixed(1)} s)` : "Covered";
    return segment?.label ? `${segment.label}: ${status}` : status;
  }

  function updateTakeTimeline() {
    if (takeTimelineReview === takeReview) return;
    takeTimeline = window.MeleteTakePitch.reviewTimeline(takeReview, engine?.duration);
    takeTimelineReview = takeReview;
    elements.takeTimeline.replaceChildren();
    elements.takeTimeline.hidden = !takeTimeline;
    elements.timelineRail.classList.toggle("has-take-review", Boolean(takeTimeline));
    elements.timelineRail.removeAttribute("title");
    elements.takeTimelineDescription.textContent = "";
    elements.seek.removeAttribute("aria-describedby");
    if (!takeTimeline) return;
    const mark = (type, from, to) => {
      const span = document.createElement("span");
      span.className = `take-timeline-${type}`;
      span.style.left = `${timelineFraction(from) * 100}%`;
      if (to !== undefined) span.style.width = `${(timelineFraction(to) - timelineFraction(from)) * 100}%`;
      span.dataset.from = String(from);
      if (to !== undefined) span.dataset.to = String(to);
      elements.takeTimeline.append(span);
      return span;
    };
    for (const [from, to] of takeTimeline.covered) mark("coverage", from, to);
    for (const at of takeTimeline.seams) mark("boundary", at);
    const ranges = takeReview.timelineSegments;
    const from = Math.max(engine.secondsAtTick(pitchTraceOriginTick()), ranges?.length ? ranges[0].from : takeReview.start);
    const to = Math.min(engine.duration, ranges?.length ? ranges.at(-1).to : takeReview.end);
    if (to > from) {
      mark("extent", from, to);
      mark("start", from).dataset.address = takeBoundaryLabel(engine.tickAtSeconds(from));
      mark("end", to).dataset.address = takeBoundaryLabel(engine.tickAtSeconds(to));
    }
    const filled = Number.isFinite(takeReview.completion) ? `${(takeReview.completion * 100).toFixed(1)}% of written singing filled. ` : "";
    const tracked = takeTimeline.coverage === null ? "No written singing" : `${(takeTimeline.coverage * 100).toFixed(1)}% tracked, excluding rests and count-in`;
    const description = `Recording ${takeBoundaryLabel(engine.tickAtSeconds(from))} to ${takeBoundaryLabel(engine.tickAtSeconds(to))} (end exclusive). ${filled}${takeTimeline.segments.length} source segments. ${tracked}. Coverage overview joins rests and tracking gaps shorter than ${takeTimeline.gapSeconds} seconds. End brackets mark recording bounds; ticks above the playbar mark changes of source take, while section boundaries stay inside it. Scores and the detailed contour keep every gap.`;
    elements.timelineRail.title = description;
    elements.takeTimelineDescription.textContent = description;
    elements.seek.setAttribute("aria-describedby", "takeTimelineDescription");
  }

  function audibleTraceReviews() {
    const channels = [...visibleChannels].map(index => mixerParts[index]);
    const matches = review => review?.frames?.length && channels.some(channel =>
      channel.source === review.track && channel.line === (review.ref?.line ?? null));
    if (scoreView === "standard") {
      if (takeState !== "off" || !matches(takeReview) || takeReview.id !== inspectedTakeId) return [];
      return [{...takeReview, octave:takeOctave(takeReview.id)}];
    }
    if (!channels.length) return [];
    const candidates = new Map([...(engine?.takeLayers || [])]);
    for (const [id, review] of takeVisualReviews) if (candidates.has(id)) candidates.set(id, {...review, octave:engine.takeLayers.get(id).octave});
    // A muted selected take can still be inspected in single-part practice.
    // Ensemble listening shows only the recordings that are actually audible.
    if (takeReview && (channels.length === 1 || candidates.has(takeReview.id)))
      candidates.set(takeReview.id, {...takeReview, octave:takeOctave(takeReview.id)});
    return [...candidates.values()].filter(matches)
      .sort((a, b) => Number(a.id === takeReview?.id) - Number(b.id === takeReview?.id));
  }

  function liveTraceVisible() {
    return scoreView === "bars" && Number.isInteger(practicePartIndex)
      && (Boolean(pendingCaptureTrace) || ["counting", "recording", "stopping"].includes(takeState));
  }

  function renderTakeTrace(system, review = takeReview, grey = false) {
    if (!review) return;
    const replacingTrace=practiceWriter && review.id===window.MeletePracticeTrace.id(practiceWriter.key);
    const [from, to] = window.MeleteTakeRender.frameRange(review.frames,
      (engine.secondsAtTick(system.startTick) - review.start) / review.rate,
      (engine.secondsAtTick(system.endTick) - review.start) / review.rate);
    const paths = window.MeleteTakeRender.tracePaths(review.frames, from, to, frame => {
      const seconds = review.start + (frame.start + frame.end) / 2 * review.rate;
      if(replacingTrace && seconds>=practiceWriter.from && seconds<=engine.currentSeconds())return null;
      if (!system.pointAtPitch && pendingCaptureTrace && review.id === `comp:${pendingCaptureTrace.key}`
        && seconds >= pendingCaptureTrace.from && seconds <= (pendingCaptureTrace.to ?? engine.currentSeconds())) return null;
      const tick = engine.tickAtSeconds(seconds);
      const line = review.ref.line ?? null;
      if (pitchRestState(tick, review.track, line) === "discard") return null;
      const cents = frame.cents + (review.octave || 0) * 1200;
      if (!system.pointAtPitch && (cents < system.minPitch * 100 || cents > system.maxPitch * 100)) return null;
      return system.pointAtPitch ? system.pointAtPitch(tick, cents, line, review.track)
        : {x: system.xAtTick(tick), y: system.yAtPitch(cents / 100), track: review.track,
          error: tick < 0 ? "preparation" : expectedPitchErrorCents(tick, frame.cents, line, review.track)};
    // Bound paint nodes by a small color palette, not detector sample count.
    // Coordinates and grades retain their original precision.
    }, error => grey ? "var(--muted)" : pitchTraceColor(Number.isFinite(error) ? Math.round(Math.abs(error) / 2) * 2 : error));
    if (!paths.edges) return;
    const ensemble = !system.pointAtPitch && visibleChannels.size > 1;
    const label = `${trackLabel(review.track, review.ref.line ?? null)}: ${review.label || "Recording"}`;
    const group = createSvgElement("g", {class: "take-pitch-trace-group",
      "data-take-id": review.id, "data-track": review.track, "data-line": review.ref.line ?? "",
      "data-selected": String(review.id === takeReview?.id), "data-ensemble": String(ensemble)});
    const title = createSvgElement("title"); title.textContent = label; group.append(title);
    group.append(createSvgElement("path", {class: "bar-pitch-trace-halo take-pitch-trace-halo", d: paths.halo}));
    for (const [stroke, d] of paths.colors) group.append(createSvgElement("path", {
      class: "bar-pitch-trace-edge take-pitch-trace-edge bar-pitch-trace", d, stroke,
      "data-take-id": review.id, "data-reference": String(grey), opacity: grey ? .65 : 1, "aria-hidden": "true"}));
    if (ensemble) {
      group.append(createSvgElement("path", {class: "take-pitch-trace-hit", d: paths.halo}));
      let press = null;
      group.addEventListener("pointerdown", event => { press = {id:event.pointerId, x:event.clientX, y:event.clientY}; });
      group.addEventListener("pointermove", event => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 8) press = null;
      });
      group.addEventListener("pointerup", event => {
        if (press?.id === event.pointerId && event.pointerType === "touch") showToast(label);
        press = null;
      });
      group.addEventListener("pointercancel", () => { press = null; });
    }
    system.traceLayer.append(group);
  }

  async function previewTake(id) {
    if (takePreviewId === id) { stopTakePreview(); return; }
    if (takeState !== "off") return;
    const take = allTakes().find(item => item.id === id);
    if (!take?.length) return;
    if (take.pitchReference) focusRecordingPart(take.pitchReference);
    stopTakePreview();
    const generation = takePreviewGeneration;
    let ref, captureStart;
    try { ({ref, captureStart} = takeReviewReference(take)); }
    catch (error) { showToast(error.message, "error"); return; }
    takePreviewId = id;
    cancelTakeScoring();
    updateTakePreview();
    let worker, workerUrl;
    try {
      const audible = engine.takeLayers.get(id);
      const blob = audible?.blob || await takeBlob(take);
      let frames = window.MeleteTakePitch.readContour(take);
      const wav = !audible?.buffer || !frames ? await blob.arrayBuffer() : null;
      if (generation !== takePreviewGeneration || takeState !== "off") return;
      engine.ensureAudio();
      const buffer = audible?.buffer || await engine.context.decodeAudioData(wav.slice(0));
      if (generation !== takePreviewGeneration || takeState !== "off") return;
      let result;
      if (!frames) {
        workerUrl = URL.createObjectURL(new Blob([window.MeleteTakePitch.workerSource(embeddedText("pitchy-runtime"))], {type: "text/javascript"}));
        worker = new Worker(workerUrl);
        result = await new Promise((resolve, reject) => {
          const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
          const timer = setTimeout(() => finish(new Error("Take analysis timed out")), 60000);
          takeReviewWorker = {cancel: () => finish(new DOMException("Cancelled", "AbortError"))};
          worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : null, event.data.result);
          worker.onerror = () => finish(new Error("Take analysis unavailable"));
          worker.postMessage({wav, reference: ref, sampleRate: take.sampleRate, includeFrames: true}, [wav]);
        });
        if (generation !== takePreviewGeneration || takeState !== "off") return;
        frames = result.frames;
      }
      if (!take.unsaved && (result || !window.MeleteTakePitch.currentScore(take.pitchScore)
        || !window.MeleteTakePitch.hasPitchBand(take.pitchScore))) {
        result ||= {...window.MeleteTakePitch.scoreFrames(frames, ref, take.frames / take.sampleRate), frames};
        try { await saveTakeAnalysis(take, result); }
        catch {} // An optional cache failure must not prevent original-audio review.
      }
      if (generation !== takePreviewGeneration || takeState !== "off") return;
      takeReview = {id, singerId:window.MeleteStation.sourceSinger(take)?.id, label: `Take ${take.number || "..."}`, ref, frames:shiftedReviewFrames(frames,take), buffer, blob, track: ref.part, rate: ref.rate,
        start: engine.secondsAtTick(captureStart), end: engine.secondsAtTick(ref.end), latency:ref.latency+window.MeleteStation.advanceMs(take)/1000};
      inspectedTakeId = id;
      engine.setTakeReview(takeReview);
      refreshTakePitchTrace();
      renderTakePanel();
    } catch (error) {
      if (generation === takePreviewGeneration) {
        stopTakePreview();
        if (error?.name !== "AbortError") showToast(error.message || "Could not load this take", "error");
      }
    } finally {
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      if (generation === takePreviewGeneration) takeReviewWorker = null;
    }
  }

  async function downloadTake(id) {
    if (takeState !== "off") return;
    const take = allTakes().find(item => item.id === id);
    if (!take?.length) return;
    try {
      downloadTakeBlob(await takeBlob(take), window.MeleteRecording.takeFilename(config.slug || config.title, take));
    } catch { showToast("Could not read the stored take", "error"); }
  }

  function downloadTakeBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadAllTakes() {
    if (takeState !== "off" || takeActionBusy) return;
    const takes = allTakes();
    if (!takes.length || takes.some(take => take.unsaved)) return;
    takeActionBusy = true;
    elements.takeActions.open = false;
    takeNotice = `Preparing ZIP: 0/${takes.length}`;
    renderTakePanel();
    try {
      const blob = await window.MeleteRecording.takeArchive(takes, config.slug || config.title,
        take => takeBlob(take), window.fflate, (done, total) => {
          takeNotice = `Preparing ZIP: ${done}/${total}`;
          renderTakePanel();
        });
      const name = String(config.slug || "melete").replace(/[^a-z0-9_-]+/gi, "-");
      downloadTakeBlob(blob, `${name}-takes.zip`);
      takeNotice = "";
    } catch (error) {
      takeNotice = "ZIP failed. All local takes were kept.";
      showToast(error.message || takeNotice, "error");
    } finally { takeActionBusy = false; renderTakePanel(); }
  }

  async function removeTake(id) {
    if (takeState !== "off" || takeActionBusy) return;
    const take = allTakes().find(take => take.id === id);
    if (!take) return;
    if (take.unsaved) {
      await deleteTakes([id]);
      return;
    }
    takeActionBusy = true;
    renderTakePanel();
    try {
      const record = await takeStore.stageDelete(takeSongKey(), id, Date.now(), {includeFavorites: true});
      if (record) {
        takeLibrary.set(id, record);
        if (takePreviewId === id) stopTakePreview();
        takeLayerLoads.delete(id); engine?.removeTakeLayer(id);
        scheduleTakeDeletion();
        announceTakeChange();
        takeNotice = "";
      } else await loadTakeLibrary();
    } catch (error) { showToast(error.message || "Could not delete take; audio was kept", "error"); }
    finally { takeActionBusy = false; renderTakePanel(); }
  }

  async function undoTakeDeletion() {
    if (takeActionBusy) return;
    takeActionBusy = true;
    renderTakePanel();
    try {
      const restored = await takeStore.undoDeletes(takeSongKey());
      restored.forEach(take => takeLibrary.set(take.id, take));
      takeNotice = restored.length ? `${restored.length} take${restored.length === 1 ? "" : "s"} restored` : "Undo period has ended";
      scheduleTakeDeletion();
      announceTakeChange();
    } catch { showToast("Could not undo deletion; retry before the undo period ends", "error"); }
    finally { takeActionBusy = false; renderTakePanel(); }
  }

  // Quiet deletion is track cleanup: recordings no track or Undo still uses.
  async function deleteTakes(ids, {quiet = false} = {}) {
    if (takeState !== "off" || takeActionBusy) return [];
    takeActionBusy = true;
    renderTakePanel();
    try {
      const deleted = await takeStore.deleteTakes(takeSongKey(), ids, {protectFavorites: quiet});
      takeJournal?.drop(deleted);
      deleted.forEach(id => { takeLibrary.delete(id); takeLayerLoads.delete(id); engine?.removeTakeLayer(id); });
      if (deleted.includes(takePreviewId)) stopTakePreview();
      if (!takeJournal?.entries.size) takeJournal = null;
      if (!quiet) { compPanel?.invalidate(); takeNotice = ""; }
      announceTakeChange();
      return deleted;
    } catch {
      if (!quiet) showToast("Could not delete takes; recordings were kept", "error");
      return [];
    } finally { takeActionBusy = false; renderTakePanel(); }
  }

  function looseTakes(takes = allTakes()) {
    return takes.filter(take => compPanel?.loose(take, takeScoreFailures.has(take.id)));
  }

  async function retryTakeSave() {
    if (takeState !== "off" || takeActionBusy || !takeJournal) return;
    takeActionBusy = true;
    renderTakePanel();
    try {
      await takeJournal.retry();
      takeNotice = takeJournal.failed ? takeSaveError(takeJournal.failed) : "All takes saved locally";
    } finally { takeActionBusy = false; renderTakePanel(); }
  }

  function renderTakePanel() {
    readPracticeTrace();
    ensureCompPanel();
    document.getElementById("downloadMix").disabled = !engine?.takeLayers.size || takeActionBusy || takeState !== "off";
    if (takeLibraryReady) void compPanel?.refresh({active: takeState !== "off"});
    const spec = takeState !== "off" && takeJournal ? takeJournal.spec : recordingLoopSpec();
    const maximumSeconds = Math.max(spec?.seconds || 0, spec?.initial?.seconds || 0);
    const active = takeState !== "off";
    const all = allTakes();
    const dominated = window.MeleteTakePitch.dominatedBy(all);
    for (const header of elements.takePanel.querySelectorAll(".take-columns")) {
      header.dataset.direction = takeSort.direction;
      for (const button of header.querySelectorAll("[data-take-sort]")) {
        const column = button.dataset.takeSort;
        const selected = column === takeSort.column;
        if (selected) button.dataset.sorted = takeSort.direction;
        else delete button.dataset.sorted;
        const next = window.MeleteTakePitch.nextTakeSort(takeSort, column);
        const label = window.MeleteTakePitch.SORT_COLUMNS[column].label;
        button.title = `${selected ? `Sorted ${takeSort.direction}. ` : ""}Sort by ${label}, ${next.direction}`;
        button.setAttribute("aria-label", button.title);
      }
    }
    const pending = Boolean(takeJournal?.entries.size);
    elements.settingsToggle.classList.toggle("has-recording", active && captureIsAudio);
    elements.settingsToggle.title = active ? captureIsAudio ? "Settings; recording audio" : "Settings; pitch practice" : "Settings";
    updatePitchCaptureAppearance();
    const captureStatus = document.getElementById("singRecordingStatus");
    captureStatus.textContent = takeState === "requesting" ? "Connecting..."
      : takeState === "stopping" ? "Saving..." : active ? captureIsAudio ? "Recording" : "Pitch only"
        : pending ? "Unsaved audio" : takeScoring ? "Scoring..." : "";
    elements.takePanel.classList.toggle("has-recording", active && captureIsAudio);
    elements.takeMicrophone.disabled = active || pitchCaptureState !== "off" || Boolean(microphoneCheck?.active);
    elements.checkMicrophone.disabled = !ready || !pitchCaptureSupported() || pitchCaptureState !== "off" || takeState !== "off";
    let status = takeNotice || (spec ? `${spec.label} · ${formatTime(spec.seconds * 1000)}${spec.mode === "loop" ? " per pass" : ""}` : "Move playhead to record");
    if (maximumSeconds > window.MeleteRecording.MAX_LOOP_SECONDS) status = "Choose a loop of 5 minutes or less";
    if (takeState === "requesting") status = "Preparing recording...";
    if (takeState === "counting") status = `Recording count-in · ${spec?.initial?.label || spec?.label || ""}`;
    if (takeState === "armed") status = "Starting loop...";
    if (takeState === "recording") status = captureIsAudio ? `Recording take ${all.find(take => take.active)?.number || "..."}` : "Pitch only";
    if (takeState === "stopping") status = "Saving take...";
    if (elements.takeStatus.textContent !== status) elements.takeStatus.textContent = status;
    elements.takeStatus.title = status;
    elements.takePanel.classList.toggle("has-notice", Boolean(takeNotice && /failed|full|unavailable|interrupted|disconnected|could not/i.test(takeNotice)));
    const bytes = window.MeleteRecording.takeBytes(allTakes(true));
    const totalBytes = bytes + takeOtherBytes;
    elements.takeStorage.querySelector("output").textContent = takeLibraryReady ? storageTotalLabel(totalBytes) : "-- MB";
    elements.takeStorage.title = [
      "Recordings across this site's songs.",
      takeLibraryReady ? `This song: ${all.length} take${all.length === 1 ? "" : "s"} · ${takeSizeLabel(bytes)}.` : "Local storage not loaded.",
      `${takePersistence ? "Persistent storage" : "This browser"}. Microphone only; local autosave, no uploads. Browser data can be cleared; download important takes.`,
    ].join(" ");
    const loose = looseTakes(all);
    elements.takeLoose.hidden = !loose.length;
    elements.takeLooseMessage.textContent = `${config.audition?.enabled ? "Audition takes" : "Recording recovery"} \u00b7 ${takeSizeLabel(window.MeleteRecording.takeBytes(loose))}`;
    elements.deleteLooseTakes.disabled = active || takeActionBusy || !loose.length;
    elements.deleteLooseTakes.dataset.deleteToken = loose.map(t => t.id).sort().join(",");
    const deleted = [...takeLibrary.values()].filter(take => take.deleteAfter);
    elements.takeUndo.hidden = !deleted.length;
    elements.takeUndoMessage.textContent = `${deleted.length} take${deleted.length === 1 ? "" : "s"} deleted`;
    elements.undoTakeDelete.disabled = takeActionBusy || !deleted.some(take => take.deleteAfter > Date.now());
    elements.retryTakeSave.hidden = active || !pending;
    elements.retryTakeSave.disabled = takeActionBusy;
    const filtered = loose.sort((a, b) => window.MeleteTakePitch.compareTakes(
      {...a, pitchScore: wholeSongTakeScore(a)}, {...b, pitchScore: wholeSongTakeScore(b)}, takeSort));
    const takes = filtered.slice(0, takeVisibleCount);
    elements.takeMore.hidden = takes.length === filtered.length;
    elements.takeMore.textContent = `Show more (${takes.length}/${filtered.length})`;
    const key = takes.map(take => take.id).join(",");
    if (elements.takeList.dataset.ids !== key) {
      elements.takeList.dataset.ids = key;
      const existing = new Map([...elements.takeList.children].map(row => [row.dataset.takeId, row]));
      const retained = new Set(takes.map(take => take.id));
      for (const [id, row] of existing) if (!retained.has(id)) takeOctavePagers.delete(row.querySelector(".take-octave"));
      const rows = takes.map(take => {
        if (existing.has(take.id)) return existing.get(take.id);
        const row = document.createElement("div");
        row.className = "take-row";
        row.dataset.takeId = take.id;
        // One selectable summary plus independent download/delete commands.
        row.innerHTML = `<div class="take-summary">
          <button class="take-select" type="button">
          <span class="take-row-label"><span class="take-number"></span><span class="take-part"></span></span>
          <span class="take-segments"></span>
          <span class="take-detail"><span class="take-tracked"><strong></strong></span><span class="take-error"><strong></strong></span><span class="take-median"><strong></strong></span><span class="take-within"><strong></strong></span></span>
          <span class="take-created"></span><span class="take-modified"></span>
          </button>
          <span class="take-warning" hidden>!</span>
          <button class="take-octave" type="button">-</button>
          <span class="take-hear-cell"><button class="icon-button take-hear" type="button" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"></path></svg></button></span>
          <span class="take-row-actions">
          <button class="icon-button take-download" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path></svg></button>
          <button class="icon-button take-delete" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M8 6V3h8v3M10 10v7M14 10v7"></path></svg></button>
          </span>
          </div>`;
        const preview = row.querySelector(".take-select"), download = row.querySelector(".take-download"), remove = row.querySelector(".take-delete");
        preview.addEventListener("click", () => { void previewTake(take.id); });
        attachTakeHear(row.querySelector(".take-hear"), () => take.id, () => { void toggleTakeLayer(take.id); });
        row.addEventListener("click", event => {
          if (!preview.disabled && !event.target.closest("button, [role=spinbutton]")) void previewTake(take.id);
        });
        download.addEventListener("click", () => { void downloadTake(take.id); });
        remove.addEventListener("click", () => { void removeTake(take.id); });
        return row;
      });
      elements.takeList.replaceChildren(...rows);
    }
    takes.forEach(take => {
      const row = elements.takeList.querySelector(`[data-take-id="${take.id}"]`);
      const name = `take ${take.number || "unsaved"}`;
      const better = dominated.get(take.id);
      const comparison = better ? `Outscored by take ${better.number}` : "";
      row.classList.toggle("is-dominated", Boolean(better));
      row.dataset.comparison = comparison;
      row.dataset.takeNumber = take.number || "unsaved";
      row.querySelector(".take-number").textContent = take.number || "...";
      row.querySelector(".take-part").textContent = take.part;
      row.style.setProperty("--take-part-color",trackPaint(take.pitchReference?.part,take.pitchReference?.line ?? null));
      window.MeleteTakeControls.showDates(row, take);
      const bounds = window.MeleteTakePitch.takeBounds(take);
      row.querySelector(".take-segments").textContent = "1";
      const range = `${takeBoundaryLabel(bounds.start)}-${takeBoundaryLabel(bounds.end)}`;
      row.querySelector(".take-row-label").title = [comparison, `Take ${take.number || "..."} · ${take.part} · ${range}`].filter(Boolean).join(". ");
      const warning = take.unsaved ? "Unsaved audio; download or retry saving" : take.gap ? "Audio gap" : !take.active && !take.complete ? "Recovered incomplete audio" : take.peak >= 0.999 ? "Clipping" : take.peak < 0.001 && take.seconds > 1 ? "Very quiet" : "";
      const indicator = row.querySelector(".take-warning");
      indicator.hidden = !warning;
      indicator.title = warning;
      indicator.setAttribute("aria-label", warning);
      const pitch = takePitchLabel(take);
      const detail = row.querySelector(".take-detail");
      detail.querySelector(".take-tracked strong").textContent = pitch.tracked;
      detail.querySelector(".take-error strong").textContent = pitch.error;
      detail.querySelector(".take-median strong").textContent = pitch.median;
      detail.querySelector(".take-within strong").textContent = pitch.within;
      detail.title = [comparison, pitch.title].filter(Boolean).join(". ");
      detail.setAttribute("aria-label", `${pitch.text}. ${detail.title}`);
      row.classList.toggle("is-recording", take.active);
      const preview = row.querySelector(".take-select"), download = row.querySelector(".take-download"), remove = row.querySelector(".take-delete");
      preview.setAttribute("aria-description", [take.part, pitch.text, comparison].filter(Boolean).join(". "));
      for (const [button, label] of [[preview, `Review ${name}`],
        [download, `Download ${name} as WAV`], [remove, `Delete ${name}`]]) {
        button.setAttribute("aria-label", label);
        button.title = label;
      }
      preview.disabled = takeActionBusy || !take.length || (active && takePreviewId !== take.id);
      row.querySelector(".take-hear").disabled = takeActionBusy || !take.length || take.active;
      download.disabled = active || takeActionBusy || !take.length;
      remove.disabled = active || takeActionBusy;
      remove.dataset.deleteToken = `${take.id}:${take.updatedAt}`;
    });
    window.MeleteTakeControls.fitTable(elements.takePanel.querySelector(".take-review"));
    updateTakePreview();
  }

  function showTakePanel() {
    hidePartChooser();
    setSettingsOpen(true, {persist: false});
    setSettingsSection("takes", true, {persist: false});
    renderTakePanel();
    elements.takePanel.querySelector(".take-review").scrollTop = 0;
    elements.checkMicrophone.focus();
  }

  function practiceTraceKeyNow() {
    if(!ready || conductorMode || !Number.isInteger(practicePartIndex))return null;
    return window.MeletePracticeTrace.key(takeSongKey(),practicePartIndex,practiceDivisi[practicePartIndex],
      compPanel?.stationPerson(),pitchTraceFingerprint());
  }
  function reviewPracticeTrace(explicit=true) {
    if (!practiceTraceRecord || takeState!=="off") return;
    const id=practiceTraceIdentity;
    if(explicit && takePreviewId===id && (scoreView==="bars" || inspectedTakeId===id)){stopTakePreview();return;}
    compPanel?.noteExplicitSelection();
    if (takePreviewId!==id) stopTakePreview();
    takePreviewId=id;inspectedTakeId=explicit?id:null;
    takeReview={id,label:trackLabel(practiceTraceRef.part,practiceTraceRef.line)+" pitch practice",ref:practiceTraceRef,
      track:practiceTraceRef.part,rate:1,start:0,end:practiceTraceRef.seconds,frames:practiceTraceRecord.frames};
    renderPitchTrace();updateTakePreview();
  }
  function paintPracticeTraceRow() {
    if(!practiceTraceRow)return;
    const selected=takePreviewId===practiceTraceIdentity && (scoreView!=="standard" || inspectedTakeId===takePreviewId);
    practiceTraceRow.classList.toggle("is-selected",selected);
    const button=practiceTraceRow.querySelector(".comp-review");
    button.setAttribute("aria-pressed",String(selected));button.disabled=takeState!=="off";
    practiceTraceRow.querySelector(".take-delete").disabled=takeState!=="off";
  }
  function readPracticeTrace(force=false,select=false) {
    const k=practiceTraceKeyNow(), id=k?window.MeletePracticeTrace.id(k):"";
    if(!force && practiceTraceIdentity===id){paintPracticeTraceRow();return;}
    const ticket=++practiceTraceTicket,changed=practiceTraceIdentity!==id;
    practiceTraceIdentity=id;
    if(changed && takePreviewId?.startsWith("trace:"))stopTakePreview();
    const selection=takePreviewGeneration;
    const host=document.getElementById("practiceTraceRows");
    practiceTraceRecord=null;practiceTraceRow=null;host.replaceChildren();
    if(!k)return;
    const ref=takePitchReference({start:0,end:sequence.endTick,rate:1},k[2],k[3]===-1?null:k[3]);ref.latency=0;
    void window.MeletePracticeTrace.read(takeStore,k).then(record=>{
      if(ticket!==practiceTraceTicket)return;
      if(!record){if(takePreviewId===id)stopTakePreview();return;}
      const frames=window.MeleteVocalPitch.cleanPitchFrames(window.MeleteTakePitch.cleanRestFrames(window.MeletePracticeTrace.unpack(record.data),ref));
      const stats=window.MeleteTakePitch.scoreFrames(frames,ref,ref.seconds);
      practiceTraceRecord={...record,frames};practiceTraceRef=ref;
      const row=practiceTraceRow=document.getElementById("compRowTemplate").content.firstElementChild.cloneNode(true);
      row.dataset.traceId=id;row.style.setProperty("--take-part-color",trackPaint(ref.part,ref.line));
      row.querySelector(".take-number").textContent="Trace";row.querySelector(".take-singer").textContent=compPanel?.stationPerson()?.name||"";
      row.querySelector(".take-part").textContent=trackLabel(ref.part,ref.line);
      const btn=row.querySelector(".comp-review");
      btn.setAttribute("aria-label","Review saved practice pitch for "+trackLabel(ref.part,ref.line));
      btn.title=`Pitch practice: ${Math.ceil(record.data.byteLength/1024)} KiB of contour data. No recorded audio.`;btn.onclick=()=>reviewPracticeTrace();
      for(const [name,v] of Object.entries(window.MeleteTakeControls.metricValues(stats))) row.querySelector(".comp-"+name).textContent=Number.isFinite(v)?v.toFixed(1):"—";
      for(const el of row.querySelectorAll(".take-octave,.take-hear,.take-download,.take-upload")){el.disabled=true;el.style.visibility="hidden";}
      const del=row.querySelector(".take-delete");del.dataset.deleteToken=id+record.updatedAt;del.setAttribute("aria-label","Delete saved practice contour");
      del.onclick=async()=>{if(takeState!=="off")return;try{await window.MeletePracticeTrace.remove(takeStore,k);readPracticeTrace(true);}
        catch(error){showToast(error.message,"error");}};
      window.MeleteTakeControls.showDates(row,record);host.append(row);paintPracticeTraceRow();
      if((select && selection===takePreviewGeneration && !takePreviewId) || takePreviewId===id) reviewPracticeTrace(false);
    }).catch(()=>{ /* Playback stays available when browser storage is restricted. */ });
  }

  document.getElementById("recordAudio").addEventListener("click",async()=>{
    if (!recordAudio && compPanel?.requireSinger()) {showToast('Choose a singer before recording.');return;}
    if(!recordAudio && !Number.isInteger(practicePartIndex) && mixerParts.length===1) choosePracticePart(mixerParts[0].source,mixerParts[0].line);
    if(!recordAudio && !Number.isInteger(practicePartIndex)){showPartChooser({title:"Record which part?"});
      partChooserThen=()=>document.getElementById("recordAudio").click();return;}
    recordAudio=!recordAudio;
    const audio = recordAudio;
    if (preparingCapture) preparingCapture.audio = audio;
    updatePitchCaptureAppearance();
    if (!wantsPitchCapture()) { disablePitchCapture(false); return; }
    if (!engine.playing) {
      if (audio) void armMicrophone();
      else if (takeState !== "off") await stopTakeRecording("", true, {preserveRecordIntent:true});
      return;
    }
    // Punch in or out against the running transport. A newer press, seek or
    // pause while the previous pass is saving must win.
    const transport = engine.transportRequest;
    if (takeState !== "off") await stopTakeRecording("", false, {preserveRecordIntent:true});
    if (engine.playing && engine.transportRequest === transport && recordAudio === audio && wantsPitchCapture())
      void startTakeRecording({audio, joinOnly:true});
  });

  async function startTakeRecording({audio=recordAudio,joinOnly=false}={}) {
    if (takeState !== "off" || !wantsPitchCapture() || !pitchCapturePageActive || document.hidden || (joinOnly && !engine.playing)) return;
    if (compPanel?.prepareStation) {
      if(preparingCapture) return;
      const pending=preparingCapture={audio}, transport=engine.transportRequest;
      try {
        await compPanel.prepareStation(audio);
        if(preparingCapture!==pending || transport!==engine.transportRequest) return;
        audio=pending.audio;
      } catch(error) {
        if(preparingCapture===pending) showToast(error.message || "Could not prepare this singer's recording.", "error");
        return;
      } finally {if(preparingCapture===pending) preparingCapture=null;}
      if (takeState !== "off" || !pitchCapturePageActive || document.hidden || !wantsPitchCapture() || (joinOnly && !engine.playing)) return;
    }
    if (!Number.isInteger(practicePartIndex)) {
      showToast("Show one part in See to record; hold its name to isolate it."); return;
    }
    if (takeActionBusy || takeJournal?.entries.size) {
      showToast("Save or download the pending recording before starting another.", "error"); return;
    }
    const keepAudio=audio && recordAudio;
    let spec = recordingLoopSpec();
    if (!spec || keepAudio && Math.max(spec.seconds, spec.initial?.seconds || 0) > window.MeleteRecording.MAX_LOOP_SECONDS) {
      showToast("Choose a passage of 5 minutes or less to record.", "error"); renderTakePanel(); return;
    }
    if (!pitchCaptureSupported()) { showToast("Microphone recording is unavailable here", "error"); return; }
    // Pitchbar keeps the selected comp's untouched phrases during overdub.
    captureIsAudio=keepAudio;
    recordingBarRanges = new Map(barSystems.map(({startTick,endTick,minPitch,maxPitch,referencePitch}) =>
      [startTick + ":" + endTick, {minPitch,maxPitch,referencePitch}]));
    const targetKey = keepAudio ? compPanel?.recordingKey() : null;
    engine.setOverdubTarget(targetKey,keepAudio ? compPanel?.stationPerson()?.id : null);
    pendingCaptureTrace = keepAudio ? {key: targetKey, from:engine.secondsAtTick(spec.initial.start), to:null} : null;
    const joining = engine.playing;
    if (!joining) {
      engine.pauseTransport();
      api.tickPosition = Math.max(0, spec.initial.start);
    }
    pitchCaptureNotice = "";
    savePreferences();
    takeState = "requesting";
    resetPitchTraceGrid();
    if (scoreView === "standard") renderPitchTrace();
    takeNotice = "";
    const generation = ++takeRequestGeneration;
    renderTakePanel();
    try {
      if(keepAudio){await loadTakeLibrary();await checkTakeSpace(spec);}else await takeStore.open();
      if (generation !== takeRequestGeneration) return;
      await ensureMicrophoneInput();
      if (generation !== takeRequestGeneration) { syncMicrophoneActivity(); return; }
      let journal, initialAudio;
      const capture = keepAudio ? await window.MeleteRecording.PcmCapture.create(pitchCaptureContext, pitchCaptureSource,
        (frame, samples) => {
          if (journal) journal.append(frame, samples);
          else initialAudio = {frame, samples};
        },
        error => { void stopTakeRecording(error.message, true, {discardShortTail: false}); }) : null;
      if (generation !== takeRequestGeneration) { await capture?.stop(); syncMicrophoneActivity(); return; }
      takeCapture = capture;
      if (joining) {
        spec = recordingLoopSpec();
        if (!spec) { await stopTakeRecording("Playback ended", true); return; }
        const start = engine.tickAtSeconds(engine.currentSeconds());
        spec.initial = {start, entry: start, leadInSeconds: 0,
          seconds: (engine.secondsAtTick(spec.end) - engine.secondsAtTick(start)) / engine.rate,
          label: `${scoreLocationAtTick(start)}-${spec.label.split("-").at(-1)}`};
        if (spec.mode === "segment") Object.assign(spec, {start, seconds: spec.initial.seconds});
      }
      if (compPanel) spec = compPanel.recordingPlan(spec);
      spec.pitchReference = takePitchReference(spec);
      if (spec.initial) spec.initial.pitchReference = takePitchReference({...spec, ...spec.initial});
      if(!keepAudio) practiceWriter=window.MeletePracticeTrace.writer(takeStore,practiceTraceKeyNow(),spec,error=>{
        const message=error?.name==="QuotaExceededError" ? "Storage full. Pitch practice stopped at the last saved point." : "Pitch practice could not be saved locally.";
        void stopTakeRecording(message,true);showToast(message,"error");
      });
      else journal = new window.MeleteRecording.TakeJournal(takeStore, takeSongKey(), spec, pitchCaptureContext.sampleRate, {
        onSaved: record => {
          takeLibrary.set(record.id, record);
          if (record.finalized && takeState === "stopping" && pendingCaptureTrace) pendingCaptureTrace.id = record.id;
          announceTakeChange();
          renderTakePanel();
          if (record.finalized) window.setTimeout(() => { void scoreNextTake(); }, 0);
        },
        onDiscard: id => {
          takeLibrary.delete(id);
          if (pendingCaptureTrace) { pendingCaptureTrace = null; resetPitchTraceGrid(); renderPitchTrace(); }
          takeNotice = "";
          announceTakeChange();
          renderTakePanel();
        },
        onError: error => {
          if (takeJournal !== journal) return;
          void stopTakeRecording(takeSaveError(error), true, {discardShortTail: false});
          showTakePanel();
        },
      });
      takeJournal = journal || null;
      // The ready block may straddle the transport start. Keep its real samples
      // so TakeBuffer can recover that boundary without inserting silence.
      if (initialAudio) journal.append(initialAudio.frame, initialAudio.samples);
      takeState = joining ? "recording" : "armed";
      if (joining) {
        if(practiceWriter)practiceWriter.from=engine.currentSeconds();
        (practiceWriter || journal).begin(Math.round(pitchCaptureContext.currentTime * pitchCaptureContext.sampleRate));
      }
      activateCachedPitchCapture({quiet: true});
      takeRefreshTimer = window.setInterval(renderTakePanel, 250);
      renderTakePanel();
      const direction = playbackDirection();
      if (direction) scrollToPlayback(direction, "auto", true);
      window.clearTimeout(takeCountHideTimer);
      elements.takeCountIn.hidden = true;
      if (!joining) await engine.startTransport({allowLoopLeadIn: true,
        recordingLeadIn: engine.secondsAtTick(spec.initial.start)});
      if (keepAudio && !takePersistenceRequested && generation === takeRequestGeneration) {
        takePersistenceRequested = true;
        void navigator.storage?.persist?.().then(granted => { takePersistence = granted; renderTakePanel(); }).catch(() => {});
      }
      if (generation === takeRequestGeneration && !engine.playing && !engine.starting) {
        await stopTakeRecording("Playback could not start", true);
      }
    } catch (error) {
      if (generation !== takeRequestGeneration) return;
      console.error("Loop recording could not start", error);
      recordAudio=false;
      const message = error?.name === "QuotaExceededError" ? "Storage full. Delete unwanted takes before recording."
        : !takeLibraryReady ? "Local storage unavailable. Enable site storage to record." : microphoneFailureMessage(error);
      await stopTakeRecording(message, true);
      showTakePanel();
      showToast(takeNotice, "error");
    }
  }

  function stopTakeRecording(message = "", pausePlayback = false, {discardShortTail = true, preserveRecordIntent=false} = {}) {
    preparingCapture=null;
    if (!preserveRecordIntent && recordAudio) {
      recordAudio = false;
      if (!singEnabled && takeState === "off") disablePitchCapture(false, {preservePreference:true});
      else updatePitchCaptureAppearance();
    }
    if (takeState === "off") return Promise.resolve();
    if (takeState === "stopping") return takeStopPromise || Promise.resolve();
    ++takeRequestGeneration;
    takeCountIn?.cancel();
    takeCountIn = null;
    window.clearTimeout(takeCountHideTimer);
    elements.takeCountIn.hidden = true;
    takeState = "stopping";
    if (pendingCaptureTrace) pendingCaptureTrace.to = engine.currentSeconds();
    stopPitchSampling();
    takeNotice = ["Stopped", "Count-in canceled"].includes(message) ? "" : message;
    const journal = captureIsAudio ? takeJournal : null, writer=practiceWriter, finishingTrace=writer?.finish();
    practiceWriter=null;
    journal?.finish((pitchCaptureContext?.currentTime || 0) * (pitchCaptureContext?.sampleRate || 1), {
      discardShortTail,
      trimStopNoise: discardShortTail,
      segment: discardShortTail ? (record, seconds) => {
        const ref = record.pitchReference;
        const end = Math.min(record.end, engine.tickAtSeconds(engine.secondsAtTick(record.start) + seconds * record.rate));
        return {end, label: `${record.label.split("-")[0]}-${scoreLocationAtTick(end)}`,
          pitchReference: ref && window.MeleteTakePitch.trimReference(ref, end, seconds)};
      } : null,
    });
    const capture = takeCapture;
    takeCapture = null;
    window.clearInterval(takeRefreshTimer);
    takeRefreshTimer = 0;
    if (pausePlayback) engine?.pauseTransport();
    engine?.setOverdubTarget(null);
    renderTakePanel();
    takeStopPromise = (async () => {
      try { await capture?.stop(); await journal?.flush(); await finishingTrace; }
      finally {
        takeState = "off";
        // Pitchbar keeps live samples until the persisted comp swaps in.
        renderPitchTrace();
        recordingBarRanges = null;
        takeStopPromise = null;
        if (journal?.failed) takeNotice = takeSaveError(journal.failed);
        if (wantsPitchCapture() && pitchCapturePageActive && !document.hidden && !takeNotice) {
          if (pitchInputIsLive()) { pitchCaptureState = "armed"; updatePitchCaptureAppearance(); }
          else void armMicrophone();
        } else disablePitchCapture(false, {preservePreference: true, reason: takeNotice});
        renderTakePanel();
        if(writer){const same=JSON.stringify(writer.key)===JSON.stringify(practiceTraceKeyNow());
          readPracticeTrace(true,same && !writer.failed);void refreshRecordingTime();}
        void scoreNextTake();
      }
    })();
    return takeStopPromise;
  }

  async function clearTakes() {
    await stopTakeRecording("Stopped", true);
    if (takeActionBusy) return;
    const loose = looseTakes();
    const ids = loose.map(take => take.id);
    if (!ids.length) {
      showToast("Every recording here belongs to a track or its Undo, so all were kept.");
      return;
    }
    await deleteTakes(ids);
  }

  function takeTransportChanged(kind) {
    if (kind === "play" && ["requesting", "counting"].includes(takeState)) {
      void stopTakeRecording("Count-in canceled", true);
      return;
    }
    if ((kind === "play" && takeState === "armed") || (kind === "loop" && takeState === "recording")) {
      if (kind === "loop" && takeJournal?.spec.station?.stage === "scratchpad") {
        const next = compPanel?.advanceStart(takeJournal.spec.initial?.trackSlot);
        if (next) {
          engine.setOverdubTarget(next,compPanel?.stationPerson()?.id);
          pendingCaptureTrace = {key: next, from: engine.loopStartSeconds, to: null};
        }
      }
      takeState = kind === "play" && takeJournal?.spec.initial?.countInPlan ? "counting" : "recording";
      if(practiceWriter)practiceWriter.from=kind==="loop" ? engine.loopStartSeconds : engine.secondsAtTick(practiceWriter.spec.initial.start);
      (practiceWriter || takeJournal).begin(Math.round(pitchCaptureContext.currentTime * pitchCaptureContext.sampleRate));
      if (kind === "play" && takeState === "counting") {
        // Guide music, microphone frames and beat cues share one start. The
        // count-in stays in the first take; entering never cuts or restarts it.
        const plan = takeJournal.spec.initial.countInPlan || window.MeleteRecording.countInPlan(sequence.measures, sequence.division,
          takeJournal.spec.initial.entry, tick => engine.secondsAtTick(tick), engine.rate);
        const countIn = new window.MeleteRecording.CountIn(engine.context, engine.master, plan, beat => {
          elements.takeCountIn.querySelector("strong").textContent = String(beat.label);
          elements.takeCountIn.dataset.beat = String(beat.label);
          elements.takeCountIn.hidden = false;
          elements.takeCountIn.getAnimations().forEach(animation => animation.cancel());
          if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            elements.takeCountIn.animate([{opacity: 1}, {opacity: 0.65}], {duration: 280, fill: "forwards"});
          }
        }, window, engine.anchorTime);
        takeCountIn = countIn;
        void countIn.done.then(counted => {
          if (takeCountIn !== countIn || takeState !== "counting") return;
          if (!counted) { void stopTakeRecording("Count-in interrupted", true); return; }
          takeState = "recording";
          takeCountHideTimer = window.setTimeout(() => { elements.takeCountIn.hidden = true; }, 300);
          renderTakePanel();
        });
      }
      renderTakePanel();
      startPitchSampling();
    } else if (!["play", "loop"].includes(kind) && takeState !== "off" && takeState !== "stopping") {
      void stopTakeRecording(["pause","end"].includes(kind) ? "Stopped" : "Stopped: playback changed",
        kind !== "pause",{preserveRecordIntent:true});
    }
  }

  function togglePracticePlayback() {
    if(preparingCapture){preparingCapture=null;engine?.pauseTransport();return;}
    if (takeState !== "off") {
      if (takeState === "stopping") engine?.pauseTransport();
      void stopTakeRecording(["requesting", "counting"].includes(takeState) ? "Count-in canceled" : "Stopped",
        true, {discardShortTail: true,preserveRecordIntent:true});
    }
    else {
      engine?.toggleTransport();
    }
  }

  function restoreScoreRenderStyleLock() {
    if (!scoreRenderStyleLock) return;
    const { height, overflow } = scoreRenderStyleLock;
    elements.score.style.height = height;
    elements.score.style.overflow = overflow;
    elements.score.classList.remove("is-rendering-score");
    elements.score.removeAttribute("aria-busy");
    scoreRenderStyleLock = null;
  }

  function discardScoreRenderSnapshot() {
    window.clearTimeout(scoreRenderSnapshotTimer);
    scoreRenderSnapshotTimer = 0;
    scoreRenderSnapshot?.remove();
    scoreRenderSnapshot = null;
    restoreScoreRenderStyleLock();
  }

  function retainCurrentScoreFrame() {
    if (scoreRenderSnapshot?.classList.contains("is-revealing")) {
      discardScoreRenderSnapshot();
    } else if (scoreRenderSnapshot) {
      return true;
    }
    if (!elements.score.querySelector(".at-surface-svg")) return false;

    const shellBounds = elements.scoreShell.getBoundingClientRect();
    const scoreBounds = elements.score.getBoundingClientRect();
    if (!scoreBounds.width || !scoreBounds.height) return false;

    const snapshot = document.createElement("div");
    snapshot.className = "score-render-snapshot";
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.inert = true;
    snapshot.style.left = `${scoreBounds.left - shellBounds.left}px`;
    snapshot.style.top = `${scoreBounds.top - shellBounds.top}px`;
    snapshot.style.width = `${scoreBounds.width}px`;
    snapshot.style.height = `${scoreBounds.height}px`;

    const frame = elements.score.cloneNode(true);
    frame.removeAttribute("id");
    frame.removeAttribute("aria-label");
    frame.removeAttribute("aria-busy");
    frame.classList.remove("is-rendering-score");
    frame.classList.add("score-render-frame");
    frame.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    frame.querySelectorAll(".score-note-editor").forEach((editor) => editor.remove());
    frame.style.width = `${Math.max(elements.score.scrollWidth, elements.score.clientWidth)}px`;
    frame.style.transform = `translateX(${-elements.score.scrollLeft}px)`;
    snapshot.append(frame);
    elements.scoreShell.append(snapshot);
    scoreRenderSnapshot = snapshot;

    scoreRenderStyleLock = {
      height: elements.score.style.height,
      overflow: elements.score.style.overflow,
    };
    elements.score.style.height = `${scoreBounds.height}px`;
    elements.score.style.overflow = "hidden";
    elements.score.classList.add("is-rendering-score");
    elements.score.setAttribute("aria-busy", "true");
    return true;
  }

  function releaseScoreRenderSnapshot() {
    restoreScoreRenderStyleLock();
    const snapshot = scoreRenderSnapshot;
    if (!snapshot) return;
    // The snapshot is a deep clone, so as it fades out across the live score
    // every translucent overlay is painted twice and its tint visibly darkens
    // for the length of the fade. Notation is opaque and cross-fades cleanly;
    // the highlights are not, so drop them here and let the live ones, which
    // are already in the right place for the new layout, show through alone.
    snapshot.querySelectorAll(".at-cursor-bar, .at-cursor-beat, .at-selection, .score-selected-part, .score-pitch-trace")
      .forEach((overlay) => overlay.remove());
    snapshot.classList.add("is-revealing");
    const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 130;
    scoreRenderSnapshotTimer = window.setTimeout(() => {
      if (scoreRenderSnapshot !== snapshot) return;
      snapshot.remove();
      scoreRenderSnapshot = null;
      scoreRenderSnapshotTimer = 0;
    }, delay);
  }

  function clearNotationRenderTimeout() {
    window.clearTimeout(notationRenderTimeout);
    notationRenderTimeout = 0;
  }

  function beginNotationRenderTimeout() {
    clearNotationRenderTimeout();
    notationRenderTimeout = window.setTimeout(handleNotationRenderTimeout, NOTATION_RENDER_TIMEOUT_MS);
  }

  function finishFailedNotationReload() {
    if (!pendingNotationReload) return;
    const shouldResume = pendingNotationReload.resume;
    pendingNotationReload = null;
    if (shouldResume) void engine?.startTransport();
  }

  function handleNotationRenderTimeout() {
    notationRenderTimeout = 0;
    if (!notationRenderInFlight || scoreView !== "standard") return;
    notationRenderInFlight = false;
    notationRenderQueued = false;
    discardScoreRenderSnapshot();

    const current = horizontalControl.value();
    const next = STANDARD_HORIZONTAL_VALUES.find((value) => value > current);
    if (next === undefined || !scoreTracks.length) {
      notationRenderFailed = true;
      finishFailedNotationReload();
      syncScoreLoadingVisibility();
      showToast("Standard notation could not be engraved", "error");
      return;
    }

    horizontalControl.setValue(next, false);
    savePreferences();
    setNotationLoadingMessage(`Trying ${next}% Stretch…`);
    showToast(`Notation retrying at ${next}% Stretch`);
    requestAnimationFrame(performNotationRender);
  }

  function performNotationRender() {
    renderTimer = 0;
    if (!api || !scoreTracks.length || scoreView !== "standard") return;
    elements.score.hidden = !visibleTracks.size;
    if (notationRenderInFlight) {
      notationRenderQueued = true;
      return;
    }
    if (!visibleTracks.size) {
      // AlphaTab ignores renderTracks([]), so handle the empty view ourselves.
      notationRenderQueued = false;
      clearNotationRenderTimeout();
      discardScoreRenderSnapshot();
      return;
    }
    cancelPitchAuditions();
    cancelScoreScrub();
    notationRenderInFlight = true;
    notationRenderQueued = false;
    notationRenderFailed = false;
    syncScoreLoadingVisibility();
    retainCurrentScoreFrame();
    try {
      api.settings.display.layoutMode = flow === "continuous" ? window.alphaTab.LayoutMode.Horizontal : window.alphaTab.LayoutMode.Page;
      api.settings.display.scale = verticalControl.value() / 100;
      api.settings.display.stretchForce = horizontalControl.value() / 100;
      applyMeasureNumberSettings();
      api.updateSettings();
      beginNotationRenderTimeout();
      api.renderTracks(scoreTracks.filter((_, index) => visibleTracks.has(index)));
    } catch (error) {
      clearNotationRenderTimeout();
      notationRenderInFlight = false;
      notationRenderQueued = false;
      discardScoreRenderSnapshot();
      console.error(error);
      showToast("Score display could not update", "error");
    }
  }

  function finishScheduledNotationRender() {
    if (!notationRenderInFlight) return true;
    clearNotationRenderTimeout();
    notationRenderInFlight = false;
    if (notationRenderQueued && scoreView === "standard") {
      notationRenderQueued = false;
      requestAnimationFrame(performNotationRender);
      return false;
    }
    notationRenderQueued = false;
    requestAnimationFrame(() => requestAnimationFrame(releaseScoreRenderSnapshot));
    return true;
  }

  function syncNotationOverflow() {
    let width = elements.score.clientWidth;
    if (flow !== "continuous") for (let i = 0; i < (api?.score?.masterBars.length || 0); i++) {
      const box = api.boundsLookup?.findMasterBarByIndex(i)?.realBounds;
      if (box) {
        width = Math.max(width, Math.ceil(box.x + box.w + 12));
        const system = api.boundsLookup.findMasterBarByIndex(i).staffSystemBounds.realBounds;
        system.w = Math.max(system.w, box.x + box.w - system.x);
      }
    }
    const overflow = flow !== "continuous" && width > elements.score.clientWidth + 2;
    elements.score.classList.toggle("has-horizontal-overflow", overflow);
    elements.score.style.setProperty("--notation-content-width", `${width}px`);
  }

  function scheduleRender() {
    if (conductor) { conductor.draw(); return; }
    if (scoreView === "bars") {
      scheduleBarRender();
      return;
    }
    if (!api || !scoreTracks.length) return;
    notationRenderFailed = false;
    syncScoreLoadingVisibility();
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(performNotationRender, 80);
  }

  function touchDistance(touches) {
    if (touches.length < 2) return 0;
    return Math.hypot(
      touches[1].clientX - touches[0].clientX,
      touches[1].clientY - touches[0].clientY,
    );
  }

  function beginScorePinch(event) {
    if (event.touches.length !== 2) return;
    cancelScoreScrub();
    cancelPitchAuditions();
    pinchStartDistance = touchDistance(event.touches);
    if (pinchStartDistance <= 0) return;
    pinchActive = true;
    pinchSurface = event.currentTarget;
    pinchStartScale = verticalControl.value();
    pinchTargetScale = pinchStartScale;
    const bounds = pinchSurface.getBoundingClientRect();
    const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - bounds.left + pinchSurface.scrollLeft;
    const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - bounds.top;
    pinchSurface.classList.add("is-pinching");
    pinchSurface.style.transformOrigin = `${centerX}px ${centerY}px`;
    event.preventDefault();
  }

  function updateScorePinch(event) {
    if (!pinchActive || event.touches.length !== 2) return;
    const distance = touchDistance(event.touches);
    if (distance <= 0) return;
    const minimum = VERTICAL_VALUES[0];
    const maximum = VERTICAL_VALUES.at(-1);
    const continuousTarget = clamp(pinchStartScale * distance / pinchStartDistance, minimum, maximum);
    pinchTargetScale = nearestAllowed(continuousTarget, VERTICAL_VALUES);
    pinchSurface.style.transform = `scale(${continuousTarget / pinchStartScale})`;
    event.preventDefault();
  }

  function finishScorePinch(event) {
    if (!pinchActive || event.touches.length >= 2) return;
    pinchActive = false;
    pinchSurface?.classList.remove("is-pinching");
    pinchSurface?.style.removeProperty("transform");
    pinchSurface?.style.removeProperty("transform-origin");
    pinchSurface = null;
    verticalControl.setValue(pinchTargetScale, false);
    savePreferences();
    scheduleRender();
  }

  function updateSeekAppearance(milliseconds) {
    const progress = timelineFraction(milliseconds / 1000) * 100;
    elements.timelineRail.style.setProperty("--seek-progress", `${progress}%`);
  }

  function timelineFraction(seconds) {
    const start = engine?.secondsAtTick(pitchTraceOriginTick()) || 0;
    return clamp((seconds - start) / Math.max(.001, (engine?.duration || 1) - start), 0, 1);
  }

  function observePlaybackCursor(barCursor, beatCursor) {
    if (typeof MutationObserver === "undefined"
      || (cursorTrimTargets[0] === barCursor && cursorTrimTargets[1] === beatCursor)) return;
    cursorTrimObserver?.disconnect();
    cursorTrimTargets = [barCursor, beatCursor];
    // AlphaTab places cursors in a later frame than its position event. Observe
    // the actual placement so a paused first seek cannot retain the old crop.
    cursorTrimObserver = new MutationObserver(trimPlaybackCursor);
    for (const cursor of cursorTrimTargets) {
      cursorTrimObserver.observe(cursor, { attributes: true, attributeFilter: ["style"] });
    }
  }

  function trimPlaybackCursor() {
    if (scoreView === "bars") return;
    const barCursor = elements.score.querySelector(".at-cursor-bar");
    const beatCursor = elements.score.querySelector(".at-cursor-beat");
    if (!barCursor || !beatCursor) return;
    observePlaybackCursor(barCursor, beatCursor);

    const cursorBounds = beatCursor.getBoundingClientRect();
    if (!cursorBounds.height) return;
    const surfaces = [...elements.score.querySelectorAll(".at-surface-svg")];
    const surface = surfaces.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return bounds.top <= cursorBounds.top + 1 && bounds.bottom >= cursorBounds.bottom - 1;
    }) || surfaces.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      const midpoint = cursorBounds.top + cursorBounds.height / 2;
      return bounds.top <= midpoint && bounds.bottom >= midpoint;
    });

    if (!surface) return;
    const surfaceBounds = surface.getBoundingClientRect();
    let geometry = cursorStaffGeometry.get(surface);
    if (!geometry || geometry.width !== surfaceBounds.width || geometry.height !== surfaceBounds.height) {
      const lines = [...surface.querySelectorAll("rect")].filter(element =>
        element.getAttribute("fill")?.toLowerCase() === "#a5a5a5")
        .map(element => element.getBoundingClientRect())
        .filter(bounds => bounds.width >= 20 && bounds.height > 0 && bounds.height <= 3)
        .map(bounds => ({top: bounds.top - surfaceBounds.top, bottom: bounds.bottom - surfaceBounds.top}));
      geometry = {width: surfaceBounds.width, height: surfaceBounds.height, lines};
      cursorStaffGeometry.set(surface, geometry);
    }
    // Engraved staff geometry is static between layouts. Only the cursor moves.
    const staffLines = geometry.lines.map(line => ({top: surfaceBounds.top + line.top, bottom: surfaceBounds.top + line.bottom}))
      .filter(bounds => bounds.top >= cursorBounds.top - 2 && bounds.bottom <= cursorBounds.bottom + 2);

    if (!staffLines.length) return;
    const staffTop = Math.min(...staffLines.map((bounds) => bounds.top));
    const staffBottom = Math.max(...staffLines.map((bounds) => bounds.bottom));
    const topInset = clamp((staffTop - cursorBounds.top) / cursorBounds.height * 100, 0, 48);
    const bottomInset = clamp((cursorBounds.bottom - staffBottom) / cursorBounds.height * 100, 0, 48);
    for (const cursor of [barCursor, beatCursor]) {
      const top = `${topInset}%`, bottom = `${bottomInset}%`;
      if (cursor.style.getPropertyValue("--cursor-clip-top") !== top) {
        cursor.style.setProperty("--cursor-clip-top", top);
      }
      if (cursor.style.getPropertyValue("--cursor-clip-bottom") !== bottom) {
        cursor.style.setProperty("--cursor-clip-bottom", bottom);
      }
    }
  }

  function scheduleCursorTrim() {
    if (cursorTrimFrame) return;
    cursorTrimFrame = requestAnimationFrame(() => {
      cursorTrimFrame = 0;
      trimPlaybackCursor();
    });
  }

  function scheduleCursorTrimBurst(passes = 8) {
    const generation = ++cursorTrimBurstGeneration;
    let frame = 0;
    const trimAfterPaint = () => {
      if (generation !== cursorTrimBurstGeneration) return;
      trimPlaybackCursor();
      frame += 1;
      if (frame < passes) requestAnimationFrame(trimAfterPaint);
    };
    requestAnimationFrame(trimAfterPaint);
  }

  function cancelVerticalFollowAnimation(clearPrediction = false) {
    verticalFollowAnimationGeneration += 1;
    if (verticalFollowAnimationFrame) cancelAnimationFrame(verticalFollowAnimationFrame);
    verticalFollowAnimationFrame = 0;
    if (clearPrediction) predictiveFollowRange = null;
  }

  function interruptVerticalFollow(event) {
    pendingLoopRevealTick = null;
    if (verticalFollowAnimationFrame || predictiveFollowRange) cancelVerticalFollowAnimation(true);
    // Real input must also end the grace period after a completed auto-scroll.
    automaticScrollUntil = 0;
    if (event?.target instanceof Node && elements.score.contains(event.target)) {
      horizontalGestureUntil = performance.now() + 200;
    }
  }

  function followScrollDuration(distance) {
    if (reducedFollowMotion?.matches) return 0;
    return clamp(150 + Math.sqrt(Math.max(0, distance)) * 8, 180, 520);
  }

  function animateVerticalFollow(destination, duration) {
    cancelVerticalFollowAnimation();
    const start = window.scrollY;
    const target = Math.max(0, Number(destination) || 0);
    const distance = target - start;
    const animationDuration = Math.max(0, Number(duration) || 0);
    automaticScrollUntil = Date.now() + animationDuration + 120;
    if (Math.abs(distance) < 1 || animationDuration === 0) {
      window.scrollTo({ top: target, behavior: "auto" });
      return;
    }
    const generation = ++verticalFollowAnimationGeneration;
    const startedAt = performance.now();
    const frame = (now) => {
      if (generation !== verticalFollowAnimationGeneration) return;
      const progress = clamp((now - startedAt) / animationDuration, 0, 1);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      window.scrollTo({ top: start + distance * eased, behavior: "auto" });
      if (progress < 1) verticalFollowAnimationFrame = requestAnimationFrame(frame);
      else verticalFollowAnimationFrame = 0;
    };
    verticalFollowAnimationFrame = requestAnimationFrame(frame);
  }

  function masterBarLayoutBox(measureIndex) {
    const lookup = api?.boundsLookup || api?.renderer?.boundsLookup;
    const masterBounds = lookup?.findMasterBarByIndex?.(measureIndex);
    return masterBounds?.realBounds || masterBounds?.visualBounds || masterBounds?.lineAlignedBounds || null;
  }

  function notationFollowBox(measureIndex) {
    const box = masterBarLayoutBox(measureIndex);
    const availableHeight = window.innerHeight - 20 - elements.transport.getBoundingClientRect().height - 8;
    if (!box || box.h <= availableHeight || !Number.isInteger(practicePartIndex)
      || !visibleTracks.has(practicePartIndex)) return box;
    const lookup = api?.boundsLookup || api?.renderer?.boundsLookup;
    const master = lookup?.findMasterBarByIndex?.(measureIndex);
    const staves = (master?.bars || [])
      .filter(bounds => partIndexForTrack(bounds.bar?.staff?.track) === practicePartIndex)
      .map(bounds => bounds.realBounds || bounds.visualBounds)
      .filter(bounds => Number.isFinite(bounds?.y) && bounds.h > 0);
    if (!staves.length) return box;
    const top = Math.min(...staves.map(staff => staff.y));
    const bottom = Math.max(...staves.map(staff => staff.y + staff.h));
    // AlphaTab's bar bounds cover staff lines, not ledger notes or lyrics.
    const lineHeight = Math.max(...staves.map(staff => staff.h));
    const room = Math.max(0, availableHeight - (bottom - top));
    const paddedTop = Math.max(box.y, top - Math.min(lineHeight, room * 0.4));
    const paddedBottom = Math.min(box.y + box.h, bottom + Math.min(lineHeight * 1.5, room * 0.6));
    return { x: box.x, y: paddedTop, w: box.w, h: paddedBottom - paddedTop, focused: true };
  }

  function nextVerticalSystemTransition(cursor) {
    if (!engine || flow === "continuous") return null;
    const currentTick = clamp(engine.tickAtSeconds(engine.currentSeconds()), 0, Math.max(0, sequence.endTick - 1));
    if (scoreView === "bars") {
      const systemIndex = barSystems.findIndex((system) => currentTick >= system.startTick && currentTick < system.endTick);
      const nextSystem = systemIndex >= 0 ? barSystems[systemIndex + 1] : null;
      if (!nextSystem) return null;
      const bounds = nextSystem.shell.getBoundingClientRect();
      return { currentTick, tick: nextSystem.startTick, bounds: { top: bounds.top, bottom: bounds.bottom } };
    }

    const currentMeasureIndex = measureIndexAtTick(currentTick);
    const currentBox = masterBarLayoutBox(currentMeasureIndex);
    const currentY = Number(currentBox?.y);
    if (!Number.isFinite(currentY)) return null;
    let nextMeasureIndex = -1;
    let nextBox = null;
    for (let index = currentMeasureIndex + 1; index < sequence.measures.length; index += 1) {
      const candidate = masterBarLayoutBox(index);
      const candidateY = Number(candidate?.y);
      if (!Number.isFinite(candidateY) || Math.abs(candidateY - currentY) <= 1) continue;
      nextMeasureIndex = index;
      nextBox = candidate;
      break;
    }
    if (nextMeasureIndex < 0 || !nextBox) return null;
    nextBox = notationFollowBox(nextMeasureIndex) || nextBox;
    const origin = elements.score.getBoundingClientRect();
    const nextTop = origin.top + Number(nextBox.y) - elements.score.scrollTop;
    const nextHeight = Math.max(1, Number(nextBox.h) || Number(currentBox.h));
    return {
      currentTick,
      tick: Number(sequence.measures[nextMeasureIndex]?.[0]) || 0,
      bounds: { top: nextTop, bottom: nextTop + nextHeight },
    };
  }

  function predictiveVerticalFollow(cursor) {
    if (verticalFollowAnimationFrame || flow === "continuous") return false;
    const transition = nextVerticalSystemTransition(cursor);
    if (!transition) return false;
    if (engine.hasLoop()) {
      const end = loopTickRange().end;
      if (transition.currentTick < end && transition.tick >= end) return false;
    }
    const header = elements.transport.getBoundingClientRect().height;
    const topLimit = header + 8;
    const bottomLimit = window.innerHeight - 20;
    if (transition.bounds.bottom <= bottomLimit) return false;
    const targetHeight = Math.max(1, transition.bounds.bottom - transition.bounds.top);
    const delta = transition.bounds.top - readingLine(targetHeight, topLimit, bottomLimit);
    if (delta <= 1) return false;
    const destination = window.scrollY + delta;
    const duration = followScrollDuration(Math.abs(destination - window.scrollY));
    const secondsUntilTransition = engine.secondsAtTick(transition.tick) - engine.currentSeconds();
    if (secondsUntilTransition < 0
      || secondsUntilTransition > (duration + FOLLOW_SCROLL_LEAD_BUFFER_MS) / 1000) return false;
    predictiveFollowRange = { startTick: transition.currentTick, targetTick: transition.tick };
    playbackDetached = false;
    hidePlaybackReturn();
    animateVerticalFollow(destination, duration);
    return true;
  }

  function notationBeatLine() {
    const line = elements.score.querySelector(".at-cursor-beat")?.getBoundingClientRect();
    return line?.width > 0 ? line : null;
  }

  function followHorizontalScore(now) {
    if (now < horizontalGestureUntil || !visibleTracks.size || notationRenderInFlight || pinchActive) return;
    const score = elements.score;
    if (score.scrollWidth <= score.clientWidth) return;
    const cursor = notationBeatLine();
    if (!cursor) return;
    const rect = score.getBoundingClientRect();
    const left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
    const width = right - left;
    if (width <= 0) return;
    // Leave music ahead of the beat. At either end the score stops and the
    // line keeps moving. Reduced motion advances a page at a time instead.
    const anchor = left + width * HORIZONTAL_READING_FRACTION;
    const edge = reducedFollowMotion?.matches ? right - width * 0.15 : anchor;
    if (cursor.left >= left + 8 && cursor.left <= edge + 0.5) return;
    const destination = clamp(score.scrollLeft + cursor.left - anchor, 0, score.scrollWidth - score.clientWidth);
    if (Math.abs(destination - score.scrollLeft) < 0.5) return;
    score.scrollLeft = destination;
    followedScoreLeft = score.scrollLeft;
  }

  function gentleFollowCursor() {
    if (conductor) return;
    if (!engine?.playing || pendingNotationReload || scoreScrub) return;
    const now = performance.now();
    const horizontalScore = flow === "continuous" && scoreView === "standard";
    if (horizontalScore && !playbackDetached) followHorizontalScore(now);
    if (now - lastFollow < FOLLOW_CHECK_INTERVAL_MS) return;
    lastFollow = now;
    const cursor = playbackCursorBounds();
    if (!cursor) return;
    if (playbackDetached) {
      updatePlaybackReturn();
      return;
    }
    const currentTick = engine?.tickAtSeconds(engine.currentSeconds()) ?? 0;
    if (predictiveFollowRange) {
      if (currentTick >= predictiveFollowRange.startTick - 1
        && currentTick < predictiveFollowRange.targetTick) return;
      predictiveFollowRange = null;
    }
    if (verticalFollowAnimationFrame) return;
    const direction = playbackDirection(cursor);
    if (direction) {
      if (!horizontalScore || (direction !== "left" && direction !== "right")) scrollToPlayback(direction, "smooth", true);
    } else predictiveVerticalFollow(cursor);
  }

  // Where the music comes to rest when the view follows it: a fifth of the way
  // down the reading band, the same line the band already treats as the top of
  // comfortable reading. That leaves a system of context above it and the rest
  // of the screen as lookahead, and the music then has the whole page to cross
  // before the view has to move again. Landing it at the bottom edge instead,
  // which is all a minimum scroll needs, hides what is coming and moves the
  // page at every system. Oversized systems follow the selected staff instead.
  function readingLine(cursorHeight, topLimit, bottomLimit) {
    const usableHeight = Math.max(1, bottomLimit - topLimit);
    return cursorHeight >= usableHeight * 0.8 ? topLimit : topLimit + usableHeight * 0.2;
  }

  function playbackCursorPlace() {
    const bounds = playbackCursorBounds();
    return bounds ? `${Math.round(bounds.left)}:${Math.round(bounds.top)}` : null;
  }

  // A jump only reads as a jump if the score comes with it. The pitchbar view
  // moves its playhead as the seek is applied, while AlphaTab moves its cursor
  // a frame or two later, so this waits for whichever it is to leave the place
  // it held BEFORE the seek. A jump that stays in view never moves far enough
  // to need a scroll and simply runs out of attempts.
  function followCursorFrom(place) {
    let frames = 0;
    const attempt = () => {
      if (playbackCursorPlace() !== place) {
        const direction = playbackDirection();
        if (direction) scrollToPlayback(direction, "smooth", true);
        return;
      }
      if ((frames += 1) < 12) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }

  function playbackCursorBounds() {
    if (!engine || pendingNotationReload || !visibleTracks.size) return null;
    const tick = clamp(engine.tickAtSeconds(engine.currentSeconds()), 0, Math.max(0, sequence.endTick - 1));
    if (scoreView === "bars") {
      const system = barSystems.find((system) => tick >= system.startTick && tick < system.endTick);
      return system?.cursor.getBoundingClientRect() || null;
    }
    // The animated AlphaTab cursor can still belong to the previous system
    // when its position event fires. Follow the current measure's geometry.
    const box = notationFollowBox(measureIndexAtTick(tick));
    if (!box) return null;
    const origin = elements.score.getBoundingClientRect();
    let left = origin.left + box.x - elements.score.scrollLeft, width = box.w;
    if (flow === "continuous" || elements.score.classList.contains("has-horizontal-overflow")) {
      const line = notationBeatLine();
      if (line) { left = line.left; width = line.width; }
      else if (flow === "continuous") return null;
    }
    const top = origin.top + box.y - elements.score.scrollTop;
    return { left, top, right: left + width, bottom: top + box.h, width, height: box.h,
      ...(box.focused ? { focused: true } : {}) };
  }

  function playbackDirection(cursor = playbackCursorBounds()) {
    if (!cursor) return null;
    const bounds = cursor;
    const header = elements.transport.getBoundingClientRect().height;
    const topLimit = header + 8;
    const bottomLimit = window.innerHeight - 20;
    if (bounds.bottom < topLimit) return "up";
    if (bounds.top > bottomLimit) return "down";
    if (bounds.height <= bottomLimit - topLimit) {
      if (bounds.top < topLimit) return "up";
      if (bounds.bottom > bottomLimit) return "down";
    }
    const scoreSurface = scoreView === "bars" ? elements.barScore : elements.score;
    if (flow === "continuous" || scoreSurface.classList.contains("has-horizontal-overflow")) {
      const scoreBounds = scoreSurface.getBoundingClientRect();
      const leftLimit = Math.max(0, scoreBounds.left) + 10;
      const rightLimit = Math.min(window.innerWidth, scoreBounds.right) - 10;
      if (bounds.right < leftLimit) return "left";
      if (bounds.left > rightLimit) return "right";
    }
    return null;
  }

  function cursorOutsideReadingBand(cursor = playbackCursorBounds()) {
    if (!cursor) return false;
    const direction = playbackDirection(cursor);
    if (["left", "right"].includes(direction)) return true;
    const bounds = cursor;
    const header = elements.transport.getBoundingClientRect().height;
    const usableTop = header + 8;
    const usableBottom = window.innerHeight - 20;
    const usableHeight = Math.max(1, usableBottom - usableTop);
    return bounds.bottom < usableTop + usableHeight * 0.20
      || bounds.top > usableTop + usableHeight * 0.80;
  }

  function hidePlaybackReturn() {
    elements.playbackReturn.classList.remove("is-visible");
    elements.playbackReturn.setAttribute("aria-hidden", "true");
    elements.playbackReturn.tabIndex = -1;
  }

  function updatePlaybackReturn() {
    const cursor = playbackCursorBounds();
    if (!playbackDetached || !cursor) {
      hidePlaybackReturn();
      return;
    }
    const direction = playbackDirection(cursor);
    if (!direction) {
      playbackDetached = false;
      hidePlaybackReturn();
      return;
    }
    const location = {
      up: "above",
      down: "below",
      left: "to the left",
      right: "to the right",
    }[direction];
    elements.playbackReturn.dataset.direction = direction;
    elements.playbackReturn.setAttribute("aria-label", `Current playback is ${location}. Return to it.`);
    elements.playbackReturn.title = `Return to playback ${location}`;
    elements.playbackReturn.setAttribute("aria-hidden", "false");
    elements.playbackReturn.tabIndex = 0;
    elements.playbackReturn.classList.add("is-visible");
  }

  function scrollToPlayback(direction = playbackDirection(), behavior = "smooth", minimal = false) {
    const cursor = playbackCursorBounds();
    if (!cursor) return false;
    playbackDetached = false;
    predictiveFollowRange = null;
    hidePlaybackReturn();
    const bounds = cursor;
    const header = elements.transport.getBoundingClientRect().height;
    const topLimit = header + 8;
    const bottomLimit = window.innerHeight - 20;
    if (["up", "down"].includes(direction)) {
      const destination = minimal
        ? window.scrollY + bounds.top - readingLine(bounds.height, topLimit, bottomLimit)
        : window.scrollY + bounds.top - (topLimit + Math.max(0, bottomLimit - topLimit - bounds.height) / 2);
      if (behavior === "smooth") {
        const target = Math.max(0, destination);
        animateVerticalFollow(target, followScrollDuration(Math.abs(target - window.scrollY)));
      } else {
        cancelVerticalFollowAnimation();
        automaticScrollUntil = Date.now() + 300;
        window.scrollTo({ top: Math.max(0, destination), behavior: "auto" });
      }
    } else {
      // A native smooth scroll would compete with the score's frame-by-frame follow.
      const followingBeat = flow === "continuous" && scoreView === "standard" && engine.playing;
      if (followingBeat) behavior = "auto";
      automaticScrollUntil = Date.now() + (behavior === "smooth" ? 800 : 300);
      const scoreSurface = scoreView === "bars" ? elements.barScore : elements.score;
      const scoreBounds = scoreSurface.getBoundingClientRect();
      const destination = minimal
        ? direction === "left"
          ? scoreSurface.scrollLeft + bounds.left - scoreBounds.left - 10
          : scoreSurface.scrollLeft + bounds.right - scoreBounds.right + 10
        : scoreSurface.scrollLeft + bounds.left - scoreBounds.left
          - (scoreBounds.width - bounds.width) * (followingBeat ? HORIZONTAL_READING_FRACTION : 0.5);
      scoreSurface.scrollTo({ left: Math.max(0, destination), behavior });
    }
    return true;
  }

  function recordManualScoreScroll(event) {
    if (event?.currentTarget === elements.score && flow === "continuous" && scoreView === "standard") {
      if (elements.score.scrollLeft === followedScoreLeft) return;
      followedScoreLeft = null;
      if (Date.now() >= automaticScrollUntil) horizontalGestureUntil = performance.now() + 200;
    }
    if (Date.now() < automaticScrollUntil) return;
    cancelVerticalFollowAnimation(true);
    const cursor = playbackCursorBounds();
    if (!cursor) {
      hidePlaybackReturn();
      return;
    }
    // Detach before the next playback frame can reclaim a deliberate scroll.
    playbackDetached = cursorOutsideReadingBand(cursor);
    if (followScrollFrame) return;
    followScrollFrame = requestAnimationFrame(() => {
      followScrollFrame = 0;
      updatePlaybackReturn();
    });
  }

  function syncPlaybackButton() {
    const preparing = Boolean(engine?.preparing);
    stationMixEditor?.transportChanged();
    elements.playPause.disabled = !ready;
    elements.playPause.classList.toggle("is-playing", playing || preparing);
    elements.playPause.setAttribute("aria-busy", String(preparing));
    elements.playPause.setAttribute("aria-label", preparing ? "Cancel playback start" : playing ? "Pause score" : "Play score");
    elements.playPause.title = preparing ? "Cancel playback start (Space)" : playing ? "Pause (Space)" : "Play (Space)";
  }

  function initializeMediaSession() {
    if (!("mediaSession" in navigator) || window.frameElement?.inert) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: String(config.title || buildMetadata.title || document.title.replace(/(?: \| Melete| — (?:Practice score|Choir Practice))$/u, "")),
        artist: String(config.composer || buildMetadata.composer || "Choir practice score"),
      });
      navigator.mediaSession.setActionHandler("play", () => { void engine?.startTransport(); });
      navigator.mediaSession.setActionHandler("pause", () => {
        if (takeState !== "off") void stopTakeRecording("Stopped", true, {discardShortTail:true,preserveRecordIntent:true});
        else engine?.pauseTransport();
      });
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        cancelVerticalFollowAnimation(true);
        const next = Math.max(0, engine.currentSeconds() - (details.seekOffset || 5));
        api.tickPosition = engine.tickAtSeconds(next);
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        cancelVerticalFollowAnimation(true);
        const next = Math.min(engine.duration, engine.currentSeconds() + (details.seekOffset || 5));
        api.tickPosition = engine.tickAtSeconds(next);
      });
    } catch {
      // Media Session is optional.
    }
  }

  elements.settingsToggle.addEventListener("click", () => setSettingsOpen(!elements.settingsPanel.classList.contains("is-open")));
  window.addEventListener("scroll", recordManualScoreScroll, { passive: true });
  window.addEventListener("pointerdown", interruptVerticalFollow, { capture: true, passive: true });
  window.addEventListener("wheel", interruptVerticalFollow, { capture: true, passive: true });
  elements.score.addEventListener("scroll", recordManualScoreScroll, { passive: true });
  elements.barScore.addEventListener("scroll", recordManualScoreScroll, { passive: true });
  elements.score.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".score-note-layer")) return;
    let note = standardNoteAtClientPoint(event.clientX, event.clientY);
    const chord = !note && standardChordTargetAtClientPoint(event.clientX, event.clientY);
    if (!note && !chord) note = standardNoteAtClientPoint(event.clientX, event.clientY, true);
    const preview = note || (chord ? { notes: chordNotesAtTick(chord.tick), fullChord: true } : null);
    const follow = (pointer) => {
      if (!chord) return standardNoteAtClientPoint(pointer.clientX, pointer.clientY, true);
      const target = standardChordTargetAtClientPoint(pointer.clientX, pointer.clientY, false);
      return target ? { notes: chordNotesAtTick(target.tick) } : null;
    };
    const targetAtPointer = (pointerEvent) => note?.rangeNode ? null : note && Number.isFinite(note.tick)
      ? { tick: note.tick, exactTick: true, partIndex: note.track }
      : chord || standardScoreTargetAtClientPoint(
      pointerEvent.clientX,
      pointerEvent.clientY,
      currentScorePartIndex(),
    );
    if (!beginPitchAudition(event, preview, follow, targetAtPointer)) beginScoreScrub(event, targetAtPointer);
  });
  elements.score.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    if(lyricInteractionTarget(event) || event.target.closest('.score-note-layer')) {hoverNote(null);return;}
    const exact=standardNoteAtClientPoint(event.clientX,event.clientY);
    hoverNote(exact || (standardChordTargetAtClientPoint(event.clientX,event.clientY) ? null
      : standardNoteAtClientPoint(event.clientX,event.clientY,true)));
  });
  // Lazy SVG tiles can attach after alphaTab's renderFinished callback.
  let rangeBindFrame = 0;
  new MutationObserver(changes => {
    if (rangeBindFrame || !changes.some(change => [...change.addedNodes].some(node => node.nodeType === 1
      && (node.matches('.at-surface-svg') || node.querySelector('.at-surface-svg'))))) return;
    rangeBindFrame = requestAnimationFrame(() => { rangeBindFrame = 0; bindScoreRanges(); mountStaffPitchTraces(); });
  }).observe(elements.score, {childList:true,subtree:true});
  elements.score.addEventListener('pointerleave',()=>hoverNote(null));
  window.addEventListener('blur',()=>hoverNote(null));
  elements.score.addEventListener("touchstart", beginScorePinch, { passive: false });
  elements.score.addEventListener("touchmove", updateScorePinch, { passive: false });
  elements.score.addEventListener("touchend", finishScorePinch, { passive: false });
  elements.score.addEventListener("touchcancel", finishScorePinch, { passive: false });
  elements.barScore.addEventListener("touchstart", beginScorePinch, { passive: false });
  elements.barScore.addEventListener("touchmove", updateScorePinch, { passive: false });
  elements.barScore.addEventListener("touchend", finishScorePinch, { passive: false });
  elements.barScore.addEventListener("touchcancel", finishScorePinch, { passive: false });
  window.addEventListener("blur", () => { cancelPitchAuditions(); cancelScoreScrub(); });
  window.addEventListener("pagehide", () => { cancelPitchAuditions(); cancelScoreScrub(); });
  window.addEventListener("pagehide", () => {
    pitchCapturePageActive = false;
    referencePlayer?.activate(false);
    microphoneCheck?.close();
    void stopTakeRecording("Stopped", true);
    disablePitchCapture(false, { preservePreference: true });
    stopTakePreview();
    clearTakeLayers();
  });
  window.addEventListener("pageshow", () => {
    // This fires inside hidden collection frames too, once they finish loading.
    if (window.frameElement?.inert) return;
    pitchCapturePageActive = true;
    referencePlayer?.activate(true);
    restorePitchCapture();
  });
  window.addEventListener("beforeunload", event => {
    if (!takeJournal?.entries.size && takeState === "off") return;
    event.preventDefault();
    event.returnValue = "";
  });
  elements.playbackReturn.addEventListener("click", () => scrollToPlayback(playbackDirection(), "smooth", false));
  elements.practicePart.addEventListener("input", () => {
    const selected = practicePartPager?.value();
    void stopTakeRecording("Stopped: practice part changed", true);
    setPracticePart(selected);
    applyRelativeGuide(selected);
    updateNoteActionLabel();
    if (scoreView === "bars") scheduleBarRender();
    // Choosing here answers the first-visit question as well.
    if (Number.isInteger(practicePartIndex) && !elements.partChooser.hidden) {
      rememberPartChooser("chosen");
      hidePartChooser();
    }
  });
  elements.flowToggle.addEventListener("click", () => setFlow(flow === "wrap" ? "continuous" : "wrap"));
  elements.flowToggle.addEventListener("keydown", (event) => {
    let next = null;
    if (["ArrowLeft", "ArrowUp", "Home"].includes(event.key)) next = "wrap";
    else if (["ArrowRight", "ArrowDown", "End"].includes(event.key)) next = "continuous";
    if (!next) return;
    setFlow(next);
    elements.flowToggle.querySelector(`[data-flow="${next}"]`)?.focus();
    event.preventDefault();
  });
  elements.scoreViewToggle.addEventListener("click", () => setScoreView(scoreView === "standard" ? "bars" : "standard"));
  elements.scoreViewToggle.addEventListener("keydown", (event) => {
    let next = null;
    if (["ArrowLeft", "ArrowUp", "Home"].includes(event.key)) next = "standard";
    else if (["ArrowRight", "ArrowDown", "End"].includes(event.key)) next = "bars";
    if (!next) return;
    setScoreView(next);
    elements.scoreViewToggle.querySelector(`[data-view="${next}"]`)?.focus();
    event.preventDefault();
  });
  attachHoldReset(elements.pitchCapture, togglePitchCapture, clearPitchTrace, "pitch trace");
  microphoneCheck = new window.MeleteMicrophoneCheck.Check({
    dialog: document.getElementById("microphoneCheck"), trigger: elements.checkMicrophone,
    inline: true, passive: true, select: elements.takeMicrophone,
    acquire: async () => {
      await ensureMicrophoneInput({waitForAudio: false});
      return {source: pitchCaptureSource, context: pitchCaptureContext, track: pitchCaptureStream.getAudioTracks()[0]};
    },
    release: syncMicrophoneActivity,
    busy: () => pitchCaptureState !== "off" || takeState !== "off",
    failureMessage: microphoneFailureMessage,
    choose: deviceId => {
      microphoneDeviceId = deviceId;
      try { localStorage.setItem("choir-practice:microphone:v1", deviceId); } catch {}
      elements.takeMicrophone.value = deviceId;
      releaseMicrophoneInput();
      takeNotice = "";
      renderTakePanel();
      if (wantsPitchCapture()) void armMicrophone();
    },
  });
  window.MeleteMicrophoneCheck.mediaDevicesFor(window)?.addEventListener?.("devicechange", () => { void refreshMicrophoneChoices(); });
  const timingDialog=document.getElementById("timingCheckDialog");
  document.getElementById("openTimingCheck").addEventListener("click",()=>{
    const label=document.getElementById("timingCheckStatus");
    label.textContent=engine.playing || takeState!=="off" ? "Finish the current take and pause playback before measuring." : "";
    if(!timingDialog.open)timingDialog.showModal();
  });
  document.getElementById("measureTiming").addEventListener("click",()=>{void measureRecordingTiming();});
  document.getElementById("closeTimingCheck").addEventListener("click",()=>timingDialog.close());
  timingDialog.addEventListener("keydown",event=>event.stopPropagation());
  timingDialog.addEventListener("cancel",event=>{if(microphoneCheck.calibrating)event.preventDefault();});
  for (const button of elements.takePanel.querySelectorAll("[data-take-sort]")) {
    button.addEventListener("click", () => {
      takeSort = window.MeleteTakePitch.nextTakeSort(takeSort, button.dataset.takeSort);
      try { localStorage.setItem("melete:take-sort", JSON.stringify(takeSort)); } catch {}
      renderTakePanel();
      compPanel?.selected();
    });
  }
  elements.takeMore.addEventListener("click", () => { takeVisibleCount += 25; renderTakePanel(); });
  document.getElementById("downloadMix").addEventListener("click", async () => {
    if (!engine?.takeLayers.size || takeActionBusy || takeState !== "off") return;
    takeActionBusy = true; updateTakePreview(); renderTakePanel();
    const button = document.getElementById("downloadMix"); button.setAttribute("aria-busy", "true");
    try {
      const result = await window.MeleteTakeMix.render([...engine.takeLayers.values()], {
        duration: engine.duration, rate: engine.rate, reverb: takeReverbControl.value(), volume: takeVolumeControl.value(), sampleRate: engine.context.sampleRate,
      });
      downloadTakeBlob(result.blob, `${config.slug || "melete"}-mix.wav`);
    } catch (error) { showToast(`Mix export failed: ${error.message}`, "error"); }
    finally { takeActionBusy = false; button.setAttribute("aria-busy", "false"); updateTakePreview(); renderTakePanel(); }
  });
  elements.deleteLooseTakes.addEventListener("click", () => { void clearTakes(); });
  elements.exitTakeReview.addEventListener("click", stopTakePreview);
  elements.undoTakeDelete.addEventListener("click", () => { void undoTakeDeletion(); });
  elements.retryTakeSave.addEventListener("click", () => { void retryTakeSave(); });
  window.MeleteTakeControls.confirmDeletes(document);
  elements.tempo.addEventListener("input", () => {
    if (api) api.playbackSpeed = tempoControl.value() / 100;
    renderTakePanel();
    savePreferences();
  });
  elements.metronome.addEventListener("input", () => {
    engine?.setMetronome(metronomeControl.value());
    savePreferences();
  });
  elements.verticalScale.addEventListener("input", () => { savePreferences(); scheduleRender(); });
  elements.horizontalScale.addEventListener("input", () => { deferBarPitchTrace(); savePreferences(); scheduleRender(); });
  attachHoldReset(elements.loopStart, () => setLoopPoint("start"), clearLoop, "loop");
  attachHoldReset(elements.loopEnd, () => setLoopPoint("end"), clearLoop, "loop");
  attachHoldReset(elements.loopToggle, toggleLoop, clearLoop, "loop");
  elements.playPause.addEventListener("click", togglePracticePlayback);
  document.addEventListener("melete:restore-position", event => restorePlaybackPosition(event.detail?.milliseconds));
  document.addEventListener("melete:activate", () => {
    referencePlayer?.activate(true);
    pitchCapturePageActive = true;
    readSettingsSections();
    syncSettingsSections();
    restorePitchCapture();
    if (ready) { initializeMediaSession(); void refreshMicrophoneChoices(); }
    if (takeLibraryReady) void loadTakeLibrary().catch(() => {});
    requestAnimationFrame(revealPendingLoopStart);
  });
  document.addEventListener("melete:deactivate", () => {
    linkedPracticeState = null;
    relativeMix=null;relativeGuide=null;pendingMixReceipt=null;
    referencePlayer?.activate(false);
    pitchCapturePageActive = false;
    microphoneCheck?.close();
    void stopTakeRecording("Stopped: song changed", true);
    disablePitchCapture(false, { preservePreference: true });
    stopTakePreview();
    clearTakeLayers();
  });
  elements.seek.addEventListener("pointerdown", (event) => {
    seeking = true;
    scrubLabelPointer = event.pointerType === "mouse" ? null : event.pointerId;
  });
  elements.seek.addEventListener("input", () => {
    const value = previewSeek(Number(elements.seek.value), true);
    if (scrubLabelPointer !== null) showScrubLabel(value);
  });
  elements.seek.addEventListener("change", () => {
    hideScrubLabel();
    if (!ready || !engine) return;
    seeking = false;
    const value = previewSeek(Number(elements.seek.value));
    seekPlaybackTick(seekTickFor(value));
  });
  elements.seek.addEventListener("pointercancel", () => { seeking = false; hideScrubLabel(); });
  // A release can land anywhere once the finger has slid off the rail.
  ["pointerup", "pointercancel"].forEach((type) => document.addEventListener(type, (event) => {
    if (event.pointerId === scrubLabelPointer) hideScrubLabel();
  }, true));
  window.addEventListener("blur", hideScrubLabel);
  elements.seek.addEventListener("keydown", (event) => {
    if (!ready || !engine || !api) return;
    let value = null;
    if (["ArrowLeft", "ArrowDown"].includes(event.key)) value = adjacentChapterMilliseconds(elements.seek.value, -1);
    else if (["ArrowRight", "ArrowUp"].includes(event.key)) value = adjacentChapterMilliseconds(elements.seek.value, 1);
    else if (event.key === "Home") value = chapterSeekMilliseconds[0] ?? 0;
    else if (event.key === "End") value = chapterSeekMilliseconds.at(-1) ?? Math.round(engine.duration * 1000);
    if (value === null) return;
    previewSeek(value, true);
    event.preventDefault();
  });
  elements.fullscreen.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      showToast("Full screen is unavailable", "error");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const full = Boolean(document.fullscreenElement);
    elements.fullscreen.setAttribute("aria-label", full ? "Exit full screen" : "Enter full screen");
    elements.fullscreen.dataset.help = full ? "Exit full screen." : "Enter full screen.";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void stopTakeRecording("Stopped: tab hidden", true);
      disablePitchCapture(false, {preservePreference:true});
    }
    if (!document.hidden) restorePitchCapture();
    if (document.hidden) cancelTakeScoring();
    else void scoreNextTake();
    if (document.visibilityState !== "visible") { cancelPitchAuditions(); cancelScoreScrub(); }
    if (document.visibilityState !== "visible" || !pitchCaptureEnabled() || !pitchCaptureStream) return;
    const track = pitchCaptureStream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") return;
    track.enabled = true;
    void engine?.context?.resume().then(() => pitchCaptureContext?.resume()).then(() => {
      if (playing) startPitchSampling();
      else {
        pitchCaptureState = "armed";
        updatePitchCaptureAppearance();
      }
    });
  });
  elements.noteMode.addEventListener("click", () => {
    if (isMobileSettingsDevice()) setSettingsOpen(false);
    startInlineNoteEdit(currentScoreTick(), currentScorePartIndex());
  });

  function isTextEntryTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return true;
    return target instanceof HTMLInputElement
      && ["text", "search", "email", "url", "tel", "password"].includes(target.type);
  }

  // Pointer interaction should not leave a toolbar control holding keyboard
  // focus. Keyboard-originated activation retains focus for normal navigation.
  elements.transport.addEventListener("pointerup", (event) => {
    const control = event.target instanceof Element
      ? event.target.closest("button, input, a, [role='button'], [role='spinbutton'], [role='slider'], [tabindex]")
      : null;
    if (!(control instanceof HTMLElement) || isTextEntryTarget(control)) return;
    requestAnimationFrame(() => {
      if (document.activeElement === control) control.blur();
    });
  });

  // Space is the transport shortcut throughout the practice interface. Handle
  // it in capture phase so a focused button cannot activate itself and the
  // browser cannot scroll the page; preserve ordinary spaces in text editors.
  document.addEventListener("keydown", (event) => {
    if (document.getElementById("microphoneCheck").open) return;
    if (stationMixDialog.open || event.target.closest?.("#takeFieldMenu, #takeSingerDialog, #shareMixDialog, #expandTakes, .edit-take-singer")) return;
    if (event.code !== "Space" || isTextEntryTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (conductor?.key(event)) return;
    if (!event.repeat) {
      togglePracticePlayback();
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, { capture: true });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (event.defaultPrevented) return;
    if (document.getElementById("microphoneCheck").open) return;
    if (document.getElementById("takeSingerDialog").open || shareDialog.open || stationMixDialog.open || document.getElementById("takeFieldMenu").matches(":popover-open")) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable
      || target?.closest?.("audio, video")) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z") {
      if (target?.closest?.("dialog")) return;
      event.preventDefault();
      if (!event.repeat) void compPanel?.stepHistory(event.shiftKey ? "redo" : "undo");
      return;
    }
    if (event.key.startsWith("Arrow") && target instanceof Element
      && target.closest("button, select, [role='spinbutton'], [role='slider'], [role='tab']")) return;
    // Up and down step between section breaks, the way an editor steps between
    // cuts; left and right audition adjacent notes of the selected part. The score follows so the
    // jump lands somewhere you can read, and a control that uses the arrows
    // itself has already called preventDefault by the time this runs.
    if (["ArrowUp", "ArrowDown"].includes(event.key) && engine && api) {
      // Section starts only: the end of the piece is also a snap point, and
      // seeking onto it sends the transport back to the beginning, so stepping
      // forward stops at the last section rather than falling off the end.
      const here = engine.currentSeconds() * 1000;
      const stops = chapterSeekMilliseconds.filter((point) => point < engine.duration * 1000 - 1);
      const step = event.key === "ArrowDown"
        ? stops.find((point) => point > here + 1)
        : [...stops].reverse().find((point) => point < here - 1);
      if (step === undefined) { event.preventDefault(); return; }
      // The same path a click on the score takes, so both views move their
      // playhead and the section start is honoured exactly rather than snapped
      // to the nearest eighth.
      const from = playbackCursorPlace();
      applyScoreScrubTarget({ tick: engine.tickAtSeconds(step / 1000), exactTick: true });
      followCursorFrom(from);
      event.preventDefault();
      return;
    }
    if (["ArrowLeft", "ArrowRight"].includes(event.key) && engine && api) {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      stepScoreNote(direction);
      event.preventDefault();
      return;
    }
    if (event.key === "[") {
      setLoopPoint("start");
      event.preventDefault();
    } else if (event.key === "]") {
      setLoopPoint("end");
      event.preventDefault();
    } else if (event.key === "Escape") {
      if (elements.settingsPanel.classList.contains("is-open")) setSettingsOpen(false);
    }
  });

  window.addEventListener("resize", () => requestAnimationFrame(() => {
    syncPillThumb();
    updateTransportHeight();
    if (!("ResizeObserver" in window) && api && scoreTracks.length) scheduleRender();
  }));

  if ("ResizeObserver" in window) {
    lastScoreShellWidth = Math.round(elements.scoreShell.getBoundingClientRect().width || 0);
    scoreResizeObserver = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect?.width || elements.scoreShell.getBoundingClientRect().width || 0);
      if (!width || Math.abs(width - lastScoreShellWidth) < 2) return;
      lastScoreShellWidth = width;
      if (api && scoreTracks.length) scheduleRender();
    });
    scoreResizeObserver.observe(elements.scoreShell);
  }

  function embeddedText(id) {
    const embedded = document.getElementById(id)?.textContent?.trim();
    if (embedded) return embedded;
    throw new Error(`Embedded ${id} is missing`);
  }

  function currentPortableState() {
    return {
      version: PORTABLE_STATE_VERSION,
      fingerprint: portableStateFingerprint(),
      preferences: { ...currentPreferenceState(), sing: false },
      annotations: currentAnnotationState(),
    };
  }

  function jsonForEmbeddedScript(value) {
    return JSON.stringify(value)
      .replace(/</gu, "\\u003c")
      .replace(/\u2028/gu, "\\u2028")
      .replace(/\u2029/gu, "\\u2029");
  }

  function documentWithPortableState(source, state) {
    const scriptClose = `<${"/"}script>`;
    // The collection forwards its URL choice into srcdoc. Do not bake that
    // temporary choice into a downloaded player's default mode.
    const conductorBootstrap = new RegExp(`<script\\b[^>]*\\bdata-conductor-bootstrap(?:\\s|=|>)[\\s\\S]*?${scriptClose}`, "giu");
    source = source.replace(conductorBootstrap, "");
    const marker = new RegExp(`<script\\b[^>]*\\bid=["']portable-state["'][^>]*>[\\s\\S]*?${scriptClose}`, "iu");
    if (!marker.test(source)) throw new Error("Portable state marker is missing");
    const replacement = `<script id="portable-state" type="application/json">${jsonForEmbeddedScript(state)}${scriptClose}`;
    return source.replace(marker, () => replacement);
  }

  function saveStandaloneBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function chooseStandaloneSaveHandle(filename) {
    if (!window.isSecureContext || typeof window.showSaveFilePicker !== "function") return null;
    return window.showSaveFilePicker({
      id: "choir-practice-score",
      suggestedName: filename,
      types: [{
        description: "Standalone HTML file",
        accept: { "text/html": [".html", ".htm"] },
      }],
    });
  }

  async function writeStandaloneFile(handle, blob) {
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch {}
      throw error;
    }
  }

  async function downloadStandalone(event) {
    event.preventDefault();
    if (elements.download.getAttribute("aria-busy") === "true") return;
    elements.download.setAttribute("aria-busy", "true");

    try {
      const filename = elements.download.download || "choir-practice.html";
      let saveHandle = null;
      try {
        saveHandle = await chooseStandaloneSaveHandle(filename);
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("Save picker unavailable; falling back to browser download", error);
      }

      if (editingAnnotation) commitInlineNoteEdit();
      savePreferences();
      const source = initialDocumentSource || `<!doctype html>\n${document.documentElement.outerHTML}`;
      const portableDocument = documentWithPortableState(source, currentPortableState());
      const blob = new Blob([portableDocument], { type: "text/html;charset=utf-8" });
      if (saveHandle) {
        await writeStandaloneFile(saveHandle, blob);
        showToast("Score saved with settings and annotations");
      } else {
        saveStandaloneBlob(blob, filename);
        showToast("Score downloaded with settings and annotations");
      }
    } catch (error) {
      console.error(error);
      showToast("Could not download this score", "error");
    } finally {
      elements.download.removeAttribute("aria-busy");
    }
  }

  async function downloadMuseScore() {
    const button = elements.downloadScore;
    if (!config.sourceScore?.data || button.getAttribute("aria-busy") === "true") return;
    button.setAttribute("aria-busy", "true");
    try {
      const filename = config.sourceScore.filename || "score.mscz";
      let handle = null;
      if (window.isSecureContext && typeof window.showSaveFilePicker === "function") {
        try {
          handle = await window.showSaveFilePicker({
            id: "choir-practice-musescore",
            suggestedName: filename,
            types: [{ description: "MuseScore file", accept: { "application/octet-stream": [".mscz"] } }],
          });
        } catch (error) {
          if (error?.name === "AbortError") return;
          console.warn("Save picker unavailable; falling back to browser download", error);
        }
      }
      const blob = new Blob([base64ToBytes(config.sourceScore.data)], { type: "application/octet-stream" });
      if (handle) await writeStandaloneFile(handle, blob);
      else saveStandaloneBlob(blob, filename);
    } catch (error) {
      console.error(error);
      showToast("Could not save the MuseScore file", "error");
    } finally {
      button.removeAttribute("aria-busy");
    }
  }

  async function init() {
    initialDocumentSource = `<!doctype html>\n${document.documentElement.outerHTML}`;
    const currentDocument = window.location.href.split(/[?#]/u)[0];
    const isStandalone = Boolean(document.getElementById("alphatab-runtime"));
    elements.download.href = isStandalone
      ? currentDocument
      : new URL("./dist/index.html", currentDocument).href;
    if (isStandalone) {
      elements.download.addEventListener("click", (event) => downloadStandalone(event));
    }
    updateTransportHeight();
    setupSettingsSections();
    setupSettingsHelp();
    if (!window.alphaTab) {
      showLoadError("Notation engine unavailable");
      return;
    }

    try {
      config = parseEmbeddedJson("trainer-config", {});
      conductorMode = Boolean(window.MeleteConductor?.requested() && config.conductorScore);
      if (conductorMode) {
        config = {...config, sourceScore: config.conductorScore.sourceScore || config.sourceScore,
          printPdf: config.conductorScore.printPdf || config.printPdf,
          printPdfUrl: config.conductorScore.printPdf ? null : config.printPdfUrl};
      }
      buildMetadata = parseEmbeddedJson("build-metadata", {});
      portableState = parseEmbeddedJson("portable-state", null);
      elements.download.download = `${String(config.slug || "choir-practice").replace(/[^a-z0-9-]+/giu, "-") || "choir-practice"}.html`;
      const demoVideo = demoVideoAddress(config.demoVideo);
      if (demoVideo && elements.demoVideo) {
        elements.demoVideo.href = demoVideo;
        elements.demoVideo.hidden = false;
      }
      if (config.printPdfUrl && elements.printScore) {
        const address = new URL(config.printPdfUrl, document.baseURI);
        if (!["http:", "https:", "file:"].includes(address.protocol)) throw new Error("Invalid PDF link");
        elements.printScore.href = address.href;
        elements.printScore.hidden = false;
      } else if (config.printPdf && elements.printScore) {
        const pdf = new Blob([base64ToBytes(config.printPdf)], { type: "application/pdf" });
        elements.printScore.href = URL.createObjectURL(pdf);
        elements.printScore.hidden = false;
      }
      if (config.sourceScore?.data && elements.downloadScore) {
        elements.downloadScore.addEventListener("click", downloadMuseScore);
        elements.downloadScore.hidden = false;
      }
      const printParts = document.getElementById("printParts");
      if (config.partsPdf) {
        printParts.href = URL.createObjectURL(new Blob([base64ToBytes(config.partsPdf)], {type:"application/pdf"}));
        printParts.hidden = false;
      } else if (config.partsPdfUrl) {
        const address = new URL(config.partsPdfUrl, document.baseURI);
        if (!["http:", "https:", "file:"].includes(address.protocol)) throw new Error("Invalid parts PDF link");
        printParts.href = address.href; printParts.hidden = false;
      }
      fullScoreXml = embeddedText("score-data");
      const playbackJson = embeddedText("playback-data");
      sequence = JSON.parse(playbackJson);
      if (!Number.isFinite(sequence.division) || !Number.isFinite(sequence.endTick) || !sequence.notes?.length || !sequence.measures?.length) {
        throw new Error("Playback data is incomplete");
      }
      pitchBarUnitTicks = shortestPitchBarNoteTicks(fullScoreXml, sequence);
      parts = normalizeParts(sequence.parts);
      if (config.referenceAudio) referencePlayer = window.MeleteReferenceAudio.create(config.referenceAudio, sequence,
        {engine:()=>engine, changed:savePreferences, error:message=>showToast(message,'error'),
          drag:createDragNumber, pan:createPanRing});
      prepareSelectiveLyrics();
      if (!parts.length) throw new Error("No score parts were found");
      configurePitchGuides(fullScoreXml);
      partDivisi = analysePartDivisi();
      mixerParts = window.MeleteDivisiMixer.channels(parts, partDivisi);
      prepareVoicePalette();
      // One key per kind of saved data, named after the song and never
      // versioned. Keying on the build's fingerprint meant every rebuild of the
      // same song started from nothing and left the last build's data behind,
      // unreachable. Anything found under an older key is adopted once and the
      // old entry removed.
      const songKey = (suffix) => `choir-practice:${config.slug || config.title || "score"}:${suffix}`;
      const buildFingerprint = buildMetadata.build?.fingerprint || buildMetadata.fingerprint;
      preferenceKey = songKey(conductorMode ? "conductor-preferences" : "preferences");
      legacyPreferenceKeys = conductorMode ? [] : [`choir-practice:${buildMetadata.fingerprint}:v2`];
      settingsPanelPreferenceKey = songKey(conductorMode ? "conductor-settings-open" : "settings-open");
      legacySettingsPanelKeys = [`${songKey("settings-open")}:v1`];
      if (conductorMode) legacySettingsPanelKeys = [];
      pitchTraceKey = songKey("pitch-trace");
      pitchTraceBaseKey = pitchTraceKey;
      legacyPitchTraceKeys = [`choir-practice:${buildFingerprint}:pitch-trace:v2`];
      annotationKey = songKey("notes");
      legacyAnnotationKeys = [`${songKey("notes")}:v3`, `${songKey("notes")}:v2`,
        `choir-practice:${buildMetadata.fingerprint}:v2:notes`];
      partChooserKey = songKey("part-chooser");
      setSettingsOpen(loadSettingsOpenState(), { persist: false });
      loadPreferences();
      pitchTraceKey = roleTraceKey(practicePartIndex);
      if (conductorMode) {
        // The URL selects this workspace; never write it into singer preferences.
        if (!window.MeleteConductor.validScore(config.conductorScore, sequence)) throw new Error("Conductor graphics do not match this playback score; rebuild the native export.");
        scoreView = "standard";
      }
      loadPitchTrace();
      buildMixer();
      buildPracticePartPicker();
      setupMixLink();
      registerStaticResetTargets();
      loadAnnotations();
      if (!conductorMode) sweepSupersededStorage(config.slug || config.title || "score");
      attachMixerGestures();
      updateLoopState();
      updateNoteActionLabel();
      updatePitchCaptureAppearance();
      // A link naming a part wins; otherwise a first visit with no part asks.
      const ownPartLink = partLinkFields(window.location.search, window.location.hash);
      const ownLoopLink = loopLinkValue(window.location.search, window.location.hash);
      if (ownLoopLink !== undefined) {
        pendingLoopLink ??= ownLoopLink;
        consumeLoopLink();
      }
      const ownLinkNamesPart = ownPartLink.part !== undefined || ownPartLink.div !== undefined;
      const ownMix=Object.fromEntries(new URLSearchParams(window.location.search));
      const mixArrival=openMixLink({...ownMix,...ownPartLink});
      if (ownLinkNamesPart && !mixArrival) consumePartLink();
      const arrivalLink = pendingPartLink || (ownLinkNamesPart ? ownPartLink : null);
      pendingPartLink = null;
      if (!mixArrival && !applyPartLink(arrivalLink) && !conductorMode && !Number.isInteger(practicePartIndex) && !partChooserAnswered()) showPartChooser();

      const settings = new window.alphaTab.Settings();
      settings.core.file = null;
      settings.core.fontDirectory = null;
      settings.core.useWorkers = false;
      settings.core.enableLazyLoading = true;
      settings.core.includeNoteBounds = true;
      settings.core.tracks = "all";
      settings.core.smuflFontSources = new Map([[window.alphaTab.FontFileFormat.Woff2, window.TRAINER_FONT_SOURCE]]);
      settings.display.layoutMode = flow === "continuous" ? window.alphaTab.LayoutMode.Horizontal : window.alphaTab.LayoutMode.Page;
      settings.display.scale = verticalControl.value() / 100;
      settings.display.barsPerRow = -1;
      settings.display.stretchForce = horizontalControl.value() / 100;
      settings.importer.mergePartGroupsInMusicXml = false;
      applyMeasureNumberSettings(settings);
      applyLyricFontSettings(settings);
      // Blake, on Autumn: MuseScore's second voice is used for a divisi whose
      // rhythm differs, not for a different kind of note. AlphaTab greys those
      // notes by default, which reads as "these are special" when they are just
      // more notes to sing. Paint them like the main voice.
      const glyphs = settings.display.resources;
      if (glyphs && glyphs.mainGlyphColor) glyphs.secondaryGlyphColor = glyphs.mainGlyphColor;
      installNotationFormatting();
      if (!conductorMode) window.MeleteNotationRange.install(
        window.alphaTab.Environment.defaultRenderers.find(factory=>factory.staffId==='score'),window.alphaTab.model);
      const prepareWrittenDirections = installWrittenDirections(fullScoreXml, sequence.division);
      const prepareWrittenAccidentals = MeleteWrittenAccidentals.install(window.alphaTab,
        new DOMParser().parseFromString(fullScoreXml, "application/xml"));
      installStaffLevelDynamics();
      installLowerVoiceRestPlacement();
      [
        window.alphaTab.NotationElement.ScoreTitle,
        window.alphaTab.NotationElement.ScoreSubTitle,
        window.alphaTab.NotationElement.ScoreArtist,
        window.alphaTab.NotationElement.ScoreAlbum,
        window.alphaTab.NotationElement.ScoreMusic,
        window.alphaTab.NotationElement.ScoreWords,
        window.alphaTab.NotationElement.ScoreWordsAndMusic,
        window.alphaTab.NotationElement.ScoreCopyright,
      ].filter((value) => value !== undefined).forEach((element) => settings.notation.elements.set(element, false));
      settings.player.playerMode = window.alphaTab.PlayerMode.EnabledExternalMedia;
      settings.player.soundFont = null;
      settings.player.scrollElement = "html,body";
      settings.player.scrollMode = window.alphaTab.ScrollMode.Off;
      settings.player.enableCursor = true;
      settings.player.enableElementHighlighting = true;
      settings.player.enableAnimatedBeatCursor = true;
      settings.player.enableUserInteraction = false;

      api = new window.alphaTab.AlphaTabApi(elements.score, settings);
      api.customCursorHandler = createLeftEdgeCursorHandler(window.alphaTab, api);
      engine = new GuideEngine(sequence);
      void referencePlayer?.sync();
      engine.beforeStart = () => {
        if (conductorMode || !wantsPitchCapture()) return false;
        if (takeState === "stopping") {
          const request = engine.transportRequest;
          void takeStopPromise?.then(() => {
            if (request === engine.transportRequest && wantsPitchCapture() && pitchCapturePageActive && !document.hidden) void engine.startTransport();
          });
          return true;
        }
        if (!Number.isInteger(practicePartIndex)) return false;
        if (takeState === "off") { void startTakeRecording(); return true; }
        return takeState === "requesting";
      };
      if (conductorMode) conductor = window.MeleteConductor.create({engine, api, sequence, config, elements, parts,
        createDragNumber, syncPillThumb, resize: updateTransportHeight,
        closeMobileSettings: () => { if (isMobileSettingsDevice()) setSettingsOpen(false, {persist: false}); },
        seek: tick => { api.tickPosition = tick; },
      });
      engine.onPresentation = seconds => {
        if (conductor) conductor.draw(engine.tickAtSeconds(seconds) * config.conductorScore.division / sequence.division);
        else updateBarPlayhead(engine.tickAtSeconds(seconds));
      };
      engine.onPresentationStopped = () => {
        stopBarPlayheadMotion();
        if (scoreView === "bars") placeBarPlayhead(engine.tickAtSeconds(engine.presentationSeconds()));
        conductor?.draw();
      };
      engine.onPreparationChanged = syncPlaybackButton;
      engine.onTransportChange = kind => {
        conductor?.transportChanged(kind);
        beginPitchCapturePass();
        takeTransportChanged(kind);
      };
      buildTimelineSegments();
      engine.attach(api);
      engine.setMetronome(metronomeControl.value());
      restorePitchCapture();

      api.scoreLoaded.on((score) => {
        prepareWrittenAccidentals(score);
        applyWrittenChordNames(score);
        prepareWrittenDirections(score);
        scoreTracks = score.tracks;
        applyMeasureNumberSettings(api.settings, score);
        if (scoreTracks.length !== parts.length) {
          const detail = `Playback has ${parts.length} parts but notation has ${scoreTracks.length}`;
          console.error(detail);
          scoreTracks = [];
          showLoadError("Score and playback parts do not match.", detail);
        } else if (scoreView === "standard" && visibleTracks.size && !notationRenderInFlight) {
          notationRenderInFlight = true;
          notationRenderQueued = false;
          notationRenderFailed = false;
          syncScoreLoadingVisibility();
          beginNotationRenderTimeout();
        }
      });
      api.renderFinished.on(() => {
        if (loadFailed) return;
        const renderIsCurrent = finishScheduledNotationRender();
        if (scoreView === "standard") {
          notationHasRendered = true;
          notationRenderFailed = false;
          setNotationLoadingMessage();
        }
        if (pendingNotationReload) {
          pendingNotationReload.renderReady = true;
          finishNotationReloadWhenReady();
        }
        syncScoreLoadingVisibility();
        if (!renderIsCurrent) return;
        requestAnimationFrame(() => {
          syncNotationOverflow();
          bindScoreRanges();
          // AlphaTab rebuilds its cursor layers during reflow but does not
          // reliably repaint them when the musical position itself is
          // unchanged. Re-submit that position only after the final queued
          // render so measure and beat highlights use the new geometry.
          engine?.pushPosition();
          syncPillThumb();
          updateTransportHeight();
          scheduleSectionGuides();
          renderAnnotations();
          renderSelectedPartHighlight();
          renderStaffPitchTrace();
          scheduleCursorTrimBurst();
          scheduleFullMeasureRestCentering();
          requestAnimationFrame(revealPendingLoopStart);
        });
      });
      api.playerReady.on(() => {
        if (loadFailed) return;
        updatePracticeDivisi();
        engine.attach(api);
        ready = true;
        conductor?.setReady();
        elements.playPause.disabled = false;
        elements.seek.disabled = false;
        elements.seek.min = String(Math.floor(engine.secondsAtTick(pitchTraceOriginTick()) * 1000));
        elements.seek.max = String(Math.max(1, Math.round(engine.duration * 1000)));
        elements.totalTime.textContent = formatTime(engine.duration * 1000);
        api.playbackSpeed = tempoControl.value() / 100;
        engine.updateMix(audibleTracks, trackVolumes, trackPans);
        if (pendingNotationReload) {
          pendingNotationReload.playerReady = true;
          finishNotationReloadWhenReady();
        } else engine.pushPosition();
        updateLoopState();
        // AlphaTab resets external output as playerReady unwinds. Restore the
        // initial loop only after that reset; later notation reloads keep position.
        // A station singer's mix goes on after the startup loop, outside any other settings change.
        requestAnimationFrame(() => requestAnimationFrame(() => { restoreStartupLoop(); compPanel?.settleStation?.(); }));
        initializeMediaSession();
        updatePitchCaptureAppearance();
        renderTakePanel();
        void refreshMicrophoneChoices();
        void loadTakeLibrary().catch(() => {
          takeNotice = "Local storage unavailable. Enable site storage to record.";
          renderTakePanel();
        });
        if (scoreView === "bars") scheduleBarRender();
      });
      api.playerStateChanged.on((event) => {
        playing = event.state === window.alphaTab.synth.PlayerState.Playing;
        if (!playing) cancelVerticalFollowAnimation(true);
        syncPlaybackButton();
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
        if (playing) startPitchSampling();
        else stopPitchSampling();
      });
      api.playerPositionChanged.on(() => {
        const seconds = engine.visualSeconds ?? engine.currentSeconds();
        const milliseconds = seconds * 1000;
        if (!seeking) {
          elements.seek.value = String(Math.round(milliseconds));
          elements.currentTime.textContent = formatTime(milliseconds);
          updateSeekAppearance(milliseconds);
        }
        if (engine.playing && scoreView === "standard") api.customCursorHandler.sync(api.tickPosition);
        if (scoreView === "standard") {
          scheduleCursorTrim();
          renderSelectedPartHighlight();
        }
        gentleFollowCursor();
      });
      api.playerFinished.on(() => {
        playing = false;
        syncPlaybackButton();
        stopPitchSampling();
      });
      api.error.on((error) => {
        console.error(error);
        showLoadError("Score could not be loaded.", error?.message || "Score could not be loaded");
      });

      const scoreBytes = new TextEncoder().encode(scoreXmlForDisplayMode());
      const initialTracks = parts.map((_, index) => index).filter((index) => visibleTracks.has(index));
      if (!api.load(scoreBytes, initialTracks)) throw new Error("Embedded score format was rejected");
    } catch (error) {
      console.error(error);
      showLoadError("Embedded score data could not be read.", error?.message || "Embedded score data could not be read");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else void init();
})();
