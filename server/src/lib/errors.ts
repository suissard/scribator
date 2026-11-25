export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const badRequest = (m: string) => new AppError(400, 'bad_request', m);
export const forbidden = (m: string) => new AppError(403, 'forbidden', m);
export const notFound = (m = 'Ressource introuvable.') => new AppError(404, 'not_found', m);
export const conflict = (m: string) => new AppError(409, 'conflict', m);
export const storageUnavailable = () =>
  new AppError(503, 'storage_unavailable', 'La base de données ne répond pas. Réessaie dans un instant.');

export class BudgetExceededError extends AppError {
  constructor(spent: number, budget: number) {
    super(
      402,
      'budget_exceeded',
      `Budget mensuel atteint (${spent.toFixed(2)} $ sur ${budget.toFixed(2)} $). Contacte l'administrateur pour l'augmenter, ou ajoute ta propre clé OpenRouter dans les paramètres.`,
    );
  }
}

export class MissingApiKeyError extends AppError {
  constructor() {
    super(
      400,
      'missing_api_key',
      'Aucune clé OpenRouter configurée. Ajoute ta clé personnelle dans les paramètres pour lancer la génération.',
    );
  }
}

export class RefusalError extends AppError {
  constructor(what = 'cette demande') {
    super(422, 'ai_refusal', `L'IA a refusé ${what}, reformule les instructions.`);
  }
}

/** Le modèle a répondu mais sa sortie structurée est inexploitable. */
export class AiOutputError extends AppError {
  constructor(m = "L'IA a renvoyé une réponse inexploitable, réessaie.") {
    super(502, 'ai_output', m);
  }
}
