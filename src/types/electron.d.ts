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
     *  • `unknown`     — anything else.
     */
    onFailed?: (callback: (payload: { reason: string }) => void) => void;
    removeCapturedListeners: () => void;
    onNavigate: (callback: (href: string) => void) => void;
    removeNavigateListeners: () => void;
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
