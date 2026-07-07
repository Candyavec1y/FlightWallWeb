# FlightWall Web

Adaptation web (front-end + petit serveur local) du projet [TheFlightWall_OSS](https://github.com/AxisNimble/TheFlightWall_OSS) : affiche dans une page web les avions détectés autour d'une position donnée, avec vitesse, altitude, cap, taux de montée/descente, et (optionnel) route et compagnie.

Une seconde page, **ShipWall**, fait la même chose pour les bateaux à proximité, via [AISStream.io](https://aisstream.io).

## Architecture

```
FlightWallWeb/
├── index.html                 page "avions" (FlightWall)
├── ships.html                 page "bateaux" (ShipWall)
├── style.css                  style commun "panneau LED / aéroport"
├── app.js                      logique FlightWall (côté navigateur)
├── ships-app.js                logique ShipWall (côté navigateur)
├── config.js                   réglages non secrets (position, rayons, rafraîchissement)
├── server.js                    serveur local Node.js : sert les pages + relaie les appels API
├── server-config.js            clés API secrètes (à créer, JAMAIS commité)
├── server-config.example.js    modèle de server-config.js (celui-ci est commité)
└── .gitignore
```

Le navigateur ne parle qu'à `http://localhost:3000` (servi par `server.js`), qui va lui-même chercher les données auprès d'OpenSky Network, de FlightAware AeroAPI et d'AISStream.io. Ce découpage évite les blocages CORS et garde les clés API hors du code visible par le navigateur.

AISStream fonctionne différemment des deux autres API : c'est un flux WebSocket continu plutôt qu'une API REST interrogée à la demande. `server.js` garde donc une connexion ouverte vers AISStream en arrière-plan et stocke les dernières positions connues de chaque bateau ; la page ShipWall, elle, continue simplement d'interroger `/api/ships` toutes les quelques secondes, exactement comme FlightWall le fait avec `/api/states`.

## Prérequis

- [Node.js](https://nodejs.org) version 18 ou plus (`node -v` pour vérifier)
- Un compte gratuit [OpenSky Network](https://opensky-network.org)
- (Optionnel) Un compte [FlightAware AeroAPI](https://www.flightaware.com/aeroapi/) pour la route/compagnie des avions
- (Optionnel) Un compte [AISStream.io](https://aisstream.io) pour ShipWall (bateaux)

## Installation

1. **Cloner / télécharger** ce dossier sur ta machine.

2. **Créer le fichier de clés API** à partir du modèle :
   ```bash
   cp server-config.example.js server-config.js
   ```

3. **Récupérer tes clés API :**
   - OpenSky (obligatoire pour FlightWall) : [My OpenSky → onglet "API Client"](https://opensky-network.org/my-opensky/account) → "New client" → copie le `client_id` et le `client_secret`
   - AeroAPI (**optionnel**, pour la route/compagnie des avions) : [Dashboard FlightAware](https://www.flightaware.com/aeroapi/) → "API Keys" → "Create API Key"
   - AISStream (**optionnel**, pour ShipWall) : [aisstream.io](https://aisstream.io) → connecte-toi (GitHub ou autre) → page "API Keys" → génère une clé

4. **Coller les clés** dans `server-config.js` :
   ```js
   module.exports = {
     OPENSKY_CLIENT_ID: "...",
     OPENSKY_CLIENT_SECRET: "...",
     AEROAPI_KEY: "...",       // laisse "" si tu ne veux pas utiliser AeroAPI
     AISSTREAM_API_KEY: "..."  // laisse "" si tu ne veux pas utiliser ShipWall
   };
   ```
   Si `AEROAPI_KEY` est vide, le serveur ne fera aucun appel à FlightAware : seules les données OpenSky (position, vitesse, altitude, cap, taux de montée/descente) seront affichées, sans route ni compagnie.
   Si `AISSTREAM_API_KEY` est vide, le serveur ne se connectera pas à AISStream : la page ShipWall affichera "Aucun bateau détecté".

5. **Régler ta position** dans `config.js` (latitude, longitude, rayons en km) :
   ```js
   const CONFIG = {
     CENTER_LAT: 43.2965,
     CENTER_LON: 5.3698,
     RADIUS_KM: 20,        // rayon pour les avions (FlightWall)
     SHIP_RADIUS_KM: 15,   // rayon pour les bateaux (ShipWall)
     ...
   };
   ```

## Lancer le projet

```bash
node server.js
```

Puis ouvrir **http://localhost:3000** dans ton navigateur pour FlightWall, ou **http://localhost:3000/ships.html** pour ShipWall (les deux pages ont aussi un lien de navigation l'une vers l'autre).

Les pages se rafraîchissent automatiquement toutes les 15 secondes (réglable via `REFRESH_INTERVAL_MS` dans `config.js`).

## Sécurité des clés API

- `server-config.js` contient tes vraies clés et est listé dans `.gitignore` : il ne sera jamais poussé sur Git/GitHub.
- AeroAPI et AISStream sont entièrement optionnelles : laisse `AEROAPI_KEY: ""` et/ou `AISSTREAM_API_KEY: ""` dans `server-config.js` pour les désactiver complètement (le serveur ne fera alors aucun appel réseau vers ces services). Tu peux aussi laisser une clé renseignée mais couper l'affichage en mettant `ENABLE_AEROAPI: false` dans `config.js`.
- Ne partage jamais le contenu de `server-config.js`. Si une clé a été exposée par erreur (ex: commit accidentel poussé sur un repo public), régénère-la immédiatement depuis le compte OpenSky / FlightAware / AISStream correspondant.

## Limites connues

- OpenSky, AeroAPI et AISStream ont des quotas gratuits limités (voir les dashboards respectifs).
- Un avion sans indicatif (`callsign`) ou au sol n'est pas affiché.
- AeroAPI peut ne pas trouver d'informations pour tous les indicatifs (petits vols, aviation générale, etc.) ; dans ce cas seules les données OpenSky s'affichent.
- Un bateau n'apparaît sur ShipWall qu'une fois qu'AISStream a reçu au moins un message de position pour lui dans la zone surveillée ; ça peut prendre quelques secondes à quelques minutes après le démarrage du serveur.
- Le service AISStream fonctionne en bêta sans garantie de disponibilité (voir leur documentation).

## Crédits

Basé sur le concept et les sources de données du projet open source [TheFlightWall_OSS](https://github.com/AxisNimble/TheFlightWall_OSS) par AxisNimble.
Données maritimes fournies par [AISStream.io](https://aisstream.io).
