# Scribator

Studio d'écriture de livre assisté par IA, avec validation humaine à chaque jalon. L'auteur fournit ses idées et, s'il le souhaite, un livre de référence ; l'application en tire un style, un concept, une Bible, une trame, puis rédige scène par scène. Les corrections de l'auteur nourrissent des propositions d'ajustement du style.

Le détail de ce qui a été vérifié, et de ce qui reste à faire, est dans [docs/VALIDATION.md](docs/VALIDATION.md).

**Stack :** React + Vite + TipTap (`client/`), Node + Fastify (`server/`), PocketBase (`pocketbase/`). Les modèles passent par [OpenRouter](https://openrouter.ai), via le SDK `openai`.

## Démarrer sans clé API

Le simulateur local remplace OpenRouter : rien n'est facturé, mais le texte produit est factice.

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

Renseigne `OPENROUTER_API_KEY` et les identifiants superuser dans `server/.env`, crée ce superuser, puis lance :

```bash
pocketbase/pocketbase superuser upsert admin@example.com ton-mot-de-passe --dir=pocketbase/pb_data --migrationsDir=pocketbase/pb_migrations
```

```bash
npm run dev
```

Les comptes se créent dans l'interface d'administration de PocketBase (http://127.0.0.1:8090/_/) : il n'y a pas d'inscription publique. Le coût des appels IA se suit dans la collection `ai_calls`.

## Choisir les modèles

Chaque livre peut avoir son propre modèle de rédaction : bouton « Changer de modèle », à l'étape 1 ou dans le Studio. Les valeurs par défaut se règlent dans `server/.env`, avec les identifiants du [catalogue OpenRouter](https://openrouter.ai/models) :

| Variable | Rôle | Défaut |
|---|---|---|
| `AI_MODEL_CREATIVE` | Rédaction, concept, trame, pour les livres sans modèle choisi | `anthropic/claude-sonnet-5.5` |
| `AI_MODEL_FAST` | Analyse, résumés, propositions | `anthropic/claude-haiku-5.5` |
| `AI_MODEL_REFUSAL_FALLBACK` | Nouvel essai après un refus (vide pour désactiver) | `anthropic/claude-opus-5` |

Au démarrage, le serveur lit le catalogue et refuse un modèle inconnu ou sans sorties structurées. Il adapte aussi la sortie maximale, l'effort de réflexion et la mémoire intégrale aux limites de chaque modèle.

À savoir avant de changer de modèle :

- **Cache :** Anthropic, Gemini et Qwen utilisent les marqueurs `cache_control` déjà posés ; OpenAI, DeepSeek et Grok cachent automatiquement ; ailleurs, il peut ne pas y en avoir et le coût par scène augmente.
- **Confidentialité :** `OPENROUTER_DATA_COLLECTION=deny` exclut les fournisseurs susceptibles de stocker les manuscrits, ce qui peut rendre certains modèles indisponibles.
- **Annulation :** chez certains fournisseurs (Google, Mistral, Bedrock), arrêter une génération ne stoppe pas la facturation. Le coût journalisé est alors sous-estimé.

## Tester la qualité en ligne de commande (tranche 0)

Déroule le pipeline complet sans base de données et écrit un fichier Markdown par étape. `--ref` et `--edit` sont facultatifs. Les appels sont facturés. Pour comparer deux modèles, relance avec un autre `AI_MODEL_CREATIVE` et un autre `--out`.

```bash
npm run try -w server -- --ideas idees.md --ref livre.pdf --out out/essai --edit corrections.md
```

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
