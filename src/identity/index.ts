/**
 * Identity Shield client — calls the Haskell microservice to:
 * 1. compile()  → get sealed identity block for a given agent
 * 2. validate() → check an LLM response for persona drift
 *
 * Falls back gracefully when the service is not running (dev / offline).
 */

export interface CompileRequest {
  crAgentId: string;
}

export interface CompileResponse {
  crIdentityBlock: string;
  crAgentName: string;
  crSpecialties: string[];
}

export interface ValidateRequest {
  vrAgentId: string;
  vrResponse: string;
}

export type ErrorType = "IdentityDrift" | "HallucinationRisk" | "UnknownAgent";

export interface ValidateResponse {
  vrValid: boolean;
  vrContent: string;
  vrErrorType: ErrorType | null;
  vrHint: string | null;
}

const DEFAULT_URL = "http://localhost:7777";

function getShieldUrl(): string {
  return process.env.IDENTITY_SHIELD_URL ?? DEFAULT_URL;
}

/**
 * Compile a sealed identity block for the named agent.
 * Returns null when the identity shield is not reachable.
 */
export async function compileIdentity(agentId: string): Promise<CompileResponse | null> {
  try {
    const res = await fetch(`${getShieldUrl()}/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crAgentId: agentId } satisfies CompileRequest),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      console.warn(`[identity-shield] compile failed: ${err.error ?? res.statusText}`);
      return null;
    }

    return res.json() as Promise<CompileResponse>;
  } catch {
    // Service not running — silently fall back; prompt.ts uses built-in identity
    return null;
  }
}

/**
 * Validate an LLM response against the agent's identity contract.
 * Returns the original response (as valid) when the shield is not reachable.
 */
export async function validateIdentity(
  agentId: string,
  response: string,
): Promise<ValidateResponse> {
  try {
    const res = await fetch(`${getShieldUrl()}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vrAgentId: agentId, vrResponse: response } satisfies ValidateRequest),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return { vrValid: true, vrContent: response, vrErrorType: null, vrHint: null };
    return res.json() as Promise<ValidateResponse>;
  } catch {
    // Identity shield offline — pass through without validation
    return { vrValid: true, vrContent: response, vrErrorType: null, vrHint: null };
  }
}
