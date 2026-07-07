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
  aeroApiCache: new Map(), // callsign -> infos (pour éviter de spammer l'API)
  flights: [],
  currentIndex: 0
};

const el = {
  board: document.getElementById('board'),
  emptyMsg: document.getElementById('emptyMsg'),
  status: document.getElementById('status'),
  lastUpdate: document.getElementById('lastUpdate'),
  centerInfo: document.getElementById('centerInfo'),
  radiusInfo: document.getElementById('radiusInfo'),
  callsign: document.getElementById('callsign'),
  route: document.getElementById('route'),
  alt: document.getElementById('alt'),
  spd: document.getElementById('spd'),
  trk: document.getElementById('trk'),
  vz: document.getElementById('vz'),
  airline: document.getElementById('airline'),
  dots: document.getElementById('dots'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
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

// ---------- Navigation entre vols ----------
function clampIndex() {
  if (state.flights.length === 0) {
    state.currentIndex = 0;
  } else if (state.currentIndex >= state.flights.length) {
    state.currentIndex = state.flights.length - 1;
  } else if (state.currentIndex < 0) {
    state.currentIndex = 0;
  }
}

function goPrev() {
  if (state.flights.length === 0) return;
  state.currentIndex = (state.currentIndex - 1 + state.flights.length) % state.flights.length;
  renderCurrent();
}

function goNext() {
  if (state.flights.length === 0) return;
  state.currentIndex = (state.currentIndex + 1) % state.flights.length;
  renderCurrent();
}

// ---------- Rendu ----------
function renderCurrent() {
  clampIndex();

  if (state.flights.length === 0) {
    el.emptyMsg.style.display = 'block';
    el.emptyMsg.textContent = 'Aucun vol détecté dans la zone.';
    el.callsign.textContent = '—';
    el.route.textContent = '—';
    el.alt.textContent = '—';
    el.spd.textContent = '—';
    el.trk.textContent = '—';
    el.vz.textContent = '—';
    el.airline.textContent = '';
    el.dots.innerHTML = '';
    el.prevBtn.classList.add('hidden');
    el.nextBtn.classList.add('hidden');
    return;
  }

  el.emptyMsg.style.display = 'none';

  const f = state.flights[state.currentIndex];

  const altitude = f.baroAltitude != null ? Math.round(f.baroAltitude) : '—';
  const speedKmh = f.velocity != null ? Math.round(f.velocity * 3.6) : '—';
  const track = f.track != null ? Math.round(f.track) : '—';
  const vRate = f.verticalRate != null ? Math.round(f.verticalRate) : 0;
  const vArrow = vRate > 1 ? '↑' : vRate < -1 ? '↓' : '→';

  el.callsign.textContent = f.callsign;
  el.route.textContent = f.aero
    ? `${f.aero.origin || '???'} → ${f.aero.destination || '???'}`
    : '';
  el.alt.textContent = `${altitude} m`;
  el.spd.textContent = `${speedKmh} km/h`;
  el.trk.textContent = `${track}°`;
  el.vz.textContent = `${vArrow} ${Math.abs(vRate)} m/s`;
  el.airline.textContent = f.aero?.operator || f.aero?.aircraftType
    ? `${f.aero.operator || ''} ${f.aero.aircraftType || ''}`.trim()
    : '';

  // Points de navigation
  el.dots.innerHTML = '';
  state.flights.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i === state.currentIndex ? ' active' : '');
    el.dots.appendChild(dot);
  });

  // Flèches masquées s'il n'y a qu'un seul vol
  const showNav = state.flights.length > 1;
  el.prevBtn.classList.toggle('hidden', !showNav);
  el.nextBtn.classList.toggle('hidden', !showNav);
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

    // On essaie de garder le même vol affiché s'il est toujours présent,
    // pour éviter que l'écran ne "saute" à chaque rafraîchissement.
    const currentCallsign = state.flights[state.currentIndex]?.callsign;
    state.flights = flights;
    if (currentCallsign) {
      const sameIndex = flights.findIndex(f => f.callsign === currentCallsign);
      state.currentIndex = sameIndex >= 0 ? sameIndex : 0;
    }

    renderCurrent();
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
  el.prevBtn.addEventListener('click', goPrev);
  el.nextBtn.addEventListener('click', goNext);
  refresh();
  setInterval(refresh, CONFIG.REFRESH_INTERVAL_MS);
}

init();
