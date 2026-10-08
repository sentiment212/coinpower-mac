// preload.js — 30-8-2026
//
// De ENIGE brug tussen de webapp en het hoofdproces. `contextIsolation` blijft
// aan (main.js r16), dus de webapp kan hier niet omheen en krijgt géén Node.
// Via contextBridge geven we exact TWEE dingen door, niet meer:
//
//   1. het inlogtoken naar het hoofdproces, zodat dat de meldingen kan ophalen;
//   2. een luisteraar waarmee het hoofdproces de webapp laat navigeren zonder
//      de pagina te herladen.
//
// Er wordt niets teruggegeven wat de webapp niet al heeft: het token komt uit
// zijn eigen localStorage, en `navigeer` levert alleen een pad aan de webapp.
// Geen ipcRenderer, geen require, geen fs — alleen deze twee functies.

const { contextBridge, ipcRenderer } = require('electron');

// De sleutel waaronder de webapp het token bewaart. Vastgesteld in
// index.html r5614: `this.token = DB.load('auth_token', null)`, en DB.save
// schrijft naar localStorage. Verandert die sleutel, dan valt dit stil —
// niet stuk, want alles hieronder verdraagt `null`.
const TOKEN_SLEUTEL = 'pp_auth_token';

function leesToken() {
  try {
    const ruw = window.localStorage.getItem(TOKEN_SLEUTEL);
    if (!ruw) return null;
    // DB.save slaat op met JSON.stringify, dus een string staat er met
    // aanhalingstekens omheen. Allebei de vormen verdragen.
    try {
      const ontleed = JSON.parse(ruw);
      return typeof ontleed === 'string' ? ontleed : null;
    } catch (_) {
      return ruw;
    }
  } catch (_) {
    // Een browser die localStorage blokkeert: geen token, geen fout.
    return null;
  }
}

// Stuur het token naar het hoofdproces zodra de pagina er is, en daarna elke
// 20 seconden opnieuw. Waarom herhalen: het token verandert bij inloggen en
// uitloggen, en dit script draait maar één keer per pagina-lading. Uitloggen
// stuurt dan `null` en het hoofdproces stopt met ophalen.
function meldToken() {
  ipcRenderer.send('cp:token', leesToken());
}

window.addEventListener('DOMContentLoaded', meldToken);
setInterval(meldToken, 20000);

// Het hoofdproces vraagt de webapp naar een plek te gaan. We herladen NIET:
// de webapp is één pagina met `?nav=`-routering, dus we zetten de zoekstring
// en laten de webapp zelf reageren. `popstate` is wat de webapp al gebruikt
// bij de terugknop van de browser.
ipcRenderer.on('cp:navigeer', (_gebeurtenis, pad) => {
  try {
    if (typeof pad !== 'string' || !pad.startsWith('/')) return;
    window.history.pushState({}, '', pad);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch (e) {
    // Lukt het niet, dan is een gewone navigatie het vangnet.
    try { window.location.href = pad; } catch (_) { /* opgeven, niet crashen */ }
  }
});

// Wat de webapp van ons mag zien: niets. Deze brug is eenrichtingsverkeer van
// preload naar hoofdproces en terug; de pagina hoeft er niet bij. We zetten
// alleen een leesbare markering neer zodat de webapp desgewenst weet dat hij
// in de Mac-app draait — dat wist hij al via de User-Agent (main.js r23).
contextBridge.exposeInMainWorld('coinpowerMac', { versie: 1 });
