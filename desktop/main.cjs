const { app, BrowserWindow, shell, session, protocol } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');

protocol.registerSchemesAsPrivileged([{
  scheme: 'ledgerly',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

const isDev = process.env.LEDGERLY_DEV_SERVER === '1';
const devOrigin = 'http://127.0.0.1:5173';
const packagedRoot = path.resolve(process.resourcesPath, 'app-dist');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip'
};

function isTrustedPage(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (isDev) return parsed.origin === devOrigin;
    return parsed.protocol === 'ledgerly:' && parsed.hostname === 'app' && parsed.pathname === '/index.html';
  } catch {
    return false;
  }
}

async function handlePackagedAsset(request) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  try {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(packagedRoot, pathname);
    const relative = path.relative(packagedRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Not found', { status: 404 });
    }
    const bytes = await readFile(target);
    const contentType = mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream';
    return new Response(bytes, { status: 200, headers: { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
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
    void win.loadURL('ledgerly://app/index.html');
  }
}

app.whenReady().then(async () => {
  if (!isDev) await protocol.handle('ledgerly', handlePackagedAsset);
  installPermissionPolicy();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
