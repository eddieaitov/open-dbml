const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'Open DBML — DBML Editor',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // ── Handle close with unsaved changes ──────────────────────────────
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.webContents.send('window-close-request');
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Log any renderer errors
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer] ${message}`);
  });
}

// ── IPC: file open dialog ────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'DBML Files', extensions: ['dbml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { canceled: true };
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  return { canceled: false, filePath, content };
});

// ── IPC: file save (or save-as when no path is given) ────────────────────────
ipcMain.handle('dialog:saveFile', async (event, { content, filePath }) => {
  let savePath = filePath;
  if (!savePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [
        { name: 'DBML Files', extensions: ['dbml'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled) return { canceled: true };
    savePath = result.filePath;
  }
  fs.writeFileSync(savePath, content, 'utf-8');
  return { canceled: false, filePath: savePath };
});

// ── App ready ────────────────────────────────────────────────────────────────

// ── IPC: confirm close with unsaved dialog ─────────────────────────────
ipcMain.handle('app:confirm-close', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Discard', 'Cancel', 'Save'],
    defaultId: 2,
    cancelId: 1,
    message: 'You have unsaved changes.',
    detail: 'Do you want to save before closing?',
  });
  return result.response; // 0=Discard, 1=Cancel, 2=Save
});

ipcMain.handle('app:do-close', () => {
  app.exit(0);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
