import { z } from 'zod';
import { parseEncryptionKey } from '../lib/crypto.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Ce qu'il faut pour parler à l'IA : la CLI de la tranche 0 s'en contente, sans base de données. */
const AiEnvSchema = z.object({
  // Clé serveur facultative : repli si l'utilisateur n'a pas enregistré sa propre clé OpenRouter.
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  // Catalogue de modèles, s'il ne vient pas de OPENROUTER_BASE_URL (simulateur local).
  OPENROUTER_CATALOG_URL: z.string().url().optional(),
  // « deny » exclut les fournisseurs susceptibles de stocker les manuscrits.
  OPENROUTER_DATA_COLLECTION: z.enum(['allow', 'deny']).default('deny'),
  // Aucun modèle par défaut : le choix appartient à qui installe, parmi le catalogue d'OpenRouter.
  AI_MODEL_CREATIVE: z.string().min(1),
  AI_MODEL_FAST: z.string().min(1),
  // Modèle retenté quand un autre refuse un passage. Vide : pas de nouvel essai.
  AI_MODEL_REFUSAL_FALLBACK: z.string().default(''),
  AI_EFFORT_CREATIVE: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  LOG_PROMPTS: bool.default(false),
});

const EnvSchema = AiEnvSchema.extend({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default('127.0.0.1'),
  POCKETBASE_URL: z.string().url(),
  PB_SUPERUSER_EMAIL: z.string().email(),
  PB_SUPERUSER_PASSWORD: z.string().min(1),
  // Clé maître AES-256 (32 octets en hexadécimal ou base64) pour chiffrer les clés API utilisateur en base.
  API_KEY_ENCRYPTION_KEY: z.string().min(1).refine(
    (v) => {
      try {
        parseEncryptionKey(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Clé AES-256 invalide (32 octets en hex ou base64 attendus)' },
  ),
  MEMORY_FULLTEXT_TOKEN_LIMIT: z.coerce.number().int().positive().default(100_000),
  SUMMARY_COMPRESS_WORDS: z.coerce.number().int().positive().default(3000),
  JOB_TIMEOUT_MINUTES: z.coerce.number().positive().default(10),
  DRAFT_TICK_MS: z.coerce.number().int().positive().default(1500),
  LOG_LEVEL: z.string().default('info'),
  LOG_DIR: z.string().default('logs'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type AiEnv = z.infer<typeof AiEnvSchema>;
export type Env = z.infer<typeof EnvSchema>;

function parse<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv): z.infer<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuration invalide, variables à corriger : ${fields}`);
  }
  return parsed.data;
}

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => parse(EnvSchema, source);
export const loadAiEnv = (source: NodeJS.ProcessEnv = process.env): AiEnv => parse(AiEnvSchema, source);
