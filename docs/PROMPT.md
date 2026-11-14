# Prompt de construction — Application HACCP « maison » pour restauration rapide

> À coller tel quel dans une session Claude Code (de préférence dans un dossier/dépôt Git vide).
> Les valeurs marquées **[À CONFIRMER]** sont à valider avec le gérant ou la DDPP avant mise en production.

---

## 1. Rôle et objectif

Tu es un développeur senior mobile + backend, spécialisé en applications métier critiques et en sécurité alimentaire.
Construis une application HACCP complète, fiable et hors‑ligne pour **un seul établissement de restauration rapide** (1 à 5 utilisateurs, une tablette partagée en cuisine + l'iPhone du gérant).

L'application remplace les classeurs papier du **Plan de Maîtrise Sanitaire (PMS)** : elle guide l'équipe dans ses contrôles quotidiens, enregistre des preuves infalsifiables, alerte en cas d'écart et produit en un clic un dossier présentable lors d'un contrôle sanitaire (DDPP).

Inspire‑toi des meilleures pratiques des leaders du marché, **sans copier leur marque, leur design ni leurs textes** :
- **Octopus HACCP** : modules simples, capteurs automatiques avec alertes SMS/email, calcul du refroidissement rapide, contrôle des huiles, étiquettes DLC.
- **ePackPro** : pack matériel + logiciel, sondes connectées, photo des étiquettes fournisseurs, étiquettes avec allergènes.
- **Traqfood** : grand nombre de modules, multiplateforme iOS/Android/Web.
- **Labelio** : traçabilité par scan, impression DLC rapide.
- **FoodDocs** : génération assistée du plan HACCP, tâches automatiques, traçabilité et rappels produits.
- **Jolt** : checklists très guidées pour petites équipes, sondes sans fil pour éviter les relevés « inventés ».

## 2. Contraintes techniques (imposées)

- **Coût zéro (exigence absolue)** : aucun abonnement, aucun compte Apple Developer, aucun Mac. Uniquement des offres gratuites.
- **App** : **application web installable (PWA)** en **TypeScript + React + Vite** (`vite-plugin-pwa`), installée sur l'écran d'accueil de l'iPhone/iPad via Safari (« Partager → Sur l'écran d'accueil »), et utilisable aussi sur Android et ordinateur. Interface optimisée tablette en paysage, gros boutons utilisables avec des gants, mode sombre, français par défaut (i18n prête).
- **Hébergement gratuit** du front : GitHub Pages, Cloudflare Pages ou Netlify (offre gratuite), HTTPS obligatoire, déploiement automatique depuis GitHub Actions.
- **Hors‑ligne d'abord** : service worker (toute l'app fonctionne sans réseau), base locale **IndexedDB via Dexie**, file d'attente de synchronisation au retour du réseau, résolution de conflits déterministe. Demander le stockage persistant (`navigator.storage.persist()`). Une cuisine sans Wi‑Fi ne doit jamais bloquer un relevé.
- **Backend** : Supabase **offre gratuite, région Union européenne** (PostgreSQL, Auth, Storage pour photos/PDF, Edge Functions, Row Level Security sur toutes les tables). Migrations SQL versionnées dans le dépôt. Respecter les quotas gratuits : photos compressées côté client (WebP, ~200 Ko max), purge des photos selon la durée de conservation, export de sauvegarde régulier. Prévoir une tâche quotidienne qui garde le projet actif (l'offre gratuite met en pause un projet inactif).
- **Limites iOS à respecter** : pas de Web Bluetooth dans Safari → aucune fonction ne doit dépendre du Bluetooth. Notifications push web disponibles sur iOS 16.4+ uniquement si l'app est installée sur l'écran d'accueil : guider l'utilisateur à l'installation.
- **Contexte** : l'activité se fait dans un **camion (food truck)**. La nuit et les jours sans service, il est garé à domicile, branché au secteur, à portée du Wi‑Fi de la maison. En tournée, il n'y a pas forcément de réseau.
- **Matériel (budget serré, choisi pour son intégration fiable)** :
  - **Imprimante d'étiquettes** : **Brother QL‑820NWB**, compatible **AirPrint**. L'app génère l'étiquette en PDF au format exact du rouleau (ex. 62 mm) et lance l'impression iOS (AirPrint, en Wi‑Fi : réseau de la maison, partage de connexion de l'iPhone ou Wi‑Fi Direct de l'imprimante **[À TESTER]**). Impression en noir uniquement via AirPrint. Batterie Brother en option pour l'usage dans le camion. Abstraction `LabelPrinter` pour changer de méthode plus tard. Rouleaux 62 mm avec **adhésif amovible ou étiquettes dissolvables** : le gabarit d'étiquette doit être paramétrable (largeur, longueur, rouleau continu ou prédécoupé).
  - **Sonde à piquer** : V1 = **saisie manuelle** de la valeur lue sur un thermomètre à piquer classique (photo optionnelle de l'afficheur). Prévoir l'abstraction `ProbeDriver` pour une éventuelle sonde connectée plus tard (le Bluetooth n'étant pas accessible depuis Safari, ce ne serait possible que via une sonde Wi‑Fi/cloud). Chaque valeur est marquée « saisie manuelle » ou « mesure sonde ».
  - **Capteurs fixes 24h/24** (frigos, congélateur du camion), **Wi‑Fi et à piles**, sans passerelle :
    - **Frigos** : **Shelly H&T Gen3** (4 piles AA, Wi‑Fi, webhooks HTTP et MQTT locaux, niveau de pile). Configurer ses webhooks pour envoyer directement les mesures en HTTPS vers une Edge Function Supabase. Il n'envoie qu'au changement de valeur : régler un seuil de report fin et prévoir un « battement de cœur » attendu pour l'alerte « capteur muet ».
    - **Congélateur** : capteur Wi‑Fi à piles **avec sonde filaire externe** (le boîtier et les piles restent dehors, seule la sonde entre dans le congélateur), ex. **ThermoWorks NODE (version sonde)** ou **Temp Stick** **[À CONFIRMER : modèle retenu et accès API]**. Intégration par son API cloud (sondage périodique depuis une tâche planifiée Supabase) ou webhooks si disponibles.
    - Abstraction `SensorSource` (un connecteur par marque : Shelly webhook, NODE, Temp Stick…) pour changer de capteur plus tard sans toucher au reste de l'app.
  - Côté serveur : stockage en série temporelle, détection d'écart avec délai de tolérance (ouverture de porte, dégivrage), alerte **pile faible** (niveau de pile fourni par le capteur).
- **Alertes (sans SMS, donc gratuites)** : **notifications push web** (Web Push / VAPID, gratuit) sur l'iPhone du gérant et la tablette, + email en secours. Les capteurs envoient leurs mesures directement par le Wi‑Fi de la maison ; le téléphone reçoit l'alerte partout où il a Internet. Alerte « **capteur muet** » si aucune mesure n'arrive depuis X minutes (coupure de courant, Wi‑Fi tombé, camion parti). Escalade/rappel si l'alerte n'est pas acquittée. En tournée (pas de Wi‑Fi), les relevés manuels sont stockés hors‑ligne puis synchronisés au retour, et les capteurs reprennent leur historique dès que le Wi‑Fi revient.
- **Qualité** : architecture propre (feature‑first, TypeScript strict), tests unitaires (Vitest) sur toute la logique métier (seuils, calculs de DLC, refroidissement), tests d'intégration sur la synchro, CI GitHub Actions (analyse, tests, build).

## 3. Exigences légales et de fiabilité (non négociables)

Cadre : règlement (CE) **852/2004** (hygiène, PMS, principes HACCP), règlement (CE) **178/2002** (traçabilité amont/aval, retrait/rappel), règlement (UE) **1169/2011 « INCO »** + décret 2015‑447 (information allergènes en restauration), arrêté du 21 décembre 2009 (températures), **GBPH restauration**, décret 2008‑184 (huiles de friture), obligation de formation hygiène en restauration commerciale, **RGPD**.

1. **Registre infalsifiable** : un enregistrement validé n'est **jamais modifié ni supprimé**. Une correction crée un nouvel enregistrement lié (« annule et remplace ») avec motif obligatoire. Chaîne de hachage (chaque enregistrement contient le hash du précédent) vérifiable dans l'app.
2. **Horodatage fiable** : heure de l'appareil **et** heure serveur à la synchro ; détection d'horloge incohérente.
3. **Traçabilité de l'auteur** : chaque saisie est signée par un utilisateur identifié (code PIN personnel sur la tablette partagée, verrouillage automatique après inactivité).
4. **Écart = action corrective** : toute valeur hors seuil oblige à choisir une action corrective (jeter, réchauffer, déplacer, appeler le technicien…) avant de pouvoir valider, avec photo optionnelle.
5. **Durée de conservation** des enregistrements paramétrable, défaut 3 ans **[À CONFIRMER dans le PMS]** ; purge automatique au‑delà, journalisée.
6. **RGPD** : registre des traitements, mentions d'information des employés, données minimales (pour l'aptitude médicale : seulement « apte / date de validité », jamais de détail médical), export et suppression des données d'un ex‑salarié, sauvegardes chiffrées, hébergement UE.
7. **Avertissement** affiché : l'application est un outil d'aide à l'application du PMS ; elle ne vaut pas agrément et ne remplace pas la responsabilité de l'exploitant.
8. Tous les seuils sont **paramétrables** par le gérant (le PMS de l'établissement fait foi), avec des valeurs par défaut issues de la réglementation / du GBPH.

## 4. Modules fonctionnels (V1)

### 4.1 Tableau de bord « Aujourd'hui »
- Liste des tâches du jour (relevés, nettoyages, contrôles) avec statut, retards en rouge, score de conformité du jour/semaine.
- Alertes en cours (capteur hors seuil, DLC dépassée aujourd'hui, tâche oubliée).
- Accès en un geste aux actions fréquentes : imprimer une DLC, relever une température, réceptionner une livraison.

### 4.2 Températures et froid
- **Enceintes froides** : liste des frigos/congélateurs/vitrines avec seuils (défauts : froid positif ≤ +3 °C ou ≤ +4 °C selon denrées, négatif ≤ −18 °C) **[À CONFIRMER]** ; relevés manuels planifiés (ex. ouverture + fermeture) **et** courbes des capteurs automatiques.
- **Refroidissement rapide** : chronomètre guidé, de +63 °C à +10 °C à cœur en moins de 2 h ; relevés intermédiaires à la sonde, alerte si l'objectif ne sera pas tenu.
- **Remise en température** : de +3 °C à ≥ +63 °C en moins de 1 h.
- **Maintien au chaud** : ≥ +63 °C, relevés périodiques.
- **Cuisson à cœur** (ex. steaks hachés) avec seuil paramétrable.
- **Décongélation** : suivi début/fin en enceinte froide, DLC après décongélation.

### 4.3 Huiles de friture (spécifique restauration rapide)
- Par friteuse : contrôle du taux de composés polaires (seuil légal 25 %, alerte préventive paramétrable, ex. 22 %), saisie bandelette/testeur, changement d'huile daté, historique.

### 4.4 Réception des marchandises et traçabilité
- Réception guidée par fournisseur : état des emballages, propreté du camion, température à cœur ou de surface (sonde BLE), DLC/DDM, n° de lot.
- **Photo des étiquettes** fournisseur (stockage cloud) + **OCR** pour préremplir lot et DLC, et **scan code‑barres** (GTIN).
- Refus / réserve avec motif et photo.
- **Traçabilité amont → aval** : lot reçu → préparations qui l'utilisent → étiquettes imprimées.
- **Retrait / rappel** : recherche d'un lot ou d'un produit (ex. alerte RappelConso), liste immédiate des préparations concernées, procédure guidée, rapport PDF.

### 4.5 Étiquettes DLC et allergènes
- Catalogue de produits / préparations avec durée de vie secondaire (après ouverture, préparation, décongélation), mode de conservation et **14 allergènes réglementaires**.
- Impression en 2 touches : nom, date/heure de fabrication ou d'ouverture, **DLC calculée**, opérateur, lot, allergènes en gras.
- Vue « produits arrivant à échéance » et enregistrement des pertes (jeté / motif).
- **Fiches recettes** avec ingrédients → calcul automatique des allergènes de chaque plat ; **tableau allergènes** imprimable et affichable pour la clientèle (information écrite obligatoire).

### 4.6 Nettoyage, désinfection et checklists
- Plan de nettoyage : zones, équipements, fréquence, produit, dosage, méthode, fiche de données de sécurité jointe.
- Tâches générées automatiquement selon la fréquence, validation avec photo optionnelle.
- Checklists personnalisables (ouverture, fermeture, hygiène du personnel, lutte contre les nuisibles, contrôle des pièges, passage du dératiseur).

### 4.7 PMS et documents
- **Assistant de rédaction du PMS** : questionnaire sur l'activité → génération d'un PMS structuré (BPH, plan HACCP avec analyse des dangers et CCP, traçabilité, gestion des non‑conformités), modifiable, versionné, exportable en PDF.
- Bibliothèque : agrément/déclaration DDPP, attestations de formation hygiène, contrats (nuisibles, maintenance froid), fiches fournisseurs, analyses de laboratoire, rapports de contrôle — avec **dates d'expiration et rappels**.
- **Export « contrôle sanitaire »** : un PDF horodaté (période au choix) regroupant relevés, écarts + actions correctives, nettoyages, traçabilité, huiles, formations. Export CSV en complément.

### 4.8 Utilisateurs (léger)
- Rôles : **gérant** (tout, paramétrage, exports), **équipier** (saisies uniquement). PIN personnel sur la tablette ; email + mot de passe/biométrie pour le gérant.
- Suivi des formations hygiène et aptitudes (dates de validité uniquement).

## 5. Méthode de travail attendue

1. **Avant d'écrire du code**, propose : l'architecture, le schéma de base de données (tables, RLS, chaîne de hachage), la stratégie hors‑ligne/synchro et le découpage en lots. Attends ma validation.
2. Livre par **lots fonctionnels testables**, dans cet ordre :
   1. Socle : projet PWA React/TypeScript, Supabase (UE), auth + PIN, base locale, synchro, registre infalsifiable, CI.
   2. Températures (manuel + sonde BLE) + actions correctives + tableau de bord.
   3. Réception + traçabilité + photos/OCR/scan.
   4. Étiquettes DLC + imprimante + fiches recettes + allergènes.
   5. Nettoyage + checklists + huiles.
   6. Capteurs Wi‑Fi automatiques + alertes push/email + alerte « capteur muet » + escalade.
   7. PMS, documents, export contrôle sanitaire.
   8. RGPD, sauvegardes, durcissement sécurité, tests, guide d'installation sur l'écran d'accueil de l'iPhone/iPad.
3. À chaque lot : code + tests + migration SQL + déploiement automatique + courte note « comment tester sur l'iPad ».
4. Quand une information manque (modèle de matériel, seuil…), **pose la question** plutôt que de supposer ; ne jamais inventer une valeur réglementaire — la marquer « à confirmer ».
5. Aucune clé ni secret dans le code : variables d'environnement / secrets Supabase.

## 6. Critères d'acceptation globaux

- Un relevé se fait en **moins de 10 secondes**, hors‑ligne compris.
- Aucun enregistrement validé ne peut être modifié ou supprimé, y compris via l'API (vérifié par des tests sur les règles RLS/triggers).
- Une coupure réseau de 48 h ne fait perdre aucune donnée.
- Un écart de température capteur déclenche une alerte en moins de 5 minutes (après le délai de tolérance).
- L'export « contrôle sanitaire » d'un mois est généré en moins de 30 secondes.
- L'application est utilisable par un nouvel équipier sans formation de plus de 15 minutes.
