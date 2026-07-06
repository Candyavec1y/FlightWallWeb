/**
 * FlightWall Web — logique front-end
 * ------------------------------------------------------------
 * 1. Authentification OAuth2 (client_credentials) sur OpenSky
 * 2. Récupération des positions ADS-B dans un rayon donné
 * 3. (optionnel) Enrichissement route/compagnie via AeroAPI
 * 4. Rendu des "tuiles" façon panneau LED
 * ------------------------------------------------------------
 */

const state = {
  openSkyToken: null,
  tokenExpiry: 0,
  aeroApiCache: new Map() // callsign -> infos (pour éviter de spammer l'API)
};

const el = {
  panel: document.getElementById('panel'),
  emptyMsg: document.getElementById('emptyMsg'),
  status: document.getElementById('status'),
  lastUpdate: document.getElementById('lastUpdate'),
  centerInfo: document.getElementById('centerInfo'),
  radiusInfo: document.getElementById('radiusInfo'),
};

function setStatus(text, type) {
  el.status.textContent = text;
  el.status.className = 'status' + (type ? ' ' + type : '');
}

// ---------- Géométrie : calcule une bounding box lat/lon ----------
function boundingBox(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111; // ~111km par degré de latitude
  const lonDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return {
    lamin: lat - latDelta,
    lamax: lat + latDelta,
    lomin: lon - lonDelta,
    lomax: lon + lonDelta
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- OpenSky : récupération des états (via le serveur local) ----------
// Tous les appels passent par server.js, qui garde le token et les clés
// côté serveur. Ça évite tout problème de CORS depuis le navigateur.
async function fetchOpenSkyStates() {
  const bbox = boundingBox(CONFIG.CENTER_LAT, CONFIG.CENTER_LON, CONFIG.RADIUS_KM);

  const params = new URLSearchParams({
    lamin: bbox.lamin, lomin: bbox.lomin,
    lamax: bbox.lamax, lomax: bbox.lomax
  });

  const res = await fetch(`/api/states?${params}`);

  if (!res.ok) {
    throw new Error(`OpenSky states échoué (${res.status}). Vérifie server-config.js et que node server.js tourne bien.`);
  }

  const data = await res.json();
  if (!data.states) return [];

  // Colonnes documentées par l'API OpenSky /states/all
  return data.states
    .map(s => ({
      icao24: s[0],
      callsign: (s[1] || '').trim(),
      lon: s[5],
      lat: s[6],
      baroAltitude: s[7],
      onGround: s[8],
      velocity: s[9],
      track: s[10],
      verticalRate: s[11],
      geoAltitude: s[13]
    }))
    .filter(f => f.callsign && f.lat != null && f.lon != null && !f.onGround)
    .filter(f => haversineKm(CONFIG.CENTER_LAT, CONFIG.CENTER_LON, f.lat, f.lon) <= CONFIG.RADIUS_KM)
    .slice(0, CONFIG.MAX_FLIGHTS_DISPLAYED);
}

// ---------- FlightAware AeroAPI : route / compagnie / avion ----------
async function fetchAeroApiInfo(callsign) {
  if (!CONFIG.ENABLE_AEROAPI) return null;
  if (state.aeroApiCache.has(callsign)) return state.aeroApiCache.get(callsign);

  try {
    const res = await fetch(`/api/aeroapi/${encodeURIComponent(callsign)}`);

    if (!res.ok) throw new Error(`AeroAPI ${res.status}`);

    const data = await res.json();
    const flight = data.flights && data.flights[0];
    if (!flight) {
      state.aeroApiCache.set(callsign, null);
      return null;
    }

    const info = {
      origin: flight.origin?.code_iata || flight.origin?.code || null,
      destination: flight.destination?.code_iata || flight.destination?.code || null,
      operator: flight.operator || null,
      aircraftType: flight.aircraft_type || null
    };
    state.aeroApiCache.set(callsign, info);
    return info;
  } catch (err) {
    console.warn('AeroAPI indisponible pour', callsign, err.message);
    state.aeroApiCache.set(callsign, null);
    return null;
  }
}

// ---------- Rendu ----------
function renderFlights(flights) {
  el.panel.querySelectorAll('.flight-tile').forEach(n => n.remove());

  if (flights.length === 0) {
    el.emptyMsg.style.display = 'block';
    el.emptyMsg.textContent = 'Aucun vol détecté dans la zone.';
    return;
  }
  el.emptyMsg.style.display = 'none';

  for (const f of flights) {
    const tile = document.createElement('div');
    tile.className = 'flight-tile';

    const altitude = f.baroAltitude != null ? Math.round(f.baroAltitude) : '—';
    const speedKmh = f.velocity != null ? Math.round(f.velocity * 3.6) : '—';
    const track = f.track != null ? Math.round(f.track) : '—';
    const vRate = f.verticalRate != null ? Math.round(f.verticalRate) : 0;
    const vArrow = vRate > 1 ? '↑' : vRate < -1 ? '↓' : '→';

    const routeText = f.aero
      ? `${f.aero.origin || '???'} → ${f.aero.destination || '???'}`
      : '';

    tile.innerHTML = `
      <div class="callsign">${f.callsign}</div>
      ${routeText ? `<div class="route">${routeText}</div>` : ''}
      <div class="meta">
        <div><span class="label">Alt:</span> ${altitude} m</div>
        <div><span class="label">Vit:</span> ${speedKmh} km/h</div>
        <div><span class="label">Cap:</span> ${track}°</div>
        <div><span class="label">Vz:</span> ${vArrow} ${Math.abs(vRate)} m/s</div>
      </div>
      ${f.aero?.operator || f.aero?.aircraftType
        ? `<div class="airline">${f.aero.operator || ''} ${f.aero.aircraftType || ''}</div>`
        : ''}
    `;
    el.panel.appendChild(tile);
  }
}

// ---------- Boucle principale ----------
async function refresh() {
  try {
    setStatus('Mise à jour…');
    const flights = await fetchOpenSkyStates();

    // Enrichissement AeroAPI (en parallèle, best-effort)
    if (CONFIG.ENABLE_AEROAPI) {
      await Promise.all(flights.map(async f => {
        f.aero = await fetchAeroApiInfo(f.callsign);
      }));
    }

    renderFlights(flights);
    el.lastUpdate.textContent = `Mis à jour ${new Date().toLocaleTimeString()}`;
    setStatus(`${flights.length} vol(s) trouvé(s)`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Erreur inconnue', 'error');
  }
}

function init() {
  el.centerInfo.textContent = `${CONFIG.CENTER_LAT.toFixed(3)}, ${CONFIG.CENTER_LON.toFixed(3)}`;
  el.radiusInfo.textContent = CONFIG.RADIUS_KM;
  refresh();
  setInterval(refresh, CONFIG.REFRESH_INTERVAL_MS);
}

init();
