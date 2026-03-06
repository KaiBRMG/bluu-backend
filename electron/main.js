// electron/main.js
const { app, BrowserWindow, shell, nativeImage, ipcMain, powerMonitor, desktopCapturer, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const isDev = process.env.ELECTRON_DEV === 'true' || !app.isPackaged;

// Custom protocol for OAuth callback
const PROTOCOL = 'bluu';
let mainWindow = null;
let deeplinkUrl = null; // Store deep link if it arrives before window is ready

// Register custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    const registered = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    console.log(`Protocol ${PROTOCOL}:// registration (dev):`, registered);
  }
} else {
  const registered = app.setAsDefaultProtocolClient(PROTOCOL);
  console.log(`Protocol ${PROTOCOL}:// registration (prod):`, registered);
}

// Handle deep links (macOS)
app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('open-url event received:', url);

  if (mainWindow && mainWindow.webContents) {
    handleDeepLink(url);
  } else {
    // Store the URL to handle it after window is created
    deeplinkUrl = url;
    console.log('Window not ready, storing deep link for later');
  }
});

// Handle deep links (Windows)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Windows deep link handling
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
      handleDeepLink(url);
    }

    // Focus the window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function handleDeepLink(url) {
  console.log('Deep link received:', url);

  // Focus the app window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (app.dock && process.platform === 'darwin') {
      app.dock.show();
    }
  }

  // Parse the URL to extract the authorization code
  try {
    const urlObj = new URL(url);
    console.log('Parsed URL - host:', urlObj.host, 'pathname:', urlObj.pathname, 'search:', urlObj.search);

    // In custom protocols, 'callback' becomes the host, not the pathname
    // bluu://callback?code=123 -> host: 'callback', pathname: ''
    if (urlObj.host === 'callback' || urlObj.pathname === '/callback') {
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');

      console.log('OAuth callback - code:', code ? 'present' : 'missing', 'error:', error || 'none');

      if (mainWindow && mainWindow.webContents) {
        if (error) {
          console.log('Sending oauth-error to renderer:', error);
          mainWindow.webContents.send('oauth-error', error);
        } else if (code) {
          console.log('Sending oauth-callback to renderer with code');
          mainWindow.webContents.send('oauth-callback', code);
        } else {
          console.error('No code or error in callback URL');
        }
      } else {
        console.error('mainWindow or webContents not available');
      }
    } else {
      console.log('Deep link host/pathname does not match callback. Host:', urlObj.host, 'Pathname:', urlObj.pathname);
    }
  } catch (err) {
    console.error('Error parsing deep link:', err);
  }
}

// IPC handlers for OAuth
ipcMain.handle('auth:start-google-oauth', async () => {
  const baseUrl = isDev ? 'http://localhost:3000' : 'https://bluu-backend.vercel.app';
  const authUrl = `${baseUrl}/auth/google`;

  // Open the browser for OAuth
  shell.openExternal(authUrl);

  return { success: true };
});

// IPC handler for idle time detection
ipcMain.handle('timeTracking:getIdleTime', () => {
  return powerMonitor.getSystemIdleTime();
});

// IPC handler for screenshot capture (all screens)
ipcMain.handle('timeTracking:captureScreenshot', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length === 0) {
      return { success: false, error: 'No screen sources available' };
    }

    // Capture all connected screens, filtering out empty captures
    const screens = sources
      .map(source => source.thumbnail.toPNG().toString('base64'))
      .filter(b64 => b64.length > 0);

    if (screens.length === 0) {
      return { success: false, error: 'All screen captures were empty (check screen recording permissions)' };
    }

    return { success: true, screens };
  } catch (err) {
    console.error('[Screenshot] Capture failed:', err);
    return { success: false, error: err.message };
  }
});

// IPC handler for system notifications + sound
ipcMain.handle('notifications:show', async (_event, { title, body, playSound, actionUrl }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body, silent: true });

    if (actionUrl && mainWindow) {
      notif.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.webContents.send('notification:navigate', actionUrl);
        }
      });
    }

    notif.show();
  }

  if (playSound && mainWindow) {
    mainWindow.webContents.send('notifications:play-sound');
  }

  return { success: true };
});

// IPC handler for window resizability
ipcMain.on('window:set-resizable', (_event, resizable) => {
  console.log('[Performance] IPC setResizable called:', resizable);
  if (mainWindow) {
    mainWindow.setResizable(resizable);
  }
});

// IPC handler for window size
ipcMain.on('window:set-size', (_event, width, height) => {
  if (mainWindow) {
    mainWindow.setSize(width, height, true);
    mainWindow.center();
  }
});

function createWindow() {
  // Set app icon for macOS dock
  const iconPath = path.join(__dirname, './public/logo/icon.icns');
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(image);
  }

  mainWindow = new BrowserWindow({
    width: 1430,
    height: 870,
    resizable: false,  // Start with window locked (login page)
    show: false,  // Don't show until ready (prevents white flash)
    backgroundColor: '#002333',     // Match your logo's dark background
    icon: iconPath,  // App icon for window
    title: `Bluu Backend (${app.getVersion()})`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,     // important for security
      nodeIntegration: false,     // important for security
      sandbox: false,
      v8CacheOptions: 'code',  // Enable V8 code caching for faster startup
    },
  });

  // In dev, load local Next.js
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    // mainWindow.webContents.openDevTools();
  } else {
    // In production, load your hosted site
    mainWindow.loadURL('https://bluu-backend.vercel.app');
  }

  // Open external links (target=_blank) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // allow only external URLs to open in external browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent navigation to other origins from the electron window
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? 'http://localhost:3000' : 'https://bluu-backend.vercel.app';
    if (!url.startsWith(allowed)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Show window only when content is ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle stored deep link after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    if (deeplinkUrl) {
      console.log('Processing stored deep link:', deeplinkUrl);
      handleDeepLink(deeplinkUrl);
      deeplinkUrl = null;
    }
  });

  return mainWindow;
}

function initAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:status', { status: 'downloading', version: info.version });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        total: progress.total,
        transferred: progress.transferred,
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    // Give the renderer up to 10 seconds to flush pending data before installing
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:before-install');
      const installTimer = setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 10000);
      ipcMain.once('updater:ready-to-install', () => {
        clearTimeout(installTimer);
        autoUpdater.quitAndInstall(false, true);
      });
    } else {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err);
    if (mainWindow) {
      mainWindow.webContents.send('updater:status', { status: 'error', message: err.message });
    }
  });

  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Forward main-process errors to the renderer so they reach the /api/bugs route
function forwardErrorToRenderer(context, message, stack) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('bug:report', { context, message, stack });
  }
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  forwardErrorToRenderer('electron:main:uncaughtException', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  console.error('[main] unhandledRejection:', reason);
  forwardErrorToRenderer('electron:main:unhandledRejection', message, stack);
});

// Notify renderer before quitting so it can clock out k
app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('app-closing');
  }
});

// Quit on all windows closed (including macOS)
app.on('window-all-closed', () => {
  app.quit();
});
