# Interface (lot 1)

## Branchement du core — un seul endroit
`app/src/main.tsx` crée le core et le passe à `<App core={core} />`.
Aujourd'hui : `createFakeCore()` (`app/src/ui/fakeCore.ts`, en mémoire, démo/tests).
Pour le vrai core : remplacer `createDemoCore()` par l'implémentation de `app/src/core/index.ts`,
et brancher `setActivityNotifier(notifyActivity)` (signal d'activité, `app/src/ui/activity.ts`).
L'interface ne dépend que de `CoreApi` (`app/src/core/api.ts`), lu via `useCore()` (`app/src/ui/CoreContext.tsx`).

Paramètres de démo (fakeCore) : `?demo=enrolled|unlocked`, `?sync=pending|error|stale|rejected|offline`, `?staff=empty`.
Équipiers factices : Gérant `123456`, Équipier `654321` (blocage 5 min après 5 erreurs).

## Écrans (`app/src/features/`)
| Écran | Fichier | Rôle |
|---|---|---|
| Enrôlement | `enrollment/EnrollScreen.tsx` | si `getDevice()` est null : nom, identifiant (UUID), jeton ; erreurs par champ + erreur du core |
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
`Button` (≥ 56 px), `Tile`, `Badge`, `Modal` (role=dialog, Échap, focus piégé), `PinPad` (touches ≥ 64 px, haptique, clavier physique), `Toast` (aria-live).
Thème sombre, contrastes AA, focus jaune visible, zones sûres (`safe-pt/pb/px` dans `ui/theme.css`).

## Tests
`cd app && npx vitest run` — enrôlement, PIN OK/KO/bloqué, équipe vide, verrouillage auto, 3 états de synchro, enregistrement test.
