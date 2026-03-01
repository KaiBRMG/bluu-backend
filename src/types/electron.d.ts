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
  };
  timeTracking: {
    getIdleTime: () => Promise<number>;
    captureScreenshot: () => Promise<{ success: boolean; screens?: string[]; error?: string }>;
  };
  notifications: {
    show: (options: { title: string; body: string; playSound: boolean; actionUrl?: string | null }) => Promise<{ success: boolean }>;
    onNavigate: (callback: (url: string) => void) => void;
    removeNavigateListener: () => void;
  };
  onAppClosing: (callback: () => void) => void;
  removeAppClosingListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
