# FlightWall Web

Adaptation web (front-end + petit serveur local) du projet [TheFlightWall_OSS](https://github.com/AxisNimble/TheFlightWall_OSS) : affiche dans une page web les avions détectés autour d'une position donnée, avec vitesse, altitude, cap, taux de montée/descente, et (optionnel) route et compagnie.

## Architecture

```
FlightWallWeb/
├── index.html               page affichée dans le navigateur
├── style.css                style "panneau LED"
├── app.js                   logique de récupération / affichage (côté navigateur)
├── config.js                réglages non secrets (position, rayon, rafraîchissement)
├── server.js                serveur local Node.js : sert la page + relaie les appels API
├── server-config.js         clés API secrètes (à créer, JAMAIS commité)
├── server-config.example.js modèle de server-config.js (celui-ci est commité)
└── .gitignore
```

Le navigateur ne parle qu'à `http://localhost:3000` (servi par `server.js`), qui va lui-même chercher les données auprès d'OpenSky Network et de FlightAware AeroAPI. Ce découpage évite les blocages CORS et garde les clés API hors du code visible par le navigateur.

## Prérequis

- [Node.js](https://nodejs.org) version 18 ou plus (`node -v` pour vérifier)
- Un compte gratuit [OpenSky Network](https://opensky-network.org)
- (Optionnel) Un compte [FlightAware AeroAPI](https://www.flightaware.com/aeroapi/) pour la route/compagnie

## Installation

1. **Cloner / télécharger** ce dossier sur ta machine.

2. **Créer le fichier de clés API** à partir du modèle :
   ```bash
   cp server-config.example.js server-config.js
   ```

3. **Récupérer tes clés API :**
   - OpenSky : [My OpenSky → onglet "API Client"](https://opensky-network.org/my-opensky/account) → "New client" → copie le `client_id` et le `client_secret`
   - AeroAPI : [Dashboard FlightAware](https://www.flightaware.com/aeroapi/) → "API Keys" → "Create API Key"

4. **Coller les clés** dans `server-config.js` :
   ```js
   module.exports = {
     OPENSKY_CLIENT_ID: "...",
     OPENSKY_CLIENT_SECRET: "...",
     AEROAPI_KEY: "..."
   };
   ```

5. **Régler ta position** dans `config.js` (latitude, longitude, rayon en km) :
   ```js
   const CONFIG = {
     CENTER_LAT: 43.2965,
     CENTER_LON: 5.3698,
     RADIUS_KM: 20,
     ...
   };
   ```

## Lancer le projet

```bash
node server.js
```

Puis ouvrir **http://localhost:3000** dans ton navigateur.

La page se rafraîchit automatiquement toutes les 15 secondes (réglable via `REFRESH_INTERVAL_MS` dans `config.js`).

## Sécurité des clés API

- `server-config.js` contient tes vraies clés et est listé dans `.gitignore` : il ne sera jamais poussé sur Git/GitHub.
- Si tu veux désactiver AeroAPI (données de route/compagnie), passe `ENABLE_AEROAPI: false` dans `config.js` — seul OpenSky sera utilisé.
- Ne partage jamais le contenu de `server-config.js`. Si une clé a été exposée par erreur (ex: commit accidentel poussé sur un repo public), régénère-la immédiatement depuis le compte OpenSky / FlightAware correspondant.

## Limites connues

- OpenSky et AeroAPI ont des quotas gratuits limités (voir les dashboards respectifs).
- Un avion sans indicatif (`callsign`) ou au sol n'est pas affiché.
- AeroAPI peut ne pas trouver d'informations pour tous les indicatifs (petits vols, aviation générale, etc.) ; dans ce cas seules les données OpenSky s'affichent.

## Crédits

Basé sur le concept et les sources de données du projet open source [TheFlightWall_OSS](https://github.com/AxisNimble/TheFlightWall_OSS) par AxisNimble.
