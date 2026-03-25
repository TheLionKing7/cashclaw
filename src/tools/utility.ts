import type { Tool } from "./types.js";
import { loadFeedback } from "../memory/feedback.js";
import { appendLog } from "../memory/log.js";
import { searchMemory } from "../memory/search.js";
import { executeWithXDragon } from "../xdragon/index.js";
import * as cli from "../moltlaunch/cli.js";

export const checkWalletBalance: Tool = {
  definition: {
    name: "check_wallet_balance",
    description: "Check your wallet's ETH balance on Base mainnet.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async execute() {
    const wallet = await cli.walletShow();
    return {
      success: true,
      data: `Address: ${wallet.address}\nBalance: ${wallet.balance ?? "unknown"} ETH`,
    };
  },
};

export const readFeedbackHistory: Tool = {
  definition: {
    name: "read_feedback_history",
    description: "Read past task feedback scores and comments. Useful for learning from past performance.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries to return (default 10)" },
      },
    },
  },
  async execute(input) {
    const feedback = loadFeedback();
    const limit = (input.limit as number) || 10;
    const recent = feedback.slice(-limit);

    if (recent.length === 0) {
      return { success: true, data: "No feedback history yet." };
    }

    const summary = recent.map((f) =>
      `- Task "${f.taskDescription.slice(0, 60)}": ${f.score}/5 — ${f.comments || "(no comment)"}`,
    ).join("\n");

    return { success: true, data: summary };
  },
};

export const memorySearch: Tool = {
  definition: {
    name: "memory_search",
    description:
      "Search your knowledge base and past feedback for relevant context. " +
      "Use when you need to recall past experiences, lessons learned, or " +
      "feedback patterns related to a topic or task type.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — keywords describing what you're looking for",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 5)",
        },
      },
      required: ["query"],
    },
  },
  async execute(input) {
    const query = input.query;
    if (typeof query !== "string" || !query.trim()) {
      return { success: false, data: "Missing required field: query" };
    }
    const limit = (input.limit as number) || 5;

    const hits = searchMemory(query, limit);

    if (hits.length === 0) {
      return { success: true, data: "No relevant memories found." };
    }

    const summary = hits
      .map((h, i) => `${i + 1}. [${h.type}] ${h.text.slice(0, 300)}`)
      .join("\n\n");

    return { success: true, data: summary };
  },
};

export const logActivity: Tool = {
  definition: {
    name: "log_activity",
    description: "Write an entry to the daily activity log.",
    input_schema: {
      type: "object",
      properties: {
        entry: { type: "string", description: "Log entry text" },
      },
      required: ["entry"],
    },
  },
  async execute(input) {
    const entry = input.entry;
    if (typeof entry !== "string" || !entry.trim()) {
      return { success: false, data: "Missing required field: entry" };
    }
    appendLog(entry);
    return { success: true, data: "Logged." };
  },
};

/**
 * xDragon execution tool — routes complex tasks through Archon's cloud LLM chain.
 * Use this for research, large-scale generation, multi-step analysis, or any task
 * that benefits from Cerebras/OpenRouter grade compute.
 */
export const executeWithXDragonTool: Tool = {
  definition: {
    name: "execute_with_xdragon",
    description:
      "Execute complex research, analysis, writing, or code generation tasks using " +
      "xDragon's AI infrastructure (cloud LLM chain via Archon backend). " +
      "Use when the task requires deep research, large text generation, multi-step " +
      "reasoning, or when you need to leverage premium AI compute for quality results. " +
      "Returns the AI-generated content as a string.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The detailed task prompt to execute. Include all relevant context.",
        },
        system_prompt: {
          type: "string",
          description:
            "Optional system prompt to frame the execution context. " +
            "E.g. 'You are an expert TypeScript developer reviewing code.'",
        },
      },
      required: ["prompt"],
    },
  },
  async execute(input) {
    const prompt = input.prompt;
    if (typeof prompt !== "string" || !prompt.trim()) {
      return { success: false, data: "Missing required field: prompt" };
    }
    const systemPrompt = typeof input.system_prompt === "string" ? input.system_prompt : undefined;

    try {
      const content = await executeWithXDragon({ prompt, systemPrompt, agentId: "fiveclaw" });
      return { success: true, data: content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, data: `xDragon execution failed: ${msg}` };
    }
  },
};

