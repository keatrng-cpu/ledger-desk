/**
 * Config gaps, said calmly. The user UI never prints an environment variable
 * name ("XAI_API_KEY is not visible to this function", "Set SEC_USER_AGENT…").
 * A missing server setting is an operator chore, not a market event: one
 * calm "offline" card with a setup link.
 */
export const SETUP_URL = "https://github.com/keatrng-cpu/ledger-desk/blob/main/.env.example";

const ENV_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** True when an error/note is about a missing key or server setting, not a real failure. */
export function isConfigGap(text: string | null | undefined): boolean {
  if (!text) return false;
  return /not visible to this function|api[_ ]?key|not configured|missing (?:key|env)|\bset [A-Z][A-Z0-9_]+\b|_KEY\b|USER_AGENT/i.test(text);
}

/** Replace any ENV_VAR_NAME in a sentence with "a server setting". */
export function scrubEnv(text: string): string {
  return text.replace(ENV_NAME, "a server setting");
}
