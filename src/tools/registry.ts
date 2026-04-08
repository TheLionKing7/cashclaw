import type { ToolDefinition } from "../llm/types.js";
import type { FiveClawConfig } from "../config.js";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import {
  readTask,
  quoteTask,
  declineTask,
  submitWork,
  sendMessage,
  listBounties,
  claimBounty,
  claimPayment,
} from "./marketplace.js";
import {
  checkWalletBalance,
  readFeedbackHistory,
  memorySearch,
  logActivity,
  executeWithXDragonTool,
} from "./utility.js";
import { agentcashFetch, agentcashBalance } from "./agentcash.js";

const BASE_TOOLS: Tool[] = [
  readTask,
  quoteTask,
  declineTask,
  submitWork,
  sendMessage,
  listBounties,
  claimBounty,
  claimPayment,
  checkWalletBalance,
  readFeedbackHistory,
  memorySearch,
  logActivity,
  executeWithXDragonTool,  // xDragon cloud LLM execution
];

const AGENTCASH_TOOLS: Tool[] = [
  agentcashFetch,
  agentcashBalance,
];

// Memoize by config reference to avoid rebuilding on every tool call
let cachedConfig: FiveClawConfig | null = null;
let cachedToolMap: Map<string, Tool> | null = null;

function buildToolMap(config: FiveClawConfig): Map<string, Tool> {
  if (cachedConfig === config && cachedToolMap) return cachedToolMap;
  const tools = config.agentCashEnabled
    ? [...BASE_TOOLS, ...AGENTCASH_TOOLS]
    : BASE_TOOLS;
  cachedToolMap = new Map(tools.map((t) => [t.definition.name, t]));
  cachedConfig = config;
  return cachedToolMap;
}

export function getToolDefinitions(config: FiveClawConfig): ToolDefinition[] {
  const toolMap = buildToolMap(config);
  return [...toolMap.values()].map((t) => t.definition);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const toolMap = buildToolMap(ctx.config);
  const tool = toolMap.get(name);
  if (!tool) {
    return { success: false, data: `Unknown tool: ${name}` };
  }

  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: `Tool error: ${msg}` };
  }
}
