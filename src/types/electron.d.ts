/**
 * The `window.electronAPI` bridge (electron/preload.js).
 *
 * **Every new API is typed optional (`?:`) and must be feature-detected in the
 * renderer.** The web app updates instantly via Vercel; the native shell only
 * updates when a user restarts onto a new build, so an installed shell older
 * than the code you are writing is the normal case, not an edge case.
 * See documentation/electron.md.
 */

/** Result of a satellite-window request. */
export interface SatelliteResult {
  success: boolean;
  /** true when an existing window with the same key was focused instead. */
  focused?: boolean;
  key?: string;
  /** 'invalid-path' | 'unauthenticated' | 'forbidden' | 'offline'
   *  | 'too-many-windows' | 'already-opening' */
  error?: string;
}

/** Whoever is holding a profile's session lock, when a launch is refused. */
export interface GoLoginLockHolder {
  uid: string;
  displayName: string;
  heartbeatAtMs: number;
}

/** A local GoLogin/Orbita launch, as the main process reports it. */
export interface GoLoginSession {
  profileId: string | null;
  /** 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' */
  status: string;
  /**
   * 'forbidden' | 'not-configured' | 'not-linked' | 'in-use' | 'timeout'
   * | 'lock-failed' | 'proxy-error' | 'launch-failed' | 'stop-failed'
   *
   * `proxy-error` is the common one: the SDK tests the profile's proxy before
   * spawning anything, so a dead proxy fails the launch outright.
   */
  error?: string | null;
  startedAtMs?: number | null;
  /** Set with `error: 'in-use'` — who already has this profile open. */
  holder?: GoLoginLockHolder | null;
  /** Orbita's local CDP endpoint once running. Not a credential. */
  wsUrl?: string | null;
}

/**
 * A session that makes closing the window a bad idea.
 *
 * Two situations with different remedies: `stopping` is mid-upload and must not
 * be interrupted, while `starting`/`running` means an Orbita browser is open
 * that closing the window would *not* close.
 */
export interface GoLoginBusyProfile {
  profileId: string;
  /** 'starting' | 'running' | 'stopping' */
  status: string;
}

export interface GoLoginLaunchResult {
  success: boolean;
  /** Adds 'invalid-profile' | 'unauthenticated' | 'too-many-sessions' to the above. */
  error?: string;
  holder?: GoLoginLockHolder | null;
  session?: GoLoginSession;
}

/**
 * Orbita's install state. Reported from the main process, which owns the
 * download — including one that starts in the middle of a launch, because the
 * version a profile needs comes from its own user agent rather than a global
 * "latest". `downloading` and `installing` are the two phases the window must
 * block on.
 */
export interface GoLoginOrbitaState {
  phase: 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'failed';
  version: number | string | null;
  receivedBytes: number;
  /** 0 when the CDN sends no content-length; render an indeterminate bar then. */
  totalBytes: number;
  error?: string | null;
  /** Only on the `orbitaStatus()` reply, not on change events. */
  installedVersions?: number[];
}

/** Options for opening a satellite window. All geometry is clamped in main. */
export interface SatelliteOptions {
  /**
   * App-relative route, e.g. `/of-manager` or `/of-manager/chat/abc`. Must sit
   * under an allowlisted prefix in `main.js` (`SATELLITE_PREFIXES`); anything
   * else is rejected with `invalid-path`. Defaults to `/of-manager`.
   */
  path?: string;
  /** Window identity. A repeat call with the same key focuses the open window
   *  instead of spawning a second one. Defaults to the path. */
  key?: string;
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  alwaysOnTop?: boolean;
}

export interface WindowState {
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface NotificationOptions {
  title: string;
  body: string;
  playSound: boolean;
  /** Navigated to in the target window when the notification is clicked. */
  actionUrl?: string | null;
  /** Stable id — a repeat show with the same id replaces the banner rather than
   *  stacking, and it is echoed back on click/reply/action. Also the handle for
   *  `notifications.close`. */
  id?: string;
  /** Destination window: omitted → the calling window, `'main'` → the main
   *  window, any other string → that satellite key (falls back to main). */
  target?: 'main' | 'sender' | (string & {});
  /** macOS only — shows an inline reply field; the text arrives on `onReply`. */
  hasReply?: boolean;
  replyPlaceholder?: string;
  /** macOS only — up to 3 buttons; the index arrives on `onAction`. */
  actions?: Array<{ text: string }>;
}

export interface SaveFileOptions {
  suggestedName?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  /** Base64 payload (no data: prefix). Capped at ~200 MB decoded. */
  dataBase64: string;
}

export interface SaveFileResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

export interface DownloadProgress {
  id: string;
  state: 'progressing' | 'interrupted';
  received: number;
  total: number;
}

export interface DownloadDone {
  id: string;
  state: 'completed' | 'cancelled' | 'interrupted';
  /** Only set when `state === 'completed'`; safe to pass to `files.showInFolder`. */
  filePath: string | null;
}

/**
 * State for the always-visible session timer (macOS tray title / Windows HUD).
 *
 * Deliberately carries an ANCHOR rather than a formatted time: main re-derives
 * the display every second from `baseSeconds` + `anchorMs`, which is the same
 * arithmetic the renderer's own tick runs, so the two can never drift. Shaped by
 * `buildTimerWidgetPayload` in `src/lib/timerWidget.ts` — build it there, never
 * by hand, or the widget stops mirroring the tracker.
 */
export interface TimerWidgetPayload {
  visible: boolean;
  state?: 'working' | 'idle' | 'on-break' | 'paused';
  mode?: 'count-up' | 'count-down' | 'frozen';
  baseSeconds?: number;
  anchorMs?: number;
  /** `#rrggbb` from STATE_CONFIG. Main rejects anything else. */
  color?: string;
  label?: string;
}

export interface DeepLinkRoute {
  url: string;
  host: string;
  pathname: string;
  params: Record<string, string>;
  at: number;
}

/**
 * A recording sitting in main's on-disk upload queue.
 *
 * No path — the renderer identifies one by `token` and asks main to act on it.
 * `state` is `pending` (never attempted, or attempted before a restart),
 * `uploading`, or `failed` with `lastError` set.
 */
export interface PendingRecording {
  token: string;
  /** Epoch ms. */
  createdAt: number;
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
  hasPoster: boolean;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number;
  state: 'pending' | 'uploading' | 'failed';
}

interface ElectronAPI {
  isElectron: boolean;
  auth: {
    startGoogleOAuth: () => Promise<{ success: boolean }>;
    onOAuthCallback: (callback: (code: string) => void) => void;
    onOAuthError: (callback: (error: string) => void) => void;
    removeOAuthListeners: () => void;
  };
  /**
   * Window control. Scoped in main to the calling window — a satellite that
   * calls `setSize` resizes itself. On builds before the multi-window shell
   * these were all hardwired to the main window, which is why the
   * satellite-relevant members are optional.
   */
  window: {
    setResizable: (resizable: boolean) => void;
    setSize: (width: number, height: number) => void;
    getSize?: () => Promise<[number, number] | null>;
    // Optional: absent on builds before the window-geometry fix. Feature-detect.
    getState?: () => Promise<WindowState | null>;
    getWorkArea?: () => Promise<{ width: number; height: number } | null>;
    maximize?: () => void;
    minimize?: () => void;
    focus?: () => void;
    /** Satellites only — the main window closes through the clock-out flush. */
    close?: () => void;
    setAlwaysOnTop?: (flag: boolean) => void;
    isFocused?: () => Promise<boolean>;
    setZoom?: (factor: number) => void;
    getZoom?: () => Promise<number | null>;
    /** Windows taskbar overlay badge; the renderer draws the image. No-op elsewhere. */
    setOverlayIcon?: (dataUrl: string | null, description?: string) => void;
    flashFrame?: (flag: boolean) => void;
    // Fires only for user-initiated resize/maximize, never for a programmatic auto-size.
    onUserResized?: (callback: (state: WindowState) => void) => void;
    removeUserResizedListener?: () => void;
    onFocusChange?: (callback: (data: { focused: boolean }) => void) => void;
    removeFocusChangeListener?: () => void;
    openSatellite?: (idToken: string, options?: SatelliteOptions) => Promise<SatelliteResult>;
    closeSatellite?: (key: string) => Promise<{ success: boolean }>;
    listSatellites?: () => Promise<Array<{ key: string; focused: boolean; title: string }>>;
  };
  // Optional: absent on builds predating the OF Manager window. The renderer
  // feature-detects and falls back to in-window navigation. `options` is ignored
  // by pre-multi-window builds, which always open `/of-manager`.
  onlyfans?: {
    openWindow: (idToken: string, options?: SatelliteOptions) => Promise<SatelliteResult>;
  };
  /**
   * GoLogin profile launching. Optional — absent on every build before v0.11.0,
   * so feature-detect: without it the session console says the app needs
   * updating rather than failing silently. The launched browser is **Orbita**,
   * a separate application window this API cannot style or position.
   */
  gologin?: {
    launch: (
      idToken: string,
      profileId: string,
      deviceId?: string | null,
    ) => Promise<GoLoginLaunchResult>;
    stop: (profileId: string) => Promise<{ success: boolean; error?: string }>;
    getSession: (profileId: string) => Promise<GoLoginSession>;
    listSessions: () => Promise<GoLoginSession[]>;
    onSessionChanged: (callback: (session: GoLoginSession) => void) => void;
    removeSessionChangedListeners: () => void;
    /**
     * Profiles that are open (`starting`/`running`) or still committing their
     * session (`stopping`). Closing the window while any are listed is guarded
     * in main — see `onCloseBlocked`.
     */
    busyProfiles?: () => Promise<{ profiles: GoLoginBusyProfile[] }>;
    /**
     * The renderer's answer to the close-guard dialog.
     *
     * `stop-and-close` is "Save & quit": close every open browser, commit each
     * profile, then let the window close itself once the last one lands.
     */
    closeDecision?: (
      decision: 'cancel' | 'force' | 'after-completion' | 'stop-and-close',
    ) => Promise<{ success: boolean }>;
    /** Main held the window open because sessions are live. Show the dialog. */
    onCloseBlocked?: (callback: (payload: { profiles: GoLoginBusyProfile[] }) => void) => void;
    removeCloseBlockedListeners?: () => void;
    /** Absent on builds before v0.12.0 — feature-detect before calling. */
    orbitaStatus?: () => Promise<GoLoginOrbitaState>;
    ensureOrbita?: (
      version?: number,
    ) => Promise<{ success: boolean; version?: number | string; error?: string }>;
    onOrbitaChanged?: (callback: (state: GoLoginOrbitaState) => void) => void;
    removeOrbitaChangedListeners?: () => void;
  };
  timeTracking: {
    getIdleTime: () => Promise<number>;
    captureScreenshot: () => Promise<{ success: boolean; screens?: string[]; error?: string }>;
    setPowerSaveBlocker?: (enable: boolean) => Promise<{ success: boolean }>;
    getActivitySince?: (sinceMs: number) => Promise<Array<{ sampleMs: number; idleSeconds: number }>>;
  };
  /**
   * Always-visible session timer. Optional — absent on every installed build
   * older than the one that shipped it, so feature-detect (a `?.` call is
   * enough; there is no fallback, the widget simply doesn't appear).
   *
   * macOS renders it as the tray title + a template icon; Windows as a small
   * frameless HUD docked above the system tray; other platforms ignore it.
   * Accepted only from the main window — a satellite cannot drive it.
   */
  timerWidget?: {
    update: (payload: TimerWidgetPayload) => void;
  };
  notifications: {
    show: (options: NotificationOptions) => Promise<{ success: boolean }>;
    close?: (id: string) => Promise<{ success: boolean }>;
    onNavigate: (callback: (url: string) => void) => void;
    removeNavigateListener: () => void;
    onPlaySound: (callback: () => void) => void;
    removePlaySoundListener: () => void;
    onActivated?: (callback: (data: { id: string | null }) => void) => void;
    onReply?: (callback: (data: { id: string | null; reply: string }) => void) => void;
    onAction?: (callback: (data: { id: string | null; index: number }) => void) => void;
    removeInteractionListeners?: () => void;
  };
  /** Image-only clipboard read (pasting a screenshot into a composer). Text is
   *  not exposed — the normal paste path already delivers it. */
  clipboard?: {
    readImage: () => Promise<{ dataUrl: string; width: number; height: number } | null>;
    /** Written from main — `navigator.clipboard.writeText` needs the document
     *  focused, and a snip finishes while this window is hidden. */
    writeText?: (text: string) => Promise<{ success: boolean }>;
  };
  /**
   * Snipping Tool — region capture from a global shortcut or the menu-bar/tray
   * item. Optional throughout: a renderer may be weeks older than the installed
   * shell (rule 9c), so every call site feature-detects.
   */
  snip?: {
    /** Arms or disarms the shortcut + tray. `enabled` is the page permission,
     *  resolved client-side; every server route re-checks it independently. */
    configure: (config: {
      enabled: boolean;
      trayIconEnabled: boolean;
      shortcutEnabled: boolean;
      shortcut: string;
      /** Seeds the selection surface's System audio toggle. Optional because a
       *  renderer newer than its shell must still be able to arm the shortcut. */
      systemAudioEnabled?: boolean;
      /** Seeds the selection surface's Microphone toggle and its device
       *  picker. Optional for the same reason as the line above: a renderer
       *  newer than its shell must still be able to arm the shortcut.
       *
       *  Note this seeds the *preference*, never the permission — main reads
       *  the OS status fresh for every surface, so a grant made in System
       *  Settings since the last capture is picked up immediately. */
      micEnabled?: boolean;
      micDeviceId?: string;
      /** Whether THIS renderer can receive a finished recording. A new shell
       *  hides the Video toggle unless it is true, so an old page bundle
       *  cannot start a recording it has no listener for (rule 9c). */
      supportsRecording?: boolean;
    }) => Promise<{ ok: boolean; shortcutRegistered?: boolean }>;
    start: () => Promise<{ success: boolean; error?: string }>;
    /** The cropped region only — never the full screen. */
    onCaptured: (
      callback: (payload: { dataBase64: string; width: number; height: number }) => void,
    ) => void;
    /**
     * The capture runs after the box is drawn, so a failure is otherwise silent
     * — the user selected a region and nothing happened.
     *
     * `reason` distinguishes causes that need different advice:
     *  • `permission`  — macOS Screen Recording is not granted. Retrying cannot
     *                    fix it; the user has to toggle it in System Settings.
     *  • `no-sources`  — `desktopCapturer` returned nothing at all.
     *  • `empty`       — the display's thumbnail came back blank; realistically
     *                    a monitor unplugged or a resolution change inside the
     *                    settle window.
     *  • `crop`        — the crop or PNG encode threw.
     *
     * Recording adds five more, all arriving on the same channel because they
     * are the same thing from the user's side — they drew a box and got
     * nothing:
     *  • `screen-permission` — the OS denied screen capture. **macOS only**;
     *                        main rewrites this to `stream-refused` elsewhere,
     *                        because no other platform has a permission to grant.
     *  • `stream-refused`  — `getDisplayMedia` was refused by our own handler,
     *                        or the OS produced no screen source. NOT a
     *                        permission — never offer an "Open Settings" action.
     *  • `recorder-lost`   — the recorder window died mid-take.
     *  • `empty-recording` — it ran but produced no data.
     *  • `encoder`         — no usable WebM encoder, or MediaRecorder threw.
     *  • `storage`         — no temp file could be opened for the recording.
     *  • `unknown`         — anything else.
     */
    onFailed?: (callback: (payload: { reason: string }) => void) => void;
    /**
     * The shutter: the screen has just been photographed, ahead of the crop and
     * the PNG encode. Optional — a shell older than this has no such channel,
     * and the renderer falls back to `onCaptured` (late, but present).
     */
    onShutter?: (callback: () => void) => void;
    /** A recording is starting, sent before the recorder window opens so a cue
     *  cannot land inside the recording's own system audio. */
    onRecordingStarted?: (callback: () => void) => void;
    removeCapturedListeners: () => void;
    onNavigate: (callback: (href: string) => void) => void;
    removeNavigateListeners: () => void;

    /**
     * A recording has finished and is sitting in a temp file main owns.
     *
     * `token` is an opaque handle, **not a path** — the renderer cannot read
     * the file and cannot name one. It hands the token back to
     * `uploadRecording` along with a signed slot, and main streams the bytes
     * to Cloud Storage itself.
     */
    onRecorded?: (
      callback: (payload: {
        token: string;
        durationMs: number;
        width: number;
        height: number;
        bytes: number;
        hasPoster: boolean;
      }) => void,
    ) => void;
    removeRecordedListeners?: () => void;
    /**
     * Streams the recording (and its poster) to the signed slots, from main.
     * Bulk bytes never cross this context or a Vercel function — rule 9i.
     *
     * `resumable` selects the protocol: a video slot is a resumable session
     * (chunked, and continued from the bucket's confirmed offset after an
     * interruption), anything else is a single PUT. **A failure here does not
     * destroy the recording** — it stays in main's on-disk queue and comes
     * back from `listPendingRecordings`.
     */
    uploadRecording?: (options: {
      token: string;
      uploadUrl: string;
      resumable?: boolean;
      posterUploadUrl?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      posterUploaded?: boolean;
      /** False when retrying cannot help (a refused signature, a bad size). */
      retryable?: boolean;
    }>;
    /** Delete a queued recording for good. A failed *transfer* keeps its file;
     *  this is for when there is nowhere for it to go, or the user said so. */
    discardRecording?: (token: string) => Promise<{ success: boolean }>;

    /**
     * Recordings still waiting to upload, failures included.
     *
     * The queue is a directory in `userData`, so this survives a quit, a crash
     * and a reboot. It is what the Snipping Tool page lists so a failed
     * upload is visible and retryable rather than silently lost.
     */
    listPendingRecordings?: () => Promise<PendingRecording[]>;
    onPendingChanged?: (callback: (list: PendingRecording[]) => void) => void;
    removePendingListeners?: () => void;
    /** Bytes confirmed by the bucket, not bytes written to the socket. */
    onUploadProgress?: (
      callback: (progress: { token: string; sent: number; total: number }) => void,
    ) => void;
    /** Write a queued recording somewhere the user picks. Main shows the
     *  native dialog; the renderer never names a path. */
    savePendingRecording?: (
      token: string,
    ) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
    /** An audio choice changed on the selection surface — System audio, the
     *  Microphone toggle, or the input device. This window holds the session,
     *  so it is the one that persists them.
     *
     *  `micEnabled` and `micDeviceId` are optional on the wire: a shell older
     *  than 0.14.2 sends neither, and `resolveSnipSettings` defaults both. */
    onAudioPrefs?: (
      callback: (prefs: {
        systemAudioEnabled: boolean;
        micEnabled?: boolean;
        micDeviceId?: string;
      }) => void,
    ) => void;
    removeAudioPrefsListeners?: () => void;
  };
  /** Saving to disk. Always via a native save dialog; the renderer never names
   *  a path, and only paths written this session can be revealed or opened. */
  files?: {
    save: (options: SaveFileOptions) => Promise<SaveFileResult>;
    /** Streams a remote http(s) URL to disk — use for large media so the bytes
     *  never sit in renderer memory. */
    download: (options: { url: string; suggestedName?: string; id?: string }) =>
      Promise<{ success: boolean; id?: string; error?: string }>;
    showInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    open: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    onDownloadProgress: (callback: (data: DownloadProgress) => void) => void;
    onDownloadDone: (callback: (data: DownloadDone) => void) => void;
    removeDownloadListeners: () => void;
  };
  onAppClosing: (callback: () => void) => void;
  removeAppClosingListeners: () => void;
  app: {
    getPlatform: () => Promise<string>;
    getVersion?: () => Promise<string>;
    getVersions?: () => Promise<{
      app: string;
      electron: string;
      chrome: string;
      node: string;
      platform: string;
      arch: string;
    }>;
    signalReady: () => void;
    closingFlushed?: () => void;
    retryLoad?: () => void;
    /** macOS/Linux dock badge. Windows has no numeric badge — draw one and pass
     *  it to `window.setOverlayIcon` instead. */
    setBadgeCount?: (count: number) => Promise<{ success: boolean; error?: string }>;
    /** macOS dock bounce. Returns the bounce id for `cancelBounce`. */
    bounceDock?: (type?: 'informational' | 'critical') => Promise<number | null>;
    cancelBounce?: (id: number) => void;
    /** Non-OAuth `bluu://` deep links. Read once on mount — the URL can arrive
     *  before React mounts, so the event alone is unreliable. */
    getPendingDeepLink?: () => Promise<DeepLinkRoute | null>;
    onDeepLink?: (callback: (data: DeepLinkRoute) => void) => void;
    removeDeepLinkListener?: () => void;
  };
  power?: {
    onEvent: (callback: (data: { event: 'suspend' | 'resume' | 'lock' | 'unlock'; at: number }) => void) => void;
    removeEventListener: () => void;
  };
  permissions: {
    requestScreenAccess: () => Promise<{ success: boolean }>;
    requestNotification: () => Promise<{ success: boolean }>;
    /**
     * TEMPORARY (v0.8.1+): one-time `tccutil reset ScreenCapture` to repair a
     * stale macOS Screen Recording grant left by pre-signing builds. Optional —
     * feature-detect; absent on older installed builds. See CLAUDE.md removal note.
     */
    resetScreenCapture?: () => Promise<{ success: boolean; alreadyReset?: boolean; error?: string }>;

    /**
     * The microphone, for the Snipping Tool's settings card.
     *
     * Optional throughout — an installed shell older than 0.14.2 has none of
     * these, and every call site feature-detects (rule 9c).
     *
     * **`microphoneStatus` is why there are three of these rather than one.**
     * A lone "request" call cannot tell "never asked" from "refused", and on
     * macOS those need opposite treatment: the first shows an OS prompt, the
     * second shows nothing at all, because `askForMediaAccess` resolves with
     * the existing status and suppresses the alert once access has been
     * denied. A UI wired only to `request` is therefore a button that silently
     * does nothing for exactly the users who need it to work.
     */
    microphoneStatus?: () => Promise<{
      /** False where the platform has no microphone permission to read. */
      supported: boolean;
      status: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
      /** macOS only. Windows gates every win32 app behind one global switch,
       *  so there is nothing to prompt and the only move is the settings page. */
      canPrompt: boolean;
    }>;
    /** Prompts where a prompt would actually be shown; otherwise opens the OS
     *  settings page. `prompted` / `settingsOpened` say which happened, so the
     *  caller can update its copy honestly rather than guessing. */
    requestMicrophoneAccess?: () => Promise<{
      status: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
      prompted: boolean;
      settingsOpened: boolean;
    }>;
    /** The OS page where microphone access is granted. Exists on **both**
     *  platforms, unlike `requestScreenAccess` — see its note in main.js. */
    openMicrophoneSettings?: () => Promise<{ success: boolean }>;
  };
  /**
   * macOS auto-update. `getPending`/`onAvailable`/`download` land in v0.8.0 —
   * feature-detect them: builds older than that have no updater at all and must
   * fall back to the manual APP_UPDATE prompt.
   */
  updater: {
    getPending?: () => Promise<{ version: string | null } | null>;
    /**
     * Re-run the GitHub check on demand — the renderer's "Check again" button,
     * and also what a hidden-not-quit macOS app (HIDE_ON_CLOSE) relies on
     * between the shell's own periodic re-checks. Optional because older shells
     * predate the handler; there the renderer falls back to re-reading
     * `getPending()`, which on that build really can only change on a relaunch.
     */
    check?: () => Promise<void>;
    onAvailable?: (callback: (data: { version: string | null }) => void) => void;
    download?: () => void;
    onStatus: (callback: (data: { status: 'downloading' | 'error'; version?: string; message?: string }) => void) => void;
    onProgress: (callback: (data: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => void) => void;
    onBeforeInstall: (callback: () => void) => void;
    readyToInstall: () => void;
    removeListeners: () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
