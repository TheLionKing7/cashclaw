import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface LLMConfig {
  provider: "anthropic" | "openai" | "openrouter";
  model: string;
  apiKey: string;
}

/** Identity Shield — Haskell microservice for agent persona locking */
export interface IdentityShieldConfig {
  url: string;       // default: http://localhost:7777
}

/** MemSight — agent long-term memory (Hindsight fork) */
export interface MemSightConfig {
  url: string;       // e.g. http://localhost:8888 or Railway URL
  bankId: string;    // isolated memory bank per agent, e.g. "fiveclaw"
}

/** xDragon — cloud LLM execution via Archon backend */
export interface XDragonConfig {
  backendUrl: string;  // e.g. https://archon-nexus-api-production.up.railway.app
  gatewayKey: string;
}

/** Oversight — silent event stream to Archon monitoring */
export interface OversightConfig {
  backendUrl: string;
  gatewayKey: string;
  enabled: boolean;
}

/** Hyperspace — idle-compute P2P node, earns HYPER points when FiveClaw is not working */
export interface HyperspaceConfig {
  /** URL of the local hyperspace-x-node daemon, e.g. http://localhost:9099 */
  nodeUrl: string;
  /** Optional gateway key (must match HYPERSPACE_GATEWAY_KEY in hyperspace-x-node) */
  gatewayKey?: string;
  /** Hyperspace profile when starting a node (inference | embedding | relay | storage | full) */
  profile?: "inference" | "embedding" | "relay" | "storage" | "full";
}

export interface PricingConfig {
  strategy: "fixed" | "complexity";
  baseRateEth: string;
  maxRateEth: string;
}

export interface PollingConfig {
  intervalMs: number;
  urgentIntervalMs: number;
}

export interface PersonalityConfig {
  tone: "professional" | "casual" | "friendly" | "technical";
  responseStyle: "concise" | "detailed" | "balanced";
  customInstructions?: string;
}

export interface FiveClawConfig {
  agentId: string;
  llm: LLMConfig;
  polling: PollingConfig;
  pricing: PricingConfig;
  specialties: string[];
  autoQuote: boolean;
  autoWork: boolean;
  maxConcurrentTasks: number;
  maxLoopTurns?: number;
  declineKeywords: string[];
  personality?: PersonalityConfig;
  learningEnabled: boolean;
  studyIntervalMs: number;
  agentCashEnabled: boolean;
  // ── Archon ecosystem integrations ──────────────────────────
  identityShield?: IdentityShieldConfig;
  memSight?: MemSightConfig;
  xDragon?: XDragonConfig;
  oversight?: OversightConfig;
  hyperspace?: HyperspaceConfig;
}

/** Backwards-compatible alias — existing imports continue to work */
export type CashClawConfig = FiveClawConfig;

const CONFIG_DIR = path.join(os.homedir(), ".fiveclaw");
const CONFIG_PATH = path.join(CONFIG_DIR, "fiveclaw.json");

const DEFAULT_CONFIG: Omit<CashClawConfig, "agentId" | "llm"> = {
  polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
  pricing: { strategy: "fixed", baseRateEth: "0.005", maxRateEth: "0.05" },
  specialties: [],
  autoQuote: true,
  autoWork: true,
  maxConcurrentTasks: 3,
  declineKeywords: [],
  learningEnabled: true,
  studyIntervalMs: 1_800_000, // 30 minutes
  agentCashEnabled: false,
};

export function loadConfig(): FiveClawConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as FiveClawConfig;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function requireConfig(): FiveClawConfig {
  const config = loadConfig();
  if (!config) {
    throw new Error(
      "No config found. Run `fiveclaw init` first.",
    );
  }
  return config;
}

export function saveConfig(config: CashClawConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  fs.chmodSync(CONFIG_PATH, 0o600);
}

/** Check if config has all required fields for running the agent */
export function isConfigured(): boolean {
  const config = loadConfig();
  if (!config) return false;
  return Boolean(config.agentId && config.llm?.apiKey && config.llm?.provider);
}

/** Save partial config fields, merging with existing config or defaults */
export function savePartialConfig(partial: Partial<CashClawConfig>): CashClawConfig {
  const existing = loadConfig();
  const config = {
    ...DEFAULT_CONFIG,
    agentId: "",
    llm: { provider: "anthropic" as const, model: "", apiKey: "" },
    ...existing,
    ...partial,
  };
  saveConfig(config);
  return config;
}

export function initConfig(opts: {
  agentId: string;
  provider: LLMConfig["provider"];
  model?: string;
  apiKey: string;
  specialties?: string[];
}): CashClawConfig {
  const modelDefaults: Record<LLMConfig["provider"], string> = {
    anthropic: "claude-sonnet-4-20250514",
    openai: "gpt-4o",
    openrouter: "anthropic/claude-sonnet-4-20250514",
  };

  const config: CashClawConfig = {
    ...DEFAULT_CONFIG,
    agentId: opts.agentId,
    llm: {
      provider: opts.provider,
      model: opts.model ?? modelDefaults[opts.provider],
      apiKey: opts.apiKey,
    },
    specialties: opts.specialties ?? [],
  };

  saveConfig(config);
  return config;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

/** Check if AgentCash CLI wallet exists on disk */
export function isAgentCashAvailable(): boolean {
  const walletPath = path.join(os.homedir(), ".agentcash", "wallet.json");
  return fs.existsSync(walletPath);
}
