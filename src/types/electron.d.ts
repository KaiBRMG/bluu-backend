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
  timeTracking: {
    getIdleTime: () => Promise<number>;
    captureScreenshot: () => Promise<{ success: boolean; screens?: string[]; error?: string }>;
    setPowerSaveBlocker?: (enable: boolean) => Promise<{ success: boolean }>;
    getActivitySince?: (sinceMs: number) => Promise<Array<{ sampleMs: number; idleSeconds: number }>>;
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
