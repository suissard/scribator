# Scribator

Studio d'écriture de livre assisté par IA, avec validation humaine à chaque jalon. L'auteur fournit ses idées et, s'il le souhaite, un livre de référence ; l'application en tire un style, un concept, une Bible, une trame, puis rédige scène par scène. Les corrections de l'auteur nourrissent des propositions d'ajustement du style.

Le détail de ce qui a été vérifié, et de ce qui reste à faire, est dans [docs/VALIDATION.md](docs/VALIDATION.md).

**Stack :** React + Vite + TipTap (`client/`), Node + Fastify (`server/`), PocketBase (`pocketbase/`). Les modèles passent par [OpenRouter](https://openrouter.ai), via le SDK `openai`.

## Démarrer sans clé API

Le simulateur local remplace OpenRouter : rien n'est facturé, mais le texte produit est factice.

Il a sa propre base, `pocketbase/pb_data_mock` : le texte factice ne peut pas atterrir dans un vrai livre, et les livres de `npm run dev` n'y apparaissent pas.

```bash
npm install
npm run pb:fetch
npm run dev:mock
```

Dans un second terminal, une fois PocketBase démarré :

```bash
npm run seed:dev
```

Ouvre http://localhost:5173 et connecte-toi avec le compte de démonstration affiché par la commande.

## Démarrer avec la vraie API

```bash
cp server/.env.example server/.env
```

Renseigne `OPENROUTER_API_KEY`, les deux modèles (`AI_MODEL_CREATIVE` et `AI_MODEL_FAST`, voir [Choisir les modèles](#choisir-les-modèles)) et les identifiants superuser dans `server/.env`, crée ce superuser, puis lance :

```bash
pocketbase/pocketbase superuser upsert admin@example.com ton-mot-de-passe --dir=pocketbase/pb_data --migrationsDir=pocketbase/pb_migrations
```

```bash
npm run dev
```

Les comptes se créent dans l'interface d'administration de PocketBase (http://127.0.0.1:8090/_/) : il n'y a pas d'inscription publique. Le coût des appels IA se suit dans la collection `ai_calls`.

## Choisir les modèles

Chaque livre peut avoir son propre modèle de rédaction : bouton « Changer de modèle », à l'étape 1 ou dans le Studio. Le serveur n'impose aucun modèle : ceux du serveur se règlent dans `server/.env`, avec les identifiants du [catalogue OpenRouter](https://openrouter.ai/models).

| Variable | Rôle | Obligatoire |
|---|---|---|
| `AI_MODEL_CREATIVE` | Rédaction, concept, trame, pour les livres sans modèle choisi | Oui |
| `AI_MODEL_FAST` | Analyse, résumés, propositions | Oui |
| `AI_MODEL_REFUSAL_FALLBACK` | Nouvel essai après un refus. Vide : pas de nouvel essai, le passage refusé arrête la génération | Non |

Au démarrage, le serveur lit le catalogue d'OpenRouter et refuse un modèle inconnu ou sans sorties structurées. La liste proposée à l'auteur en vient directement, dans l'ordre d'OpenRouter, sans les routeurs dont le prix est inconnu ; elle se met à jour au redémarrage. Avec `npm run dev:mock`, la rédaction est simulée mais la liste et les prix sont les vrais (`OPENROUTER_CATALOG_URL`) ; sans réseau, la liste factice du simulateur prend le relais. Il adapte aussi la sortie maximale, l'effort de réflexion et la mémoire intégrale aux limites de chaque modèle.

À savoir avant de changer de modèle :

- **Cache :** Anthropic, Gemini et Qwen utilisent les marqueurs `cache_control` déjà posés ; OpenAI, DeepSeek et Grok cachent automatiquement ; ailleurs, il peut ne pas y en avoir et le coût par scène augmente.
- **Confidentialité :** `OPENROUTER_DATA_COLLECTION=deny` exclut les fournisseurs susceptibles de stocker les manuscrits, ce qui peut rendre certains modèles indisponibles.
- **Modèles gratuits :** une erreur `No endpoints found matching your data policy` signifie qu'ils exigent d'autoriser l'entraînement sur vos textes. Il faut alors `OPENROUTER_DATA_COLLECTION=allow` et l'activer sur [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy), ou choisir un modèle payant.
- **Annulation :** chez certains fournisseurs (Google, Mistral, Bedrock), arrêter une génération ne stoppe pas la facturation. Le coût journalisé est alors sous-estimé.

## Écriture automatique et suivi

Une fois l'échantillon validé, le Studio propose d'écrire tout le reste du livre, avec une durée estimée, le nombre de tokens attendu et une fourchette de prix pour le modèle du livre. Les tokens se déduisent des mots visés et du contexte de chaque scène, qui grossit avec le texte déjà écrit. Le bas de la fourchette suppose un cache efficace ; le haut, aucun cache, de la réflexion et un dépassement de longueur. Le job planifie d'abord les scènes de tous les chapitres, puis écrit, résume et valide chaque chapitre dans l'ordre. Sans relecteur, les mises à jour de la Bible s'appliquent seules (les versions précédentes restent dans l'historique) ; un patch inapplicable reste en proposition. Une erreur, le budget ou « Arrêter » interrompt le job ; relancer reprend là où il s'est arrêté.

Toute génération affiche une barre par étape. Le temps restant d'une étape vaut durée moyenne d'un maillon × maillons restants : la moyenne vient d'abord de l'historique, puis des maillons mesurés pendant le job. `JOB_TIMEOUT_MINUTES` porte sur le job entier, sauf pour un livre, où il porte sur le dernier maillon.

Le compte rendu de l'étape Export agrège `ai_calls` : durée, tokens en entrée, en sortie et de cache, coût par type d'appel. Pour d'autres moyennes, `ai_calls` garde chaque appel (`duration_ms`, tokens, `cost_usd`, `model`, `purpose`) et `generation_jobs.duration_ms` la durée réelle de chaque job.

## Tester la qualité en ligne de commande (tranche 0)

Déroule le pipeline complet sans base de données et écrit un fichier Markdown par étape. `--ref` et `--edit` sont facultatifs. Les appels sont facturés. Pour comparer deux modèles, relance avec un autre `AI_MODEL_CREATIVE` et un autre `--out`.

```bash
npm run try -w server -- --ideas idees.md --ref livre.pdf --out out/essai --edit corrections.md
```

## Logs

Le bouton « Journal » de l'en-tête montre ce qui s'est passé dans l'onglet (requêtes, erreurs, jobs) et se copie en un clic. Les mêmes lignes vont dans la console du navigateur, et les avertissements et erreurs remontent dans les logs du serveur. Côté IA, le détail brut de chaque appel est dans la collection `ai_calls`.

## Tests

```bash
npm test
```

Les tests d'intégration lancent un vrai PocketBase et le simulateur : `npm run pb:fetch` doit avoir été exécuté.

## Prompts

Les fichiers `server/src/prompts/*.v1.md` sont **provisoires**. Pour les remplacer, crée un fichier `.v2.md` et change la version dans `server/src/lib/prompts.ts`. La version utilisée est tracée dans `ai_calls.prompt_version`.

## Déploiement

```bash
cp .env.example .env
```

Renseigne `.env`, puis lance :

```bash
docker compose up -d --build
```

Caddy sert le client et le HTTPS, le serveur Node sous `/api` et PocketBase sous `/pb` (administration : `/pb/_/`, à protéger par un mot de passe fort). Les sauvegardes quotidiennes sont actives ; pour les envoyer vers un stockage S3, configure-le dans l'administration de PocketBase.
