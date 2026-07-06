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

  serveStatic(url.pathname, res);
});

server.listen(PORT, () => {
  console.log(`FlightWall Web démarré : http://localhost:${PORT}`);
});
