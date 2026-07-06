/**
 * ShipWall Web — logique front-end
 * ------------------------------------------------------------
 * Même principe que FlightWall (app.js), mais pour les bateaux
 * via AISStream.io. Le serveur (server.js) maintient la connexion
 * WebSocket vers AISStream et expose /api/ships en REST classique,
 * que cette page interroge périodiquement.
 * ------------------------------------------------------------
 */

const state = {
  ships: [],
  currentIndex: 0
};

const el = {
  emptyMsg: document.getElementById('emptyMsg'),
  status: document.getElementById('status'),
  lastUpdate: document.getElementById('lastUpdate'),
  centerInfo: document.getElementById('centerInfo'),
  radiusInfo: document.getElementById('radiusInfo'),
  shipName: document.getElementById('shipName'),
  destination: document.getElementById('destination'),
  sog: document.getElementById('sog'),
  cog: document.getElementById('cog'),
  heading: document.getElementById('heading'),
  navStatus: document.getElementById('navStatus'),
  shipMeta: document.getElementById('shipMeta'),
  dots: document.getElementById('dots'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
};

function setStatus(text, type) {
  el.status.textContent = text;
  el.status.className = 'status' + (type ? ' ' + type : '');
}

// Table simplifiée des codes de statut de navigation AIS les plus courants
const NAV_STATUS_LABELS = {
  0: 'En route',
  1: 'Au mouillage',
  2: 'Non manœuvrable',
  3: 'Manœuvrabilité réduite',
  4: 'Contraint par tirant d\u2019eau',
  5: 'Amarré',
  6: 'Échoué',
  7: 'Pêche',
  8: 'À la voile',
  15: 'Inconnu'
};

// ---------- Géométrie (identique à app.js) ----------
function boundingBox(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111;
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

// ---------- Récupération des bateaux (via le serveur local) ----------
async function fetchShips() {
  const bbox = boundingBox(CONFIG.CENTER_LAT, CONFIG.CENTER_LON, CONFIG.SHIP_RADIUS_KM);

  const params = new URLSearchParams({
    lamin: bbox.lamin, lomin: bbox.lomin,
    lamax: bbox.lamax, lomax: bbox.lomax,
    staleAfterMs: CONFIG.SHIP_STALE_AFTER_MS
  });

  const res = await fetch(`/api/ships?${params}`);

  if (!res.ok) {
    throw new Error(`AISStream échoué (${res.status}). Vérifie server-config.js et que node server.js tourne bien.`);
  }

  const data = await res.json();

  if (data.disabled) {
    throw new Error('AISStream désactivé : ajoute AISSTREAM_API_KEY dans server-config.js');
  }

  return (data.ships || [])
    .filter(s => haversineKm(CONFIG.CENTER_LAT, CONFIG.CENTER_LON, s.lat, s.lon) <= CONFIG.SHIP_RADIUS_KM)
    .slice(0, CONFIG.MAX_SHIPS_DISPLAYED);
}

// ---------- Navigation ----------
function clampIndex() {
  if (state.ships.length === 0) {
    state.currentIndex = 0;
  } else if (state.currentIndex >= state.ships.length) {
    state.currentIndex = state.ships.length - 1;
  } else if (state.currentIndex < 0) {
    state.currentIndex = 0;
  }
}

function goPrev() {
  if (state.ships.length === 0) return;
  state.currentIndex = (state.currentIndex - 1 + state.ships.length) % state.ships.length;
  renderCurrent();
}

function goNext() {
  if (state.ships.length === 0) return;
  state.currentIndex = (state.currentIndex + 1) % state.ships.length;
  renderCurrent();
}

// ---------- Rendu ----------
function renderCurrent() {
  clampIndex();

  if (state.ships.length === 0) {
    el.emptyMsg.style.display = 'block';
    el.emptyMsg.textContent = 'Aucun bateau détecté dans la zone.';
    el.shipName.textContent = '—';
    el.destination.textContent = '—';
    el.sog.textContent = '—';
    el.cog.textContent = '—';
    el.heading.textContent = '—';
    el.navStatus.textContent = '—';
    el.shipMeta.textContent = '';
    el.dots.innerHTML = '';
    el.prevBtn.classList.add('hidden');
    el.nextBtn.classList.add('hidden');
    return;
  }

  el.emptyMsg.style.display = 'none';

  const s = state.ships[state.currentIndex];

  const speedKmh = s.sog != null ? Math.round(s.sog * 1.852) : null; // nœuds -> km/h
  const cog = s.cog != null ? Math.round(s.cog) : null;
  const heading = s.heading != null && s.heading !== 511 ? Math.round(s.heading) : null; // 511 = non disponible en AIS
  const statusLabel = NAV_STATUS_LABELS[s.navStatus] ?? (s.navStatus != null ? `Code ${s.navStatus}` : '—');

  el.shipName.textContent = s.name || `MMSI ${s.mmsi}`;
  el.destination.textContent = s.destination ? `→ ${s.destination}` : '';
  el.sog.textContent = speedKmh != null ? `${speedKmh} km/h` : '—';
  el.cog.textContent = cog != null ? `${cog}°` : '—';
  el.heading.textContent = heading != null ? `${heading}°` : '—';
  el.navStatus.textContent = statusLabel;
  el.shipMeta.textContent = `MMSI ${s.mmsi}`;

  el.dots.innerHTML = '';
  state.ships.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i === state.currentIndex ? ' active' : '');
    el.dots.appendChild(dot);
  });

  const showNav = state.ships.length > 1;
  el.prevBtn.classList.toggle('hidden', !showNav);
  el.nextBtn.classList.toggle('hidden', !showNav);
}

// ---------- Boucle principale ----------
async function refresh() {
  try {
    setStatus('Mise à jour…');
    const ships = await fetchShips();

    const currentMmsi = state.ships[state.currentIndex]?.mmsi;
    state.ships = ships;
    if (currentMmsi != null) {
      const sameIndex = ships.findIndex(s => s.mmsi === currentMmsi);
      state.currentIndex = sameIndex >= 0 ? sameIndex : 0;
    }

    renderCurrent();
    el.lastUpdate.textContent = `Mis à jour ${new Date().toLocaleTimeString()}`;
    setStatus(`${ships.length} bateau(x) trouvé(s)`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Erreur inconnue', 'error');
  }
}

function init() {
  el.centerInfo.textContent = `${CONFIG.CENTER_LAT.toFixed(3)}, ${CONFIG.CENTER_LON.toFixed(3)}`;
  el.radiusInfo.textContent = CONFIG.SHIP_RADIUS_KM;
  el.prevBtn.addEventListener('click', goPrev);
  el.nextBtn.addEventListener('click', goNext);
  refresh();
  setInterval(refresh, CONFIG.REFRESH_INTERVAL_MS);
}

init();
