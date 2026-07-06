/**
 * Réglages non secrets (ceux-ci restent visibles côté navigateur, mais ne posent aucun risque de sécurité).
 */

const CONFIG = {
  // endroit
  CENTER_LAT: 43.68649,   // nice villa mamours
  CENTER_LON:7.28074,
  RADIUS_KM: 4,

  // autres infos
  REFRESH_INTERVAL_MS: 15000,
  MAX_FLIGHTS_DISPLAYED: 12,
  ENABLE_AEROAPI: false,

  // bateaux
  // Réutilise CENTER_LAT / CENTER_LON ci-dessus.
  SHIP_RADIUS_KM: 15,
  MAX_SHIPS_DISPLAYED: 12,
  SHIP_STALE_AFTER_MS: 10 * 60 * 1000 // on retire un bateau si pas de nouvelle position depuis 10 min

};
