const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function maakVenster() {
  const venster = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 600,
    title: 'CoinPower',
    backgroundColor: '#13101f',
    icon: path.join(__dirname, 'icon.icns'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 13 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // User-Agent marker zodat de webapp herkent dat 'ie binnen Electron draait.
  const huidigUA = venster.webContents.getUserAgent();
  venster.webContents.setUserAgent(huidigUA + ' CoinPowerMac/1.0.0');

  venster.loadURL('https://bucolic-fenglisu-dc4a49.netlify.app');

  // Externe links in de standaardbrowser openen
  venster.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Nette Mac-menubalk met standaard sneltoetsen
function maakMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'CoinPower',
      submenu: [
        { role: 'about', label: 'Over CoinPower' },
        { type: 'separator' },
        { role: 'hide', label: 'Verberg CoinPower' },
        { role: 'hideOthers', label: 'Verberg overige' },
        { role: 'unhide', label: 'Toon alle' },
        { type: 'separator' },
        { role: 'quit', label: 'CoinPower afsluiten' }
      ]
    }] : []),
    {
      label: 'Wijzig',
      submenu: [
        { role: 'undo', label: 'Ongedaan maken' },
        { role: 'redo', label: 'Opnieuw' },
        { type: 'separator' },
        { role: 'cut', label: 'Knippen' },
        { role: 'copy', label: 'Kopiëren' },
        { role: 'paste', label: 'Plakken' },
        { role: 'selectAll', label: 'Alles selecteren' }
      ]
    },
    {
      label: 'Beeld',
      submenu: [
        { role: 'reload', label: 'Herladen' },
        { role: 'forceReload', label: 'Geforceerd herladen' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Werkelijke grootte' },
        { role: 'zoomIn', label: 'Inzoomen' },
        { role: 'zoomOut', label: 'Uitzoomen' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Volledig scherm' }
      ]
    },
    {
      label: 'Venster',
      submenu: [
        { role: 'minimize', label: 'Minimaliseren' },
        { role: 'close', label: 'Venster sluiten' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  maakMenu();
  maakVenster();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) maakVenster();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
