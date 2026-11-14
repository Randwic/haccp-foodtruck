# Core hors-ligne et synchronisation

Code : `app/src/core/` — point d'entrée `index.ts`, interface figée `api.ts`.

```ts
import { createCore, createHttpTransport, createMockTransport, notifyActivity } from './core'
const core = createCore({ transport: createHttpTransport({ baseUrl, anonKey }) })
// développement sans Supabase : createCore({ transport: createMockTransport({ latencyMs: 300 }) })
// puis core.enrollDevice({ ...DEMO_DEVICE, name: 'iPad' }) ; PIN Gérant 123456, Équipier 654321
```

## Fonctionnement

- **Base locale Dexie** (`db.ts`) : `device` (id, jeton, nom), `records` (enregistrements
  exactement tels que hachés), `record_sync` (état `pending` / `accepted` / `rejected` + raison,
  `server_time`, `clock_suspect`), `chain` (dernier `device_seq` et dernier hash par appareil),
  `staff`, `equipment`, `thresholds`, `pin_attempts`, `meta` (since, settings, établissement,
  dernière erreur…).
- **`addRecord`** : session déverrouillée obligatoire. Une seule transaction Dexie lit la tête de
  chaîne, construit l'enregistrement (`randomUUID`, `device_time`, `prev_hash` ou `GENESIS_HASH`),
  calcule `computeRecordHash` (gardé dans la transaction par `Dexie.waitFor`) et l'écrit en
  `pending`. IndexedDB sérialise les transactions : deux saisies simultanées (même dans deux
  onglets) ne peuvent pas obtenir le même `device_seq` ; un index unique `[device_id+device_seq]`
  sert de filet. Le payload est normalisé (JSON canonique) : `Date`, `undefined`, `NaN` sont refusés.
- **Synchro** (une seule à la fois) : push des `pending` par lots de 200 triés par `device_seq`,
  puis pull incrémental (`since` = `server_now` du pull précédent, `deleted` appliqué). Déclencheurs :
  après chaque saisie, `online`, retour au premier plan, toutes les 60 s, et `syncNow()`.
  Backoff après échec : 5 s, 10 s, 20 s… plafonné à 5 min (les saisies et la minuterie le
  respectent ; `online`, premier plan et `syncNow` le court-circuitent).
- **401 / 403 / `device_revoked`** : synchro arrêtée, `last_error` commence par `device_revoked`.
  Seul un nouvel `enrollDevice` la relance.
- **PIN** : PBKDF2-SHA256 (WebCrypto, 210 000 itérations, clé 32 octets) vérifié hors-ligne,
  comparaison à temps constant. 5 échecs pour un équipier → verrouillé 5 min (persisté en base).
  `hashPin(pin)` produit `{ pin_salt, pin_hash }` pour l'écran gérant.
- **Auto-lock** après `settings.auto_lock_minutes` sans activité (5 min tant que les settings ne
  sont pas reçus). L'interface appelle `notifyActivity()` à chaque interaction.
- **`enrollDevice`** : stocke l'appareil puis fait un sync-pull. Jeton refusé → erreur
  `enroll_unauthorized`, rien n'est conservé. Pas de réseau → l'appareil reste enrôlé, les
  références arrivent à la synchro suivante (la liste des équipiers est vide d'ici là).

## Garanties

- Aucune fonction de modification ni de suppression d'un enregistrement. Une correction est
  `addRecord('correction', { motif… }, { supersedes_id })`. Des hooks Dexie font échouer tout
  `put`/`update`/`delete` sur la table `records`, même par erreur de code.
- Rien n'est jamais supprimé localement par la synchro : un enregistrement refusé reste visible
  et compté dans `rejected_count`.
- Envoi idempotent : si la réponse se perd, le renvoi du même `id` + même hash est accepté par le
  serveur sans doublon.
- `verifyChain()` revérifie localement toute la chaîne (suite des numéros, `prev_hash`, hash).
- Staff / équipements désactivés (`deleted`) sont gardés en local mais marqués inactifs (pour
  afficher le nom de l'auteur des anciens relevés). Les seuils supprimés sont retirés. Si
  l'équipier connecté est désactivé, sa session est fermée.

## Limites

- **Safari peut effacer les données d'un site non installé** et peu utilisé (environ 7 jours
  sans visite). Il faut installer l'app sur l'écran d'accueil et appeler
  `requestPersistentStorage()`. Tant que des saisies sont `pending`, elles n'existent que sur
  l'appareil. L'interface doit alerter si `oldest_pending_at` date de plus de 24 h.
- Pas de Background Sync sur iOS : la synchro n'a lieu que lorsque l'app est ouverte.
- L'heure d'une saisie est celle de l'appareil. Le serveur pose `server_time` et `clock_suspect`.
  Chaque `SyncPushRequest` porte `device_now` (horloge de l'appareil à l'envoi) : le serveur marque le lot
  `clock_suspect` seulement si |heure serveur − `device_now`| > `settings.clock_suspect_minutes`, pour ne pas
  signaler à tort une saisie faite hors réseau et envoyée plus tard (serveur simulé : repli sur `device_time`
  si `device_now` est absent).
- Le verrouillage PIN protège contre un essai à la main, pas contre quelqu'un qui lirait
  IndexedDB : un PIN à 4–6 chiffres haché reste attaquable hors-ligne. L'enjeu est la
  traçabilité de l'auteur, pas le secret.
- Après un ré-enrôlement avec un **nouveau** `device_id`, les saisies encore en attente de
  l'ancien appareil restent `pending` (elles ne peuvent pas être signées par le nouveau jeton).
  Elles restent comptées et visibles.
- Si le serveur refuse un maillon pour une raison d'intégrité (`invalid_hash`, `seq_gap`,
  `broken_chain`), les saisies suivantes sont refusées en `seq_gap`. C'est voulu : cela indique
  une anomalie à examiner.

## Hypothèse à valider avec le backend

Le serveur simulé fait **avancer la chaîne** pour un refus de contenu (`unknown_author`,
`unknown_type`, `invalid_payload`) quand le maillon est intègre. Il garde ce maillon en
quarantaine. Sans cela, un seul refus (par exemple un équipier désactivé pendant que le camion
était hors réseau) bloquerait l'appareil pour toujours.
