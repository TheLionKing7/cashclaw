/**
 * MemSight memory client — FiveClaw's long-term memory via the Hindsight fork.
 *
 * Provides retain/recall/reflect using MemSight's biomimetic memory system:
 * - Retain: Store task outcomes, study insights, feedback learning
 * - Recall: Retrieve memories semantically relevant to a task description
 * - Reflect: Synthesize memories into insights for study sessions
 *
 * Falls back gracefully when MemSight is not configured or reachable.
 */

export interface MemSightRetainOpts {
  content: string;
  context?: string;
  timestamp?: string;
}

export interface MemSightMemory {
  content: string;
  score: number;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface MemSightRecallOpts {
  query: string;
  limit?: number;
}

const DEFAULT_URL = "http://localhost:8888";
const DEFAULT_BANK = "fiveclaw";
const RECALL_TIMEOUT_MS = 8_000;

function getUrl(): string {
  return process.env.MEMSIGHT_URL ?? DEFAULT_URL;
}

function getBankId(): string {
  return process.env.MEMSIGHT_BANK_ID ?? DEFAULT_BANK;
}

function getApiKey(): string {
  return process.env.MEMSIGHT_API_KEY ?? "";
}

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  const key = getApiKey();
  if (key) h["Authorization"] = `Bearer ${key}`;
  return h;
}

/**
 * Store a memory entry in MemSight.
 * Fire-and-forget — never blocks task execution.
 */
export function retainMemory(opts: MemSightRetainOpts): void {
  const url = getUrl();
  const bankId = getBankId();

  fetch(`${url}/v1/default/banks/${bankId}/memories/retain`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      content: opts.content,
      context: opts.context,
      timestamp: opts.timestamp,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    // Non-blocking — MemSight is a best-effort enhancement
  });
}

/**
 * Recall memories relevant to a query from MemSight.
 * Returns empty array when MemSight is not reachable.
 */
export async function recallMemories(opts: MemSightRecallOpts): Promise<MemSightMemory[]> {
  const url = getUrl();
  const bankId = getBankId();

  try {
    const res = await fetch(`${url}/v1/default/banks/${bankId}/memories/recall`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        query: opts.query,
        top_k: opts.limit ?? 5,
      }),
      signal: AbortSignal.timeout(RECALL_TIMEOUT_MS),
    });

    if (!res.ok) return [];

    const data = await res.json() as { memories?: MemSightMemory[] };
    return data.memories ?? [];
  } catch {
    return [];
  }
}

/**
 * Reflect on existing memories to generate a synthesized insight.
 * Used during study sessions to deepen knowledge.
 */
export async function reflectOnMemories(query: string): Promise<string | null> {
  const url = getUrl();
  const bankId = getBankId();

  try {
    const res = await fetch(`${url}/v1/default/banks/${bankId}/reflect`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return null;

    const data = await res.json() as { response?: string };
    return data.response ?? null;
  } catch {
    return null;
  }
}
