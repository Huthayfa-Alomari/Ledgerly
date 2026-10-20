const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const isDev = process.env.LEDGERLY_DEV_SERVER === '1';

function createWindow() {
  const win = new BrowserWindow({
    title: 'Ledgerly',
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#101827',
    autoHideMenuBar: true,
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
    if (isDev && url.startsWith('http://127.0.0.1:5173')) return;
    if (!url.startsWith('file://')) event.preventDefault();
  });

  if (isDev) {
    void win.loadURL('http://127.0.0.1:5173');
  } else {
    void win.loadFile(path.join(process.resourcesPath, 'app-dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
