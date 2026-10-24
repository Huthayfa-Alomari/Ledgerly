const { app, BrowserWindow, shell, session } = require('electron');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const isDev = process.env.LEDGERLY_DEV_SERVER === '1';
const devOrigin = 'http://127.0.0.1:5173';
const packagedIndex = path.resolve(process.resourcesPath, 'app-dist', 'index.html');

function isTrustedPage(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (isDev) return parsed.origin === devOrigin;
    return parsed.protocol === 'file:' && path.resolve(fileURLToPath(parsed)) === packagedIndex;
  } catch {
    return false;
  }
}

function installPermissionPolicy() {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    if (!isTrustedPage(requestingUrl)) return callback(false);

    if (permission === 'geolocation') return callback(true);
    if (permission === 'media') {
      const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      // Camera only. Microphone/audio capture and every other permission are denied.
      return callback(mediaTypes.includes('video') && !mediaTypes.includes('audio'));
    }
    return callback(false);
  });

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => {
    const candidateUrl = isTrustedPage(requestingOrigin || '') ? requestingOrigin : (webContents?.getURL?.() || requestingOrigin || '');
    if (!isTrustedPage(candidateUrl)) return false;
    if (permission === 'geolocation') return true;
    if (permission === 'media') return details.mediaType === 'video';
    return false;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Ledgerly',
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#101827',
    autoHideMenuBar: true,
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, 'build', 'icon.png') }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && new URL(url).origin === devOrigin) return;
    if (!isTrustedPage(url)) event.preventDefault();
  });

  if (isDev) {
    void win.loadURL(devOrigin);
  } else {
    void win.loadFile(packagedIndex);
  }
}

app.whenReady().then(() => {
  installPermissionPolicy();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
