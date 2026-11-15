# Backend — configurer un capteur (Shelly H&T Gen3, sonde du congélateur)

Lot 6. Les capteurs Wi-Fi envoient leurs mesures directement à l'Edge Function `sensor-ingest` (gratuit, sans passerelle). Le serveur stocke les mesures (`sensor_readings`, conservées `retention_years`) et `alerts-evaluate` déclenche les alertes : hors seuil au-delà de la tolérance, capteur muet, pile faible. Détails techniques : [`backend-logic.md`](backend-logic.md) § sensor-ingest, [`backend-db.md`](backend-db.md) § Lot 6.

> **À vérifier sur l'appareil** : les noms d'écrans et d'événements ci-dessous, et surtout la **substitution `${ev.tC}`** dans l'URL du webhook, dépendent du micrologiciel Shelly. La procédure de test (§ 4) permet de confirmer en deux minutes que la température arrive bien.

## 1. Créer le capteur côté serveur (gérant) et noter son jeton

Chaque capteur a **son propre jeton d'envoi**. Il est affiché **une seule fois** ; seul son SHA-256 est conservé.

- Depuis l'app gérant (quand l'écran existe) : `supabase.rpc('sensor_create', { p_name: 'Frigo 1 — Shelly', p_equipment_id: '<uuid de l’enceinte>', p_vendor: 'shelly_ht' })` → `{ sensor_id, sensor_token }`.
- En secours, depuis l'éditeur SQL de Supabase (on se fait passer pour le gérant, sinon la fonction refuse avec `HACCP: forbidden`) :
  ```sql
  select set_config('request.jwt.claim.sub', (select user_id::text from public.managers limit 1), false);
  select * from public.sensor_create('Frigo 1 — Shelly', (select id from public.equipment where name = 'Frigo 1'), 'shelly_ht');
  ```
- Jeton perdu ou divulgué : `select public.sensor_rotate_token('<sensor_id>');` (même précaution) donne un nouveau jeton ; l'ancien ne marche plus. Il faut alors corriger l'URL dans le capteur.
- `p_vendor` : `shelly_ht`, `thermoworks_node`, `tempstick` ou `generic` (simple information).

L'URL d'envoi (`<ref>` = identifiant du projet Supabase) :
```
https://<ref>.supabase.co/functions/v1/sensor-ingest?token=<JETON>
```

## 2. Installer le Shelly H&T Gen3

1. Piles (4 × AA ; en enceinte froide, préférer des piles **lithium**, qui tiennent mieux le froid) ou **alimentation USB-C** (recommandée si une prise est accessible : l'appareil reste éveillé et émet plus souvent).
2. Ajouter l'appareil au Wi-Fi de la maison avec l'app Shelly Smart Control, **ou** sans compte Shelly : appui long sur le bouton → le capteur ouvre un point d'accès `ShellyHTG3-…` → s'y connecter → `http://192.168.33.1` → *Settings › Wi-Fi* : saisir le Wi-Fi du domicile.
3. Mettre à jour le micrologiciel (*Settings › Firmware*).
4. Noter l'adresse IP du capteur sur le réseau (application Shelly, ou la box).
5. Un capteur sur piles **dort** : pour ouvrir sa page web ou lui envoyer une commande, l'éveiller d'un appui court sur le bouton.

Placement : au milieu de l'enceinte, pas contre la paroi ni près de la porte. **Une enceinte froide est une boîte métallique** qui affaiblit beaucoup le Wi-Fi : vérifier la réception porte fermée (§ 4) avant de compter dessus. La plage de fonctionnement du H&T convient à un réfrigérateur ; pour le **congélateur**, utiliser une sonde déportée (§ 6).

## 3. Créer le webhook dans le Shelly

### Par la page web du capteur
*Actions* (ou *Webhooks*, selon le micrologiciel) › **Create** :
- **Événement** : « Temperature change » (`temperature.change`, émis quand la température varie du seuil réglé dans *Temperature › Report threshold*, par ex. 0,5 °C) ;
- **URL** (méthode GET) :
  ```
  https://<ref>.supabase.co/functions/v1/sensor-ingest?token=<JETON>&tC=${ev.tC}
  ```
  `${ev.tC}` est remplacé par le Shelly par la température de l'événement (« URL tokens » des appareils Gen2/Gen3). **À vérifier** : si le micrologiciel ne fait pas la substitution, le serveur reçoit le texte `${ev.tC}` et répond 400 `invalid_measurement` (voir § 4).
- Enregistrer, puis rester sur la page tant que le capteur est éveillé.

### Ou par l'API locale (capteur éveillé, même réseau)
```bash
curl -s -X POST "http://<ip-du-shelly>/rpc/Webhook.Create" -d '{
  "cid": 0, "enable": true, "name": "haccp", "event": "temperature.change",
  "urls": ["https://<ref>.supabase.co/functions/v1/sensor-ingest?token=<JETON>&tC=${ev.tC}"]
}'
curl -s "http://<ip-du-shelly>/rpc/Webhook.List"     # contrôle
```
(Guillemets simples autour du JSON : le shell ne doit pas interpréter `${ev.tC}`.)

### Pile
L'événement de température ne porte pas le niveau de pile. Si le micrologiciel propose un événement de pile (`devicepower…`) avec substitution, ajouter un second webhook vers la même URL avec `&batt=${ev.battery.percent}` — **à vérifier** sur l'appareil (nom de l'événement et du champ). Sinon `battery_percent` reste inconnu et l'alerte « pile faible » ne se déclenche pas ; l'alerte « capteur muet » reste le filet de sécurité quand les piles sont vides.

### Fréquence d'émission et réglage « capteur muet »
Sur piles, le H&T n'émet qu'au réveil (variation de température au-delà du seuil, plus un réveil périodique — **intervalle à vérifier** dans la documentation de l'appareil). Une enceinte très stable peut donc rester silencieuse longtemps. Régler `settings.sensor_silent_minutes` (Gestion › Réglages ; 15 à 1440 min, défaut 60) **au-dessus** de l'intervalle maximal observé, par ex. 180 min, ou alimenter le capteur en USB-C. Côté serveur, une mesure au plus toutes les 30 s est conservée par capteur (les suivantes reçoivent 429).

## 4. Tester

1. Depuis un ordinateur (simule le capteur) :
   ```bash
   curl -s "https://<ref>.supabase.co/functions/v1/sensor-ingest?token=<JETON>&tC=3.5"
   # {"ok":true,"stored":true,"sensor_id":"…","value_c":3.5,"battery_percent":null}
   ```
2. Puis le vrai capteur : souffler dessus ou le poser dans l'enceinte, l'éveiller d'un appui court ; la dernière valeur et l'heure doivent apparaître dans l'app (ou `select name, last_seen_at, last_value_c, battery_percent from public.sensors;` dans l'éditeur SQL).
3. Journal des appels : Supabase › Edge Functions › `sensor-ingest` › Logs (événements `sensor_reading`, `sensor_auth_failed`).

| Réponse | Cause | Que faire |
|---|---|---|
| 200 `stored: true` | Mesure enregistrée | — |
| 400 `invalid_measurement` | Température absente ou illisible (souvent `${ev.tC}` non substitué) | Vérifier l'URL ; sinon passer par un relais (§ 6) |
| 401 `unauthorized` | Jeton absent, faux ou renouvelé depuis | Recopier le jeton (ou en générer un nouveau) |
| 403 `sensor_inactive` | Capteur désactivé dans Gestion | Le réactiver |
| 422 `out_of_range` | Valeur hors −60..+100 °C (sonde débranchée, erreur) | Vérifier la sonde |
| 429 `rate_limited` | Moins de 30 s depuis la mesure précédente | Normal, rien à faire |

## 5. Seuils et alertes

Le seuil vient de **Gestion › Seuils** de l'enceinte (`temperature_check` ; sinon le seuil générique ; sinon frigo ≤ +4 °C / 20 min, congélateur ≤ −18 °C / 30 min — à confirmer selon le PMS). `tolerance_minutes` = durée hors seuil admise avant l'alerte (une porte ouverte pendant le service ne doit pas déclencher d'alerte). Les mesures du capteur **ne remplacent pas** les relevés des créneaux : l'alerte « relevé en retard » ne tient compte que des relevés `temperature_check` du registre.

## 6. Sonde du congélateur (ThermoWorks NODE, Temp Stick…)

Le H&T n'est pas fait pour l'intérieur d'un congélateur : utiliser un capteur à **sonde filaire** (boîtier à l'extérieur, câble plat sous le joint de porte).
- `sensor-ingest` accepte tout envoi HTTP GET/POST portant la température, par exemple `?token=<JETON>&tC=-19.2`, ou un JSON `{"temp": -19.2, "battery": 80}` (également `temperature`, `value_c`, `tF`…, voir `backend-logic.md`).
- **À vérifier** pour chaque modèle : la capacité à appeler **directement** une URL (webhook) depuis l'appareil ou son service en ligne, et le format envoyé. Plusieurs de ces capteurs passent uniquement par le cloud du fabricant ; il faut alors un relais (Home Assistant, Node-RED, petite tâche planifiée qui lit l'API du fabricant et poste vers `sensor-ingest`), hors du périmètre de ce lot.
- Créer le capteur avec `p_vendor` `thermoworks_node`, `tempstick` ou `generic`, et l'associer à l'équipement « Congélateur ».

## 7. Sécurité

- Le jeton est dans l'URL (les webhooks Shelly n'envoient pas d'en-tête personnalisé ; un appareil qui le peut doit utiliser l'en-tête `x-sensor-token`). Il ne permet **que** d'envoyer des mesures pour ce capteur, n'est jamais journalisé par la fonction, mais peut apparaître dans les journaux d'accès de la plateforme : le renouveler au moindre doute (`sensor_rotate_token`).
- Le gérant ne peut jamais relire un jeton (privilèges de colonne) : en cas de perte, on en génère un nouveau.
- Les mesures sont en **insertion seule** : ni le gérant ni les fonctions ne peuvent les modifier ou les supprimer (seule la purge de fin de conservation le fait).
