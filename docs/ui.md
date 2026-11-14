# Interface (lot 1)

## Branchement du core et de l'espace gérant — un seul endroit
`app/src/main.tsx` crée le core **et** l'espace gérant et les passe à `<App core={core} manager={manager} />`.
L'interface ne dépend que de `CoreApi` (`app/src/core/api.ts`, via `useCore()`) et de `ManagerApi`
(`app/src/manager/api.ts`, via `useManager()`).

| Situation | Core | Espace gérant |
|---|---|---|
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | vrai core + `createHttpTransport` | `createSupabaseManagerApi` (fonctions `bootstrap-status`, `bootstrap-manager`, `device-enroll` + supabase-js REST/RLS, session persistée) |
| sans Supabase | vrai core + serveur simulé (`createMockTransport`) | `createMockManagerApi` branché sur ce serveur (écritures répercutées, état gardé dans localStorage) ; premier lancement par défaut, `?mock=seeded` = compte existant `gerant@demo.fr` / `demo-demo-demo` |
| `?demo=…`, `?sync=…`, `?staff=…` | `createFakeCore()` | mock « seeded », déjà connecté |

Paramètres de démo (fakeCore) : `?demo=enrolled|unlocked`, `?sync=pending|error|stale|rejected|offline`, `?staff=empty`.
Équipiers factices : Gérant `123456`, Équipier `654321` (blocage 5 min après 5 erreurs).

## Écrans (`app/src/features/`)
| Écran | Fichier | Rôle |
|---|---|---|
| Premier lancement | `setup/SetupFlow.tsx` | si `getDevice()` est null. Hors-ligne → « Connectez l’appareil à Internet pour la première configuration ». `needs_bootstrap` → `BootstrapScreen` (4 étapes : vous, compte email + mot de passe ×2 ≥ 12 car. avec force, PIN 6 chiffres ×2, nom de l’appareil deviné « iPad »/« iPhone » + avertissement « inscription fermée définitivement ») → bootstrap → connexion → `device-enroll` → `core.enrollDevice` → `syncNow`. Sinon `ManagerLoginScreen` (email, mot de passe, nom d’appareil). 409 → bascule vers la connexion (email prérempli) ; 429, 422, mauvais mot de passe : messages lisibles |
| Configuration avancée | `enrollment/EnrollScreen.tsx` | ancien enrôlement manuel (identifiant + jeton), lien en bas de la connexion gérant |
| Gestion | `management/ManagementScreen.tsx` | tuile « Gestion » sur l’accueil si l’équipier déverrouillé est `manager`. Exige Internet + session gérant (sinon mot de passe redemandé, aussi si la session expire). Onglets **Équipements** (`EquipmentSection` : ajout nom + type, seuils préremplis frigo ≤ 4 °C / congélateur ≤ −18 °C « à confirmer selon votre PMS », renommer, retirer/remettre en service, seuils min/max/tolérance avec bouton ±), **Équipe** (`StaffSection` : ajout + PIN ×2, changer le PIN, désactiver/réactiver ; impossible de se désactiver soi-même), **Réglages** (`SettingsSection` : nom, verrouillage auto 1–30 min, déconnexion gérant). Confirmation pour chaque action sensible ; `core.syncNow()` après chaque écriture |
| Verrouillage | `lock/LockScreen.tsx` | tuiles équipiers (initiales), pavé PIN, « PIN incorrect », « Bloqué, réessayez dans 4 min 32 s » ; équipe vide → message + « Réessayer » (`syncNow()`), rechargement auto sur `onSyncStatusChange` |
| Aujourd'hui | `today/TodayScreen.tsx` | tuiles des modules (« Bientôt ») + « Test d'enregistrement » |
| Test d'enregistrement | `system-test/SystemTestPanel.tsx` | `addRecord('system_test')`, 20 derniers enregistrements (heure, auteur, statut) |

Enchaînement, en-tête et verrouillage auto : `app/src/ui/AppShell.tsx`, `AppHeader.tsx`, `hooks/useAutoLock.ts`
(`getSettings().auto_lock_minutes`, défaut 5 ; revérifié au retour au premier plan car iOS suspend les minuteries).

## Synchro et PWA (`app/src/ui/`)
- `SyncIndicator.tsx` + `syncState.ts` : vert « Tout est synchronisé », orange « N saisies en attente »,
  rouge si erreur, saisies refusées ou attente > 24 h ; détail + « Synchroniser maintenant » au toucher.
- `pwa/InstallBanner.tsx`, `pwa/InstallGuide.tsx` : bannière si non installée (`display-mode: standalone` / `navigator.standalone`), guide illustré iPhone/iPad.
- `pwa/UpdatePrompt.tsx` : « Nouvelle version disponible – Mettre à jour » (`useRegisterSW`).
- `pwa/OfflineBanner.tsx` : « Hors-ligne – vos saisies sont enregistrées sur l'appareil ».
- `requestPersistentStorage()` appelé au démarrage (résultat visible dans le détail de synchro).

## Composants (`app/src/ui/components/`)
`Button` (≥ 56 px), `Tile`, `Badge`, `Modal` (role=dialog, Échap, focus piégé), `PinPad` (touches ≥ 64 px, haptique, clavier physique), `PinSetup` (nouveau PIN saisi deux fois, refuse 000000/123456…), `TextField` + `Notice`, `Toast` (aria-live).
Les PIN sont hachés dans l’app (`hashPin`, PBKDF2) : seuls `pin_salt`/`pin_hash` sont envoyés.
Thème sombre, contrastes AA, focus jaune visible, zones sûres (`safe-pt/pb/px` dans `ui/theme.css`).

## Tests
`cd app && npx vitest run` — premier lancement (création complète avec vrai core, 409, 429, mauvais mot de passe, hors-ligne, serveur injoignable), configuration avancée, Gestion (accès, session expirée, équipements, seuils, équipe, réglages, répercussion dans la base locale), PIN OK/KO/bloqué, équipe vide, verrouillage auto, synchro, enregistrement test.
