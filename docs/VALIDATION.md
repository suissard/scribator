# État de validation du cahier des charges V3.1

Légende : ✅ vérifié · 🤖 vérifié avec l'API simulée seulement · ⏳ à faire par un humain

Le simulateur (`server/scripts/mock-openrouter.ts`) passe par le vrai SDK et reproduit le protocole, mais **le pipeline complet n'a pas encore tourné sur la vraie API OpenRouter**. Seuls deux appels très courts ont réussi avec `nvidia/nemotron-3.5-super-vl:free` : une sortie structurée simple et un flux. Ni les schémas complets, ni le cache, ni la tenue de la cible de mots ne sont donc vérifiés. Le code n'a donc jamais été confronté à la validation réelle des requêtes.

## Tranche 0 : prompts, extraction, diff

| Critère | État | Preuve |
|---|---|---|
| Prose, style et suggestions au moins aussi bons que le workflow manuel | ⏳ | Il faut les prompts de Julien, une clé API et son jugement. `npm run try -w server` est prêt |

## Tranche 1 : fondations

| Critère | État | Preuve |
|---|---|---|
| Un non-invité ne peut pas créer de compte | ✅ | Test d'intégration, vrai PocketBase |
| `update(id, { status: 'COMPLETED' })` refusé depuis le navigateur | ✅ | Test d'intégration, y compris en multipart |
| Un appel IA de test apparaît dans `ai_calls` avec tokens et coût | 🤖 | `POST /api/admin/ai-test` |
| Une erreur serveur renvoie un `request_id` retrouvable dans les logs | ✅ | Essai en mode production |

## Tranche 2 : étapes 1 et 2

| Critère | État | Preuve |
|---|---|---|
| PDF, DOCX, EPUB et TXT de 20 000 mots analysés | Partiel | TXT de plus de 20 000 mots de bout en bout ; PDF, DOCX et EPUB par tests unitaires sur des fichiers synthétiques plus courts. À confirmer sur de vrais livres |
| Un PDF scanné produit un message clair | ✅ | Test unitaire |
| Le fichier de référence est supprimé après l'analyse | ✅ | Test d'intégration |
| Fermer l'onglet pendant l'analyse puis revenir affiche le résultat | Partiel | Le job est indépendant de la requête et l'état est rechargé à l'ouverture, mais le scénario n'a pas été joué tel quel |

## Tranche 3 : trame et échantillon

| Critère | État | Preuve |
|---|---|---|
| Régénérer la trame conserve un chapitre retouché | ✅ | Test d'intégration |
| Échantillon inchangé dans TipTap : diff de 0 % | ✅ | Essai dans un vrai navigateur sur un texte riche, qui a révélé un faux positif corrigé |
| Correction de plus de 5 % : suggestion avec exemples | 🤖 | Test d'intégration et navigateur |
| Double clic : une seule exécution, `409` sur le second | ✅ | Tests sur une route job et sur `outline` |

## Tranche 4 : studio

| Critère | État | Preuve |
|---|---|---|
| Chapitre de 3 500 mots à ±15 % de la cible | ⏳ | Le simulateur obéit à la cible : le test ne prouve rien sur la longueur réelle |
| `cache_read_tokens > 0` dès la 2ᵉ scène | ⏳ | 🤖 Les blocs stables sont identiques octet pour octet (testé) ; le cache réel reste à observer |
| « Arrêter » coupe le flux en moins d'une seconde | 🤖 | Test d'intégration avec connexion réellement fermée. Selon le fournisseur, la facturation peut continuer |
| Tuer le serveur puis le relancer : plus de scène en `GENERATING` | ✅ | Test avec vrai `SIGKILL` |
| Rouvrir le chapitre 2 alors que le 4 est validé périme les chapitres 3 et 4 | ✅ | Test d'intégration |
| Budget dépassé : message clair, aucun appel IA | ✅ | Test d'intégration |

## Écriture automatique et statistiques

| Critère | État | Preuve |
|---|---|---|
| Un livre s'écrit, se valide et se clôt seul après l'échantillon | 🤖 | Tests d'intégration et navigateur, sur le simulateur |
| Arrêter puis relancer reprend sans refaire ce qui est fait | 🤖 | Test d'intégration et navigateur |
| « Tout écrire » refait les chapitres écrits mais non validés, sans toucher aux chapitres validés | 🤖 | Tests d'intégration et navigateur |
| « Réécrire le chapitre » refait plan et texte, garde l'ancien dans l'historique, et ne touche à rien si le plan échoue | 🤖 | Tests d'intégration |
| Une erreur ou un budget épuisé arrête le livre sans valider le chapitre en cours | 🤖 | Tests d'intégration |
| Les moyennes par étape prédisent la durée réelle | ⏳ | Le simulateur ne dit rien des durées réelles. À comparer sur un vrai livre |
| La fourchette de prix encadre le coût réel | 🤖 | Test d'intégration sur un livre simulé. À confirmer sur un vrai livre : le simulateur ne facture pas de réflexion et les ratios tokens par mot sont théoriques |

## Tranche 5 : export et déploiement

| Critère | État | Preuve |
|---|---|---|
| DOCX correct dans Word et LibreOffice | Partiel | Conversion LibreOffice réussie, XML contrôlé. **Word non testé** |
| EPUB validé par un validateur | ⏳ | Structure et XML bien formés, mais **EPUBCheck n'a pas pu être lancé**. Commande : `java -jar epubcheck.jar livre.epub` |
| Supprimer un compte supprime toutes ses données | ✅ | Test d'intégration |
| Restauration d'une sauvegarde testée une fois | ✅ | Sauvegarde, suppression, restauration via PocketBase |
| `docker-compose` + Caddy | ⏳ | **Jamais lancé** : Docker inaccessible depuis la session, Caddy non installé. `npm ci` et le build de production sont vérifiés hors conteneur |

## À vérifier en priorité avec une vraie clé

1. `npm run try -w server` : une erreur sur les paramètres se verrait tout de suite. Ce sont `reasoning`, `provider`, `session_id` et `response_format`, envoyés via le SDK `openai`. La doc d'OpenRouter ne décrit pas ce SDK avec `baseURL` sur les pages lues.
2. Les schémas Zod convertis en sorties structurées : le simulateur ne les valide pas.
3. `cache_control` sur les blocs `system` et `cached_tokens` dès la 2ᵉ scène.
4. `provider.data_collection: deny` : confirmer que les modèles choisis restent disponibles.
5. Le coût réel d'un chapitre, et la tenue de la cible de mots.

## Écarts assumés par rapport au cahier

| Écart | Raison |
|---|---|
| OpenRouter au lieu du SDK Anthropic (§0 n°11, §1.3, §2.2, §2.4) | Décision du porteur du projet : davantage de choix de modèles |
| Repli sur refus géré par le serveur Node (`AI_MODEL_REFUSAL_FALLBACK`), pour tous les appels | Sur OpenRouter, un refus est une réponse 200 : `models` ne se déclenche que sur erreur |
| Ouvrage de référence facultatif (§5.1, §10.2) | Décision du porteur du projet. Sans ouvrage, un prompt `style_invent` déduit le style des idées, modifiable à l'étape 2 ; les CGU ne sont demandées que pour un dépôt de fichier |
| Modèle de rédaction choisi par livre (`projects.model_creative`) | Décision du porteur du projet. Le modèle rapide reste global |
| `pricing.ts` ne contient plus de table de prix | Le coût vient de `usage.cost`. Seule une annulation est estimée, depuis le catalogue |
| Validation d'un chapitre : appels IA **avant** le changement de statut | Sinon un échec laisse un chapitre validé sans résumé. L'échec de l'apprentissage du style ne bloque pas |
| Synopsis invalidé : le texte est aussi vidé, pas seulement `synopsis_covers_up_to` | Sinon il continuerait à décrire l'ancienne version du chapitre. Les résumés prennent le relais jusqu'au recalcul |
| `busy_timeout` à 10 000 ms au lieu de 5 000 | Réglage par connexion, imposé par PocketBase, non modifiable par migration. Plus protecteur que demandé |
| `scenes.ai_original_content` de la scène issue de l'échantillon = texte validé | Sinon les mêmes corrections seraient apprises deux fois |
| Lecteur EPUB `jszip` plutôt que `epub2` | Option prévue au §2.2 |
| Composants `ui/` écrits à la main dans l'esprit `shadcn/ui` | Le générateur demande un accès interactif ; même pile (Radix, cva, Tailwind) |
| Node 22.9+ au lieu de 20+ | Node 20 n'est plus maintenu ; `--env-file-if-exists` en dépend |
| `ai_calls.project` sans cascade | Supprimer un projet remettrait le budget à zéro |
| PocketBase servi sous `/pb` | Le serveur Node et PocketBase ont tous deux une API sous `/api` |

## Ajouts non listés au cahier

Le §5 ne couvrait pas ces besoins pourtant décrits ailleurs : `POST /projects/:id/chapters`, `DELETE /chapters/:id` (§4.1, le numéro est protégé), `POST /chapters/:id/ignore-stale` (§4.3), `POST /me/accept-terms` (§9), `POST /admin/ai-test` (critère de la tranche 1), `GET /models` et `PATCH /projects/:id/model` (choix du modèle), le champ `scenes.truncated` (§5.6), `services/models.service.ts` (limites de chaque modèle), le hook `pb_hooks/defaults.pb.js` (PocketBase n'a pas de valeur par défaut, et le client n'a pas le droit d'envoyer `status`).
