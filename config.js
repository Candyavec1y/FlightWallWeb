/**
 * Réglages non secrets (ceux-ci restent visibles côté navigateur,
 * mais ne posent aucun risque de sécurité).
 *
 * Les clés API secrètes se mettent maintenant dans server-config.js
 * (fichier lu uniquement par server.js, côté serveur).
 */

const CONFIG = {
  // --- Localisation à surveiller ---
  CENTER_LAT: 43.68649,   // nice villa mamours
  CENTER_LON:7.28074,
  RADIUS_KM: 4,

  // --- Divers ---
  REFRESH_INTERVAL_MS: 15000,
  MAX_FLIGHTS_DISPLAYED: 12,
  ENABLE_AEROAPI: true
};
