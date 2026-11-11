# Revue critique — novembre 2026

Revue du dépôt à l'état `bb7d618`, branche de travail `improve/robustesse-revue`.

## Verdict

Le code est de bonne facture : services séparés des routes, erreurs typées, verrou par projet posé avant tout `await`, journal `ai_calls` qui ne bloque jamais un texte payé, règles PocketBase strictes sur les champs protégés, 177 tests dont des tests d'intégration contre un vrai PocketBase et un vrai `SIGKILL`. La documentation de validation (`docs/VALIDATION.md`) est honnête sur ce qui n'est pas prouvé.

Les défauts trouvés sont surtout des **cas de bord d'exploitation** (pannes, arrêts, concurrence) et de l'**hygiène de dépôt**. Le risque majeur du projet reste celui déjà identifié : le pipeline n'a jamais tourné sur la vraie API OpenRouter.

## Problèmes relevés

Gravité : 🔴 bug réel · 🟠 risque · 🟡 hygiène

| # | Gravité | Problème | Conséquence |
|---|---|---|---|
| 1 | 🔴 | `JobsService.sweep()` appelle `restoreOrphans()` **sans filtre de projet** quand il nettoie un job orphelin | Le nettoyage d'un seul job remet à zéro les brouillons et les scènes `GENERATING` de **tous** les projets, y compris ceux dont un job tourne encore : le texte en streaming disparaît de l'écran et la scène repasse en `PENDING` alors qu'elle s'écrit |
| 2 | 🟠 | `SIGTERM`/`SIGINT` ferment Fastify sans s'occuper des jobs en cours | Un redéploiement laisse les jobs en `RUNNING` jusqu'au redémarrage suivant ; l'auteur voit « Serveur redémarré » au lieu d'un arrêt propre, et le texte partiel n'est pas restauré tant que le serveur n'est pas revenu |
| 3 | 🟠 | `authenticate` transforme **toute** erreur de PocketBase en `401 Session expirée` | Une panne ou une lenteur de PocketBase dit à l'auteur que sa session a expiré : diagnostic faux, et invitation à se reconnecter inutilement |
| 4 | 🟠 | `getOwned` transforme **toute** erreur en `404` | Même travers : une panne devient « Ressource introuvable » et n'apparaît pas dans les logs d'erreur |
| 5 | 🟠 | Migration `1793969836_updated_users.js` : champ `roles` (admin/editor/viewer) ajouté depuis l'admin, inutilisé, et **absent de la liste des champs protégés** de `users.updateRule` | Tout utilisateur peut s'écrire `roles: "admin"`. Inoffensif aujourd'hui (le serveur lit `role`), mais c'est un piège : le premier code qui lira `roles` créera une élévation de privilèges |
| 6 | 🟡 | `POST /pending-changes/:id/reject` ne prend pas le verrou, contrairement à `accept` | Un rejet et une acceptation simultanés peuvent laisser un patch appliqué mais marqué `REJECTED`. **Non corrigé, volontairement** : le verrou interdirait de rejeter une proposition pendant toute l'écriture d'un livre, pour une course qui demande deux clics simultanés du même auteur |
| 7 | 🟡 | `exportBook` révoque l'URL du blob juste après `click()` | Firefox et Safari peuvent annuler le téléchargement |
| 8 | 🟡 | `server/.env.example` livre `LOG_PROMPTS=true` | Copié tel quel (comme le dit le README), il enregistre les manuscrits complets dans `ai_calls` par défaut |
| 9 | 🟡 | `client/tsconfig.tsbuildinfo` est versionné | Artefact de build qui change à chaque compilation |
| 10 | 🟡 | Pas d'intégration continue, pas de `typecheck` racine, le client n'est vérifié que par `npm run build` | Une régression de types côté client ou un test cassé n'est vu par personne avant fusion |

### Non corrigés ici, à garder en tête

- **Budget :** `monthlySpend` relit toutes les lignes `ai_calls` du mois à chaque appel IA (O(n), plusieurs fois par scène). Sans effet à l'échelle actuelle ; à remplacer par un cumul mensuel si l'usage grossit.
- **Authentification :** chaque requête appelle `authRefresh` sur PocketBase, ce qui émet un nouveau jeton à chaque fois. Un `getOne` sur le jeton, ou un petit cache de quelques secondes, suffirait.
- **Multi-instance :** le verrou est en mémoire. Le serveur ne doit tourner qu'en une seule instance ; à écrire dans le README de déploiement si cela change.
- **Client sans tests :** aucun test de composant. Les tests navigateur ont été faits à la main ; un Playwright minimal sur le parcours simulé serait le prochain investissement utile.
- **Validation réelle :** toujours la priorité n° 1 de `docs/VALIDATION.md`, et rien ne la remplace.

## Plan appliqué sur la branche

1. **Watchdog** : `restoreOrphans(projectId?)` ne touche plus qu'au projet du job orphelin. Test d'intégration : un job vivant sur un autre projet garde son brouillon.
2. **Arrêt propre** : `JobsService.shutdown()` annule les jobs en cours, attend leur finalisation (délai borné) et les marque `FAILED` avec un message clair ; `index.ts` l'appelle avant `app.close()`. Test d'intégration.
3. **Pannes PocketBase** : `authenticate` ne renvoie `401` que pour un refus du jeton (400/401/403/404) et `503` sinon ; `getOwned` ne renvoie `404` que pour 400/403/404 et laisse passer le reste. Tests d'intégration.
4. **`roles`** : nouvelle migration qui supprime ce champ (la migration d'origine reste, l'historique de PocketBase l'exige). Réversible par sa fonction `down`.
5. **Révocation différée du blob**, **`LOG_PROMPTS=false`** dans l'exemple, **`*.tsbuildinfo` ignoré**.
6. **CI GitHub Actions** : installation, binaire PocketBase, `typecheck` serveur et client, tests, build. Script `npm run typecheck` à la racine.

## Vérification

- `npm run typecheck`, `npm test` (185 tests, 177 avant : 8 nouveaux dans `server/test/integration/robustness.test.ts`) et `npm run build` passent.
- Le test du watchdog échoue sur l'ancien code (nettoyage global) et passe avec le correctif.
- **Non vérifié :** le câblage de `SIGTERM` dans `index.ts` sur un vrai processus (seul `shutdown()` est testé), la révocation différée du blob dans Firefox et Safari, et le premier passage de la CI sur GitHub.
