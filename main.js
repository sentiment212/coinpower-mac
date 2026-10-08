const { app, BrowserWindow, Menu, Notification, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Het venster onthouden zodat de meldingen-lus het naar voren kan halen.
let hoofdVenster = null;

function maakVenster() {
  const venster = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 600,
    title: 'CoinPower',
    backgroundColor: '#13101f',
    icon: path.join(__dirname, process.platform === 'darwin' ? 'icon.icns' : 'icon.ico'),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 13 } } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 30-8-2026 — de brug naar de webapp. contextIsolation blijft AAN; het
      // preload-script geeft precies twee dingen door en verder niets.
      preload: path.join(__dirname, 'preload.js')
    }
  });
  hoofdVenster = venster;
  venster.on('closed', () => { if (hoofdVenster === venster) hoofdVenster = null; });

  // User-Agent marker zodat de webapp herkent dat 'ie binnen Electron draait.
  const huidigUA = venster.webContents.getUserAgent();
  venster.webContents.setUserAgent(huidigUA + ' CoinPowerMac/1.0.0');

  venster.loadURL('https://mijn.coinpower.nl');

  // Externe links in de standaardbrowser openen
  venster.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}


/* ============================================================================
   MELDINGEN — 30-8-2026

   Web-push werkt niet in Electron: Chromium heeft daar geen pushdienst. Deze
   app haalt daarom zelf op bij /notif/meldingen (portfolio-piramide-api) en
   toont met Electrons eigen Notification.

   Het token komt uit het preload-script; zonder token wordt er niets opgehaald
   en gebeurt er ook niets vervelends — de lus wacht gewoon.
   ============================================================================ */

const API = 'https://portfolio-piramide-api-production.up.railway.app';
const OPHAAL_MS = 45000;

let token = null;           // laatst gemelde inlogtoken uit de webapp
let laatsteTijd = null;     // gemaakt_op van de nieuwste melding die we toonden
let lusBezig = false;       // voorkomt dat een trage ronde over de volgende heen loopt
let stilteRondes = 0;       // hoeveel ronden er al geen token was (zie haalMeldingen)
let ronde = 0;              // hoeveelste geslaagde ophaalronde, puur voor de log

/* 30-8-2026 — ONTDUBBELEN OP ID, NIET OP TIJD.
   `sinds` blijft staan om het verzoek klein te houden, maar mag NIET beslissen
   wat er op het scherm komt. Reden, gemeten tegen de echte database: Postgres
   bewaart microseconden (…14.648226Z) en JSON levert alleen milliseconden
   (…14.648Z). De app onthield dus een tijdstip dat ietsje VROEGER is dan de
   melding zelf, en `gemaakt_op > sinds` bleef waar — dezelfde melding kwam elke
   45 seconden terug, met geluid. Een id is exact; een tijdstip is dat niet. */
const GETOOND_MAX = 300;          // hoeveel ids we onthouden voor we opruimen
let getoondeIds = new Set();      // Sets houden invoegvolgorde aan: eerste = oudste

function onthoudGetoond(id) {
  if (!id) return;
  getoondeIds.add(id);
  if (getoondeIds.size > GETOOND_MAX) {
    // Grens bereikt: de oudste helft weg. Niet alles wissen — dan zou een
    // melding die net buiten de vorige ronde viel opnieuw kunnen verschijnen.
    const behouden = Array.from(getoondeIds).slice(Math.floor(GETOOND_MAX / 2));
    getoondeIds = new Set(behouden);
    console.log('[meldingen] id-geheugen opgeruimd, ' + getoondeIds.size + ' over.');
  }
}

// Het preload-script meldt het token bij elke pagina-lading en daarna elke 20 s.
ipcMain.on('cp:token', (_g, nieuw) => {
  const was = token;
  token = (typeof nieuw === 'string' && nieuw.length > 20) ? nieuw : null;
  if (!token && was) {
    // Uitgelogd: alles vergeten, badge weg. Anders zou de volgende gebruiker
    // op dit toestel de meldingen van de vorige zien.
    laatsteTijd = null;
    getoondeIds = new Set();
    zetBadge(0);
  }
});

// De tien pictogrammen, dezelfde vormen als in de webapp (sw.js r22-33).
// Onbekend soort of ontbrekend bestand: het app-icoon.
const NOTIF_ICOON = {
  'kanaal':          'icon-notif-kanaal.png',
  'dm':              'icon-notif-dm.png',
  'nieuws':          'icon-notif-nieuws.png',
  'votings':         'icon-notif-votings.png',
  'sentiment':       'icon-notif-sentiment.png',
  'portfolio-alert': 'icon-notif-portfolio-alert.png',
  'inkoopplan':      'icon-notif-inkoopplan.png',
  'freeride':        'icon-notif-freeride.png',
  'abo-herinnering': 'icon-notif-abo-herinnering.png',
  'order':           'icon-notif-order.png'
};

function icoonVoor(type) {
  const naam = NOTIF_ICOON[type];
  if (naam) {
    const pad = path.join(__dirname, 'meldingsiconen', naam);
    // Bestaat het bestand echt? Een ontbrekend pad geeft in Electron een
    // melding zonder icoon; het app-icoon is dan de betere terugval.
    if (fs.existsSync(pad)) return pad;
  }
  return path.join(__dirname, 'icon.icns');
}

let laatsteBadge = null;      // wat er nu op het Dock-icoon staat

function zetBadge(aantal) {
  if (process.platform !== 'darwin' || !app.dock) return;
  const tekst = aantal > 0 ? String(aantal) : '';
  if (tekst !== laatsteBadge) {
    console.log('[meldingen] dock-badge: ' +
      (laatsteBadge === null ? '(nog niet gezet)' : (laatsteBadge === '' ? 'leeg' : laatsteBadge)) +
      ' -> ' + (tekst === '' ? 'leeg (nul ongelezen)' : tekst));
    laatsteBadge = tekst;
  }
  app.dock.setBadge(tekst);
}

function toon(melding) {
  const icoonPad = icoonVoor(melding.type);
  console.log('[meldingen] tonen: [' + (melding.type || '?') + '] "' +
    String(melding.titel || '') + '"  pictogram ' + path.basename(icoonPad));
  try {
  const n = new Notification({
    title: String(melding.titel || 'CoinPower'),
    body: String(melding.body || ''),
    icon: icoonPad,
    silent: false,          // geluid aan: het standaardgeluid van het systeem
    sound: 'Ping'           // macOS: een herkenbaar, kort geluid
  });
  const doel = (typeof melding.url === 'string' && melding.url.startsWith('/'))
    ? melding.url : '/';
  n.on('click', () => {
    if (!hoofdVenster) { maakVenster(); return; }
    if (hoofdVenster.isMinimized()) hoofdVenster.restore();
    hoofdVenster.show();
    hoofdVenster.focus();
    // De app zelf naar voren; zonder dit blijft CoinPower achter het venster
    // waar je op dat moment in werkt.
    if (app.focus) app.focus({ steal: true });
    // Navigeren via het preload-script: geen herlading, de webapp blijft staan.
    hoofdVenster.webContents.send('cp:navigeer', doel);
  });
  n.on('failed', (_e, fout) => {
    console.warn('[meldingen] TONEN MISLUKT (systeem weigerde): ' + fout);
  });
  n.on('show', () => {
    console.log('[meldingen] getoond: [' + (melding.type || '?') + '] "' +
      String(melding.titel || '') + '"');
  });
  n.show();
  } catch (e) {
    // Een melding die niet getoond kan worden mag de lus nooit stilleggen.
    console.warn('[meldingen] TONEN MISLUKT: ' + (e && e.message));
  }
}

async function haalMeldingen() {
  if (!token) {
    // Stil wachten op iets dat nooit komt is de gevaarlijkste uitkomst: zonder
    // token gebeurt er niets EN klaagt er niets. Daarom elke tiende ronde (45 s
    // x 10 = 7,5 minuut) één regel, niet elke ronde — dat vervuilt de log.
    stilteRondes++;
    if (stilteRondes % 10 === 1) {
      console.warn('[meldingen] nog geen token na ' + stilteRondes +
        ' ronden — de webapp heeft niets gemeld onder localStorage-sleutel ' +
        '"pp_auth_token" (preload.js r21). Niet ingelogd, of de sleutel klopt niet.');
    }
    return;
  }
  if (stilteRondes) {
    console.log('[meldingen] token binnen na ' + stilteRondes + ' stille ronden.');
    stilteRondes = 0;
  }
  if (lusBezig) return;
  lusBezig = true;
  try {
    const url = API + '/notif/meldingen' +
      (laatsteTijd ? ('?sinds=' + encodeURIComponent(laatsteTijd)) : '');
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      console.warn('[meldingen] HTTP ' + r.status);
      return;                  // volgende ronde opnieuw
    }
    const d = await r.json();
    const lijst = Array.isArray(d && d.meldingen) ? d.meldingen : [];
    ronde++;

    // Eerste ronde na het starten: niets tonen, alleen het ijkpunt zetten.
    // Anders krijg je bij elke start de hele geschiedenis over je heen.
    if (laatsteTijd === null) {
      if (lijst.length) laatsteTijd = lijst[0].gemaakt_op;
      // Ook deze onthouden, anders zou de nieuwste er volgende ronde alsnog
      // doorheen glippen: `sinds` levert 'm door de microseconden opnieuw aan.
      for (const m of lijst) onthoudGetoond(m.id);
      console.log('[meldingen] ronde ' + ronde + ' (IJKPUNT): API gaf ' + lijst.length +
        ', overgeslagen ' + lijst.length + ', nieuw 0. Bij het starten tonen we ' +
        'met opzet niets; alleen wat hierna binnenkomt verschijnt.' +
        (laatsteTijd ? ' IJkpunt gezet op ' + laatsteTijd + '.' : ''));
      zetBadge(Number(d.ongelezen) || 0);
      return;
    }

    const alGetoond = lijst.filter((m) => getoondeIds.has(m.id)).length;
    console.log('[meldingen] ronde ' + ronde + ': API gaf ' + lijst.length +
      ', al getoond ' + alGetoond + ', nieuw ' + (lijst.length - alGetoond) +
      '  (ongelezen volgens de server: ' + (Number(d.ongelezen) || 0) + ')');

    // Oudste eerst tonen, zodat de nieuwste bovenaan eindigt.
    for (const m of lijst.slice().reverse()) {
      if (getoondeIds.has(m.id)) continue;    // al getoond: overslaan
      toon(m);
      onthoudGetoond(m.id);
      if (!laatsteTijd || m.gemaakt_op > laatsteTijd) laatsteTijd = m.gemaakt_op;
    }
    zetBadge(Number(d.ongelezen) || 0);
  } catch (e) {
    // Netwerk weg, API plat, JSON stuk: loggen en volgende ronde opnieuw.
    console.warn('[meldingen] ophalen faalde: ' + (e && e.message));
  } finally {
    lusBezig = false;
  }
}

/* 30-8-2026 — WAT KAN ELECTRON ONS VERTELLEN OVER DE TOESTEMMING?
   Electron heeft géén api die zegt of macOS meldingen van deze app toestaat:
   `Notification.isSupported()` zegt alleen of het platform het aankan, niet of
   de gebruiker het heeft toegestaan. Het enige harde signaal achteraf is het
   'failed'-event op een melding (zie toon()). Daarom loggen we hier wat er wél
   te weten valt, inclusief de bundel-identiteit — want dáár hangt de
   toestemming in macOS aan vast. Onverpakt (npx electron .) draait de app onder
   de identiteit van Electron zelf, niet onder nl.coinpower.mac; de toestemming
   kan dus per manier van starten verschillen. */
function meldToestemming() {
  console.log('[meldingen] ---- toestemming ----');
  console.log('[meldingen] Notification.isSupported(): ' + Notification.isSupported());
  console.log('[meldingen] app.isPackaged           : ' + app.isPackaged +
    (app.isPackaged ? '' : '   (onverpakt: macOS ziet dit als Electron, niet als CoinPower)'));
  console.log('[meldingen] bundel-id                : ' + (app.getName ? app.getName() : '?') +
    ' / ' + process.execPath);
  console.log('[meldingen] Electron ' + process.versions.electron +
    ' · Chromium ' + process.versions.chrome + ' · macOS ' + process.getSystemVersion());
  console.log('[meldingen] LET OP: of macOS de melding ook echt TOONT is hier niet');
  console.log('[meldingen]         op te vragen. Systeeminstellingen > Berichtgeving');
  console.log('[meldingen]         is de enige waarheid; een geweigerde melding');
  console.log('[meldingen]         komt hieronder terug als TONEN MISLUKT.');
  console.log('[meldingen] ---------------------');
}

function startMeldingen() {
  meldToestemming();
  // Testmelding alleen op uitdrukkelijk verzoek: CP_TESTMELDING=1.
  // Zonder die variabele gebeurt er niets.
  if (process.env.CP_TESTMELDING === '1') {
    console.log('[meldingen] CP_TESTMELDING=1 -> testmelding bij het starten');
    toon({ type: 'kanaal', titel: 'CoinPower test',
           body: 'Testmelding bij het starten (CP_TESTMELDING=1).', url: '/?nav=chat' });
  } else {
    console.log('[meldingen] CP_TESTMELDING niet op 1 -> geen testmelding bij het starten');
  }
  setInterval(haalMeldingen, OPHAAL_MS);
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
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'persistent-storage') return callback(true);
    callback(true);
  });
  maakMenu();
  maakVenster();
  startMeldingen();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) maakVenster();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
