interface ElectronAPI {
  isElectron: boolean;
  auth: {
    startGoogleOAuth: () => Promise<{ success: boolean }>;
    onOAuthCallback: (callback: (code: string) => void) => void;
    onOAuthError: (callback: (error: string) => void) => void;
    removeOAuthListeners: () => void;
  };
  window: {
    setResizable: (resizable: boolean) => void;
    setSize: (width: number, height: number) => void;
    getSize?: () => Promise<[number, number] | null>;
  };
  timeTracking: {
    getIdleTime: () => Promise<number>;
    captureScreenshot: () => Promise<{ success: boolean; screens?: string[]; error?: string }>;
    setPowerSaveBlocker?: (enable: boolean) => Promise<{ success: boolean }>;
    getActivitySince?: (sinceMs: number) => Promise<Array<{ sampleMs: number; idleSeconds: number }>>;
  };
  notifications: {
    show: (options: { title: string; body: string; playSound: boolean; actionUrl?: string | null }) => Promise<{ success: boolean }>;
    onNavigate: (callback: (url: string) => void) => void;
    removeNavigateListener: () => void;
    onPlaySound: (callback: () => void) => void;
    removePlaySoundListener: () => void;
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
