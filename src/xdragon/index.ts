/**
 * xDragon execution client — routes complex task work through Archon's
 * cloud LLM chain (Cerebras → OpenRouter → DeepSeek fallback).
 *
 * Used as a tool during the agent loop when the task requires heavy
 * research, generation, or analysis beyond a single-shot response.
 */

const DEFAULT_BACKEND = "https://archon-nexus-api.fly.dev";

export interface XDragonRequest {
  prompt: string;
  systemPrompt?: string;
  agentId?: string;
}

export interface XDragonResponse {
  content: string;
  agentId?: string;
}

function getBackendUrl(): string {
  return process.env.ARCHON_BACKEND_URL ?? DEFAULT_BACKEND;
}

function getGatewayKey(): string {
  return process.env.ARCHON_GATEWAY_KEY ?? "";
}

/**
 * Execute a prompt through xDragon's cloud LLM chain.
 * Returns the AI-generated content string.
 */
export async function executeWithXDragon(req: XDragonRequest): Promise<string> {
  const res = await fetch(`${getBackendUrl()}/api/xdragon/research`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-archon-gateway-key": getGatewayKey(),
    },
    body: JSON.stringify({
      prompt: req.prompt,
      systemPrompt: req.systemPrompt,
      agentId: req.agentId ?? "fiveclaw",
    }),
    signal: AbortSignal.timeout(60_000), // 60s — complex tasks need time
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`xDragon request failed (${res.status}): ${body}`);
  }

  const data = await res.json() as XDragonResponse;
  return data.content ?? "";
}
