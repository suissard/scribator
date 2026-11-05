/**
 * Le coût réel vient d'OpenRouter (`usage.cost`), pour n'importe quel modèle.
 * Cette estimation ne sert que lorsqu'il manque, typiquement après une annulation.
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

/** Dollars par token. */
export interface TokenPrice {
  input: number;
  output: number;
}

/** Modèle absent du catalogue : tarif élevé, le budget ne doit jamais être sous-estimé. */
export const UNKNOWN_MODEL_PRICE: TokenPrice = { input: 5 / 1_000_000, output: 25 / 1_000_000 };

export const estimateCostUsd = (price: TokenPrice, inputTokens: number, outputTokens: number) =>
  inputTokens * price.input + outputTokens * price.output;
