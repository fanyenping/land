import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null = null;

/** 有 ANTHROPIC_API_KEY（或 ANTHROPIC_AUTH_TOKEN）時使用 Claude，否則走示範模式。 */
export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: 180_000, maxRetries: 2 });
  return client;
}

export function llmStatus() {
  return hasCredentials() ? { mode: "claude" as const, model: MODEL } : { mode: "demo" as const, model: null };
}
