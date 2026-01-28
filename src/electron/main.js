// electron/main.js
const { app, BrowserWindow, shell, nativeImage, ipcMain } = require('electron');
const path = require('path');

const isDev = process.env.ELECTRON_DEV === 'true' || process.env.NODE_ENV !== 'production';

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
  const baseUrl = isDev ? 'http://localhost:3000' : 'https://app.yourcompany.com';
  const authUrl = `${baseUrl}/auth/google`;

  // Open the browser for OAuth
  shell.openExternal(authUrl);

  return { success: true };
});

// IPC handler for window resizability
ipcMain.on('window:set-resizable', (_event, resizable) => {
  console.log('[Performance] IPC setResizable called:', resizable);
  if (mainWindow) {
    mainWindow.setResizable(resizable);
  }
});

function createWindow() {
  // Set app icon for macOS dock
  const iconPath = path.join(__dirname, '../public/logo/icon.icns');
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(image);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    resizable: false,  // Start with window locked (login page)
    show: false,  // Don't show until ready (prevents white flash)
    backgroundColor: '#002333',     // Match your logo's dark background
    icon: iconPath,  // App icon for window
    title: 'Bluu',
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
    // TODO: Update this to your production URL
    mainWindow.loadURL('https://app.yourcompany.com');
  }

  // Open external links (target=_blank) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // allow only external URLs to open in external browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent navigation to other origins from the electron window
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? 'http://localhost:3000' : 'https://app.yourcompany.com';
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit on all windows closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
