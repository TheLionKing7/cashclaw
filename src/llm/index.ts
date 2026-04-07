import type { LLMConfig } from "../config.js";
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  ToolDefinition,
  ContentBlock,
  ToolResultBlock,
} from "./types.js";

export type { LLMProvider, LLMMessage, LLMResponse } from "./types.js";

function createAnthropicProvider(config: LLMConfig): LLMProvider {
  return {
    async chat(messages, tools) {
      const systemMsg = messages.find((m) => m.role === "system");
      const nonSystem = messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: 4096,
        system: typeof systemMsg?.content === "string" ? systemMsg.content : undefined,
        messages: nonSystem.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };

      if (tools && tools.length > 0) {
        body.tools = tools;
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${err}`);
      }

      const data = (await res.json()) as {
        content: ContentBlock[];
        stop_reason: string;
        usage: { input_tokens: number; output_tokens: number };
      };

      return {
        content: data.content,
        stopReason: data.stop_reason as LLMResponse["stopReason"],
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
      };
    },
  };
}

// Translate our ToolDefinition[] to OpenAI's { type: "function", function: {...} }
function toOpenAITools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// Translate our messages to OpenAI format
function toOpenAIMessages(
  messages: LLMMessage[],
): unknown[] {
  return messages.map((m) => {
    // System/simple text messages
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }

    // Assistant message with tool_use blocks
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const textParts = m.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");

      const toolCalls = m.content
        .filter((b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input),
          },
        }));

      return {
        role: "assistant",
        content: textParts || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }

    // User message with tool_result blocks
    if (m.role === "user" && Array.isArray(m.content)) {
      const results = m.content as ToolResultBlock[];
      // OpenAI expects individual "tool" messages for each result
      return results.map((r) => ({
        role: "tool",
        tool_call_id: r.tool_use_id,
        content: r.content,
      }));
    }

    return { role: m.role, content: m.content };
  }).flat();
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function createOpenAICompatibleProvider(
  config: LLMConfig,
  baseUrl: string,
): LLMProvider {
  return {
    async chat(messages, tools) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      };

      if (baseUrl.includes("openrouter")) {
        headers["HTTP-Referer"] = "https://cashclaw.dev";
        headers["X-Title"] = "CashClaw";
      }

      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: 4096,
        messages: toOpenAIMessages(messages),
      };

      if (tools && tools.length > 0) {
        body.tools = toOpenAITools(tools);
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM API ${res.status}: ${err}`);
      }

      const data = (await res.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: OpenAIToolCall[];
          };
          finish_reason: string;
        }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      const choice = data.choices[0];
      const content: ContentBlock[] = [];

      if (choice.message.content) {
        content.push({ type: "text", text: choice.message.content });
      }

      if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            input = { _raw: tc.function.arguments, _error: "malformed JSON from LLM" };
          }
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }

      // Map finish_reason to our stopReason
      const stopReasonMap: Record<string, LLMResponse["stopReason"]> = {
        stop: "end_turn",
        tool_calls: "tool_use",
        length: "max_tokens",
      };

      return {
        content,
        stopReason: stopReasonMap[choice.finish_reason] ?? "end_turn",
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        },
      };
    },
  };
}

/**
 * Archon provider — routes LLM calls through the Archon xDragon chain.
 * Uses ARCHON_GATEWAY_KEY from config.apiKey (set by autoInitFromEnv).
 * Kaggle/Ollama pool is automatically preferred when alive (CODE tasks → T4 GPU).
 * Tool calling is not supported in single-shot mode — the loop exits after one turn.
 */
function createArchonProvider(config: LLMConfig): LLMProvider {
  const backendUrl = process.env.ARCHON_BACKEND_URL ?? "https://archon-nexus-api.fly.dev";
  return {
    async chat(messages) {
      const systemMsg = messages.find(m => m.role === "system");
      const userMsg = [...messages].reverse().find(m => m.role === "user");

      const systemPart = typeof systemMsg?.content === "string" ? systemMsg.content + "\n\n" : "";
      const userPart = typeof userMsg?.content === "string" ? userMsg.content : JSON.stringify(userMsg?.content ?? "");
      const prompt = systemPart + userPart;

      const res = await fetch(`${backendUrl}/api/xdragon/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-archon-gateway-key": config.apiKey,
        },
        body: JSON.stringify({
          agentId: "fiveclaw",
          model: config.model || "deepseek-coder-v2:16b",
          prompt,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => "(no body)");
        throw new Error(`Archon xDragon ${res.status}: ${err}`);
      }

      const data = await res.json() as { response?: string; content?: string };
      const text = data.response ?? data.content ?? "";

      return {
        content: [{ type: "text", text }],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider(config);
    case "openai":
      return createOpenAICompatibleProvider(
        config,
        "https://api.openai.com/v1",
      );
    case "openrouter":
      return createOpenAICompatibleProvider(
        config,
        "https://openrouter.ai/api/v1",
      );
    case "archon":
      return createArchonProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
