/**
 * Petit serveur local (aucune dépendance npm requise, Node >= 18).
 * - Sert les fichiers statiques (index.html, style.css, config.js, app.js)
 * - Relaie les appels vers OpenSky et FlightAware AeroAPI
 *   -> plus de problème CORS / NetworkError depuis le navigateur
 *   -> les clés API restent côté serveur, jamais exposées
 *
 * Lancement :  node server.js
 * Puis ouvrir : http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const keys = require('./server-config.js');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json'
};

// ---- Cache du token OpenSky (évite de ré-authentifier à chaque requête) ----
let openSkyToken = null;
let tokenExpiry = 0;

async function getOpenSkyToken() {
  if (openSkyToken && Date.now() < tokenExpiry) return openSkyToken;

  const res = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: keys.OPENSKY_CLIENT_ID,
      client_secret: keys.OPENSKY_CLIENT_SECRET
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth OpenSky échouée (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  openSkyToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 30) * 1000;
  return openSkyToken;
}

// ---- AISStream.io : connexion WebSocket persistante + cache des bateaux ----
// Contrairement à OpenSky (REST, on interroge à la demande), AISStream
// pousse les données en continu. Le serveur garde donc une connexion
// ouverte et stocke les dernières infos connues de chaque bateau (par MMSI).
// Le navigateur, lui, continue de simplement faire des GET périodiques sur
// /api/ships, comme pour /api/states.
const ships = new Map(); // mmsi -> { mmsi, name, lat, lon, sog, cog, heading, navStatus, destination, shipType, lastUpdate }
let aisSocket = null;
let aisBBoxKey = null;

function connectAisStream(bbox) {
  const key = `${bbox.lamin.toFixed(2)},${bbox.lomin.toFixed(2)},${bbox.lamax.toFixed(2)},${bbox.lomax.toFixed(2)}`;
  if (aisBBoxKey === key && aisSocket && aisSocket.readyState <= 1) return; // déjà connecté sur cette zone

  if (aisSocket) {
    try { aisSocket.close(); } catch (_) {}
  }
  aisBBoxKey = key;

  if (!keys.AISSTREAM_API_KEY || keys.AISSTREAM_API_KEY.trim() === '') {
    aisSocket = null;
    return; // AISStream désactivée (pas de clé) : on ne se connecte pas
  }

  const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
  aisSocket = socket;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      APIKey: keys.AISSTREAM_API_KEY,
      BoundingBoxes: [[[bbox.lamin, bbox.lomin], [bbox.lamax, bbox.lomax]]]
    }));
    console.log('AISStream connecté pour la zone', key);
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleAisMessage(data);
    } catch (err) {
      console.warn('Message AISStream illisible:', err.message);
    }
  });

  socket.addEventListener('error', (event) => {
    console.warn('Erreur AISStream:', event.message || event);
  });

  socket.addEventListener('close', () => {
    // Reconnexion automatique après une courte pause, sauf si on a changé de zone entre-temps
    if (aisSocket === socket) {
      aisSocket = null;
      setTimeout(() => connectAisStream(bbox), 5000);
    }
  });
}

function handleAisMessage(data) {
  const meta = data.MetaData;
  if (!meta || meta.MMSI == null) return;

  const mmsi = meta.MMSI;
  const existing = ships.get(mmsi) || { mmsi };

  existing.name = (meta.ShipName || existing.name || '').trim() || null;
  existing.lat = meta.latitude ?? existing.lat;
  existing.lon = meta.longitude ?? existing.lon;
  existing.lastUpdate = Date.now();

  if (data.MessageType === 'PositionReport' && data.Message?.PositionReport) {
    const pr = data.Message.PositionReport;
    existing.sog = pr.Sog;
    existing.cog = pr.Cog;
    existing.heading = pr.TrueHeading;
    existing.navStatus = pr.NavigationalStatus;
  } else if (data.MessageType === 'ShipStaticData' && data.Message?.ShipStaticData) {
    const sd = data.Message.ShipStaticData;
    if (sd.Destination) existing.destination = sd.Destination.trim();
    if (sd.Type != null) existing.shipType = sd.Type;
  }

  ships.set(mmsi, existing);
}

async function handleShips(query, res) {
  try {
    const bbox = {
      lamin: parseFloat(query.lamin), lomin: parseFloat(query.lomin),
      lamax: parseFloat(query.lamax), lomax: parseFloat(query.lomax)
    };
    connectAisStream(bbox);

    // On retire les bateaux dont on n'a plus de nouvelles depuis trop longtemps
    const staleAfter = parseInt(query.staleAfterMs, 10) || 10 * 60 * 1000;
    const now = Date.now();
    for (const [mmsi, ship] of ships) {
      if (now - ship.lastUpdate > staleAfter) ships.delete(mmsi);
    }

    const list = Array.from(ships.values()).filter(s => s.lat != null && s.lon != null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ships: list,
      disabled: !keys.AISSTREAM_API_KEY || keys.AISSTREAM_API_KEY.trim() === ''
    }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ---- Handlers API ----
async function handleStates(query, res) {
  try {
    const token = await getOpenSkyToken();
    const params = new URLSearchParams({
      lamin: query.lamin, lomin: query.lomin,
      lamax: query.lamax, lomax: query.lomax
    });
    const r = await fetch(`https://opensky-network.org/api/states/all?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleAeroApi(callsign, res) {
  // AeroAPI est optionnelle : si aucune clé n'est configurée, on répond
  // immédiatement sans appeler FlightAware (évite un appel inutile qui échouerait).
  if (!keys.AEROAPI_KEY || keys.AEROAPI_KEY.trim() === '') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ flights: [], disabled: true }));
    return;
  }

  try {
    const r = await fetch(`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(callsign)}`, {
      headers: { 'x-apikey': keys.AEROAPI_KEY }
    });
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ---- Fichiers statiques ----
function serveStatic(urlPath, res) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.join(ROOT, filePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---- Serveur ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/states') {
    return handleStates(Object.fromEntries(url.searchParams), res);
  }

  if (url.pathname.startsWith('/api/aeroapi/')) {
    const callsign = url.pathname.replace('/api/aeroapi/', '');
    return handleAeroApi(callsign, res);
  }

  if (url.pathname === '/api/ships') {
    return handleShips(Object.fromEntries(url.searchParams), res);
  }

  serveStatic(url.pathname, res);
});

server.listen(PORT, () => {
  console.log(`FlightWall Web démarré : http://localhost:${PORT}`);
});
