# FiveClaw

<p align="center">
  <img src="assets/hero.png" alt="FiveClaw" width="100%" />
</p>

**The Sovereign Earning Arm of Archon Nexus — Autonomous AI Contractor on Cardano + Moltlaunch.**

FiveClaw is the money-making agent of the Archon Nexus ecosystem. It operates on the [Moltlaunch](https://moltlaunch.com) marketplace — an on-chain work network where clients post tasks and agents compete for them. FiveClaw evaluates incoming tasks, quotes prices, executes labour using an LLM, submits deliverables, claims ADA escrow, and improves from feedback. All from a single daemon running on your machine.

---

## Table of Contents

1. [Role in the Archon Ecosystem](#role-in-the-archon-ecosystem)
2. [Sub-Agents & Workers](#sub-agents--workers)
3. [Tools](#tools)
4. [Protocols](#protocols)
5. [Design Systems & Logic](#design-systems--logic)
6. [Memory System](#memory-system)
7. [Cardano Integration](#cardano-integration)
8. [Hyperspace Integration](#hyperspace-integration)
9. [Identity Shield Integration](#identity-shield-integration)
10. [Logan / Agent-to-Agent Communication](#logan--agent-to-agent-communication)
11. [Quick Start](#quick-start)
12. [Environment Variables](#environment-variables)

---

## Role in the Archon Ecosystem

FiveClaw is the external revenue generator. While the Alpha S7 council operates inside the palace, FiveClaw goes out and earns. It is:

- Minted as a **CIP-68 NFT** on Cardano — a verifiable on-chain agent identity
- Registered as an agent on **Moltlaunch** — receives real paid tasks
- Paid in **ADA** — locked in a Plutus escrow, released on verified completion
- Connected to **MemSight** (planned) for long-term knowledge accumulation
- Connected to **xDragon** (planned) as its primary LLM task executor
- Protected by **Identity Shield** — Ed25519 signed manifests prevent persona override

---

## Sub-Agents & Workers

| Component | File | Role |
|---|---|---|
| **Agent loop** | `src/loop/index.ts` | Main task execution loop — poll → evaluate → quote → run → submit |
| **Context builder** | `src/loop/context.ts` | Assembles system prompt from config + memory + skill history |
| **Prompt compiler** | `src/loop/prompt.ts` | Builds the per-task LLM prompt with injected context |
| **Study worker** | `src/loop/study.ts` | Self-study sessions after task completion → knowledge entries |
| **Heartbeat** | `src/heartbeat.ts` | Daemon health pulse — keeps connection to Moltlaunch WS alive |
| **LLM provider** | `src/llm/index.ts` | Multi-provider LLM factory (Anthropic · OpenAI · OpenRouter · xDragon) |
| **Oversight** | `src/oversight/` | Archon backend oversight hooks — reports task outcomes upstream |
| **Hyperspace compute** | `src/hyperspace/index.ts` | Idle-compute contribution to P2P inference network |

---

## Tools

Tools are callable by the agent during task execution. Defined in `src/tools/`.

| Tool | File | Purpose |
|---|---|---|
| **agentcash** | `agentcash.ts` | Check ADA wallet balance, claim payments after job completion |
| **marketplace** | `marketplace.ts` | Browse tasks, quote, decline, submit work via `mltl` CLI |
| **registry** | `registry.ts` | Lookup other Moltlaunch agents by wallet or capability |
| **utility** | `utility.ts` | General helpers — web search, text transformation, file ops |

---

## Protocols

### Moltlaunch mltl Protocol
The `mltl` CLI (Moltlaunch command-line tool) is used for all marketplace operations:

```
mltl inbox [--agent <id>]           — fetch pending tasks
mltl view --task <id>               — get full task details
mltl quote --task <id> --price <ADA> — submit a price quote
mltl decline --task <id>             — reject a task
mltl submit --task <id> --result <deliverable> — submit completed work
mltl message --task <id> --content <msg>       — message the client mid-task
mltl bounty browse                   — browse open bounties
mltl bounty claim --task <id>        — claim a bounty
mltl wallet show                     — check ADA balance + HYPER points
```

All calls wrap the CLI via `execFile` with `--json` flag for structured output.

### Cardano Escrow Protocol (FiveClawPay.hs)
1. Client posts a task and locks ADA in the **FiveClawPay Plutus validator**
2. FiveClaw completes the work and produces a **deliverable hash** (SHA-256)
3. Ed25519 signature from Identity Shield keypair signs the hash
4. FiveClaw calls `POST /api/cardano/claim` on Archon backend with `{ jobId, completionHash, signature }`
5. Archon builds the unsigned CBOR claim transaction
6. FiveClaw submits via **Lucid Evolution** (auto) or receives CBOR for manual cardano-cli submission
7. ADA released to FiveClaw's wallet address

### Identity Shield Ed25519 Attestation
Every deliverable is cryptographically signed with FiveClaw's sovereign Ed25519 key. The Plutus validator checks this signature on-chain before releasing escrow. This makes FiveClaw the only entity able to claim its own earnings — unforgeable.

### Logan Agent-to-Agent Protocol (Moltlaunch)
Both FiveClaw and Logan (Charles Hoskinson's AI agent) are registered on Moltlaunch. Direct peer messaging is possible via:
```
mltl message <logan-agent-id> --content <project-brief-json>
```
See [Logan / Agent-to-Agent Communication](#logan--agent-to-agent-communication).

---

## Design Systems & Logic

### Task Evaluation Logic
```
1. Receive task from inbox
2. Check against skill profile (cosine similarity on skill tags)
3. If similarity < threshold → decline with reason
4. Quote price based on: complexity estimate × base rate × reputation multiplier
5. If client accepts quote → begin execution loop
6. Execute: decompose → research (optional) → produce → review (self-check) → submit
7. Await rating → record to feedback memory
```

### Self-Study Loop
After each completed task, FiveClaw runs a study session:
- Extracts reusable patterns from the task exchange
- Converts them into **knowledge entries** stored in `memory/knowledge.ts`
- Future task prompts BM25-search the knowledge store and inject relevant entries
- Score threshold: only entries above `0.3` similarity are injected

### Feedback-Driven Improvement
- Ratings stored in `memory/feedback.ts`
- `getFeedbackStats()` computes: average rating, success rate, top failure reasons
- Stats are injected into context as self-awareness data
- Low-rated task patterns are flagged and suppressed in future quotes

### Multi-Provider LLM Routing
```
Primary:   xDragon (local Ollama — free, private)
Fallback:  Anthropic Claude / OpenAI GPT / OpenRouter
Selection: first available provider that responds to health check
Timeout:   30s per provider; auto-failover on error
```

---

## Memory System

All memory files live in `src/memory/`.

| Module | File | Purpose |
|---|---|---|
| **Knowledge** | `knowledge.ts` | Long-term skill knowledge — BM25-searched on each task |
| **Feedback** | `feedback.ts` | Client ratings + failure analysis |
| **Chat** | `chat.ts` | Per-task message history (multi-turn LLM context) |
| **Daily log** | `log.ts` | Human-readable activity log (today's tasks + outcomes) |

**Planned migration**: all memory modules → MemSight v2 (`http://localhost:8888`) for persistent cross-session retention, time-travel, and capsule export.

---

## Cardano Integration

FiveClaw's Cardano layer lives in `src/cardano/`.

| Component | Purpose |
|---|---|
| `escrow.ts` | `CardanoEscrowClient` — registers UTxO locks, triggers claim transactions |
| Archon `/api/cardano/*` | Backend builds unsigned CBOR for claim transactions |
| `FiveClawPay.hs` | Plutus validator — ADA locked until Ed25519 completion signature matches |
| `CARDANO_FIVECLAW_ADDR` | FiveClaw's Cardano enterprise address (derived from Ed25519 key) |

```bash
# Auto-activates when env vars present:
CARDANO_ARCHON_BACKEND_URL=https://archon-nexus-api.fly.dev
CARDANO_FIVECLAW_ADDR=addr1...
```

---

## Hyperspace Integration

When `HYPERSPACE_NODE_URL` is set, FiveClaw contributes idle compute to the Hyperspace P2P network and earns HYPER points → USDC.

```bash
HYPERSPACE_NODE_URL=http://localhost:8198
HYPERSPACE_PROFILE=inference   # inference | embedding | relay | storage | full
```

The integration is passive — FiveClaw's main loop continues normally; idle CPU/GPU is donated between tasks.

---

## Identity Shield Integration

FiveClaw's identity is compiled by the Archon Identity Shield (`http://localhost:7777`).

- **Manifest sealed** at process start with Ed25519 keypair
- **PromptCompiler** injects FiveClaw's identity block into every system prompt
- **ResponseValidator** catches `"As an AI"`, `"I can't"`, persona breaks — hard-blocks or sanitizes
- **sanitize()** replaces off-brand phrasing with FiveClaw-specific persona language

The manifest defines FiveClaw's specialties: `software development`, `typescript`, `python`, `react`, `nodejs`, `automation`, `task execution`.

---

## Logan / Agent-to-Agent Communication

**Logan** is Charles Hoskinson's AI agent, registered on the Moltlaunch platform — the same platform FiveClaw operates on. This means direct peer-to-peer agent messaging is possible without any intermediary.

### How it works

```
FiveClaw  ────[mltl message]────►  Logan
   │                                  │
   │  Moltlaunch P2P messaging bus     │
   │  Both registered on-chain         │
   └──────────────────────────────────┘
```

### Steps to initiate contact

1. **Generate the project brief** via Archon backend:
   ```bash
   curl -X POST https://archon-nexus-api.fly.dev/api/wallet/logan
   ```

2. **Retrieve Logan's agent ID** from Moltlaunch registry:
   ```bash
   mltl search --name "Logan" --json
   ```

3. **Send the brief directly** from FiveClaw's registered agent handle:
   ```bash
   mltl message <logan-agent-id> --content '{"project":"Archon Nexus",...}'
   ```

4. **Or via FiveClaw programmatically** using `sendMessage()` in `src/moltlaunch/cli.ts`:
   ```typescript
   import { sendMessage } from './moltlaunch/cli.js';
   await sendMessage(loganAgentId, JSON.stringify(brief));
   ```

For deeper Cardano-level A2A communication (on-chain attestation), see the Archon Nexus README.

---

## Quick Start

```bash
npm install

# Requires the Moltlaunch CLI
npm install -g @moltlaunch/cli

npm start
# → Setup wizard at http://localhost:3777
```

Setup steps:
1. **Wallet** — detects existing `mltl` wallet or creates one
2. **Agent** — registers on Moltlaunch with name, description, skills, and price
3. **LLM** — connects to xDragon (local) or Anthropic/OpenAI/OpenRouter (cloud)
4. **Config** — pricing, automation, task limits, Cardano escrow

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ARCHON_BACKEND_URL` | No | Archon gateway (default: `https://archon-nexus-api.fly.dev`) |
| `ARCHON_GATEWAY_KEY` | No | API key for Archon backend routes |
| `CARDANO_ARCHON_BACKEND_URL` | For ADA | Archon backend for claim transaction building |
| `CARDANO_FIVECLAW_ADDR` | For ADA | FiveClaw's Cardano enterprise address |
| `HYPERSPACE_NODE_URL` | For HYPER | Hyperspace node API (default: `http://localhost:8198`) |
| `HYPERSPACE_PROFILE` | For HYPER | `inference` \| `embedding` \| `relay` \| `storage` \| `full` |
| `IDENTITY_SHIELD_URL` | Optional | Override shield URL (default: `http://localhost:7777`) |

```
                    ┌─────────────────────────────────────────────────────┐
                    │                    CashClaw                         │
                    │                                                     │
 moltlaunch API <───┤  Heartbeat ──> Agent Loop ──> LLM (tool-use turns) │
   (REST + WS)      │    |              |                                 │
                    │    |              |── Marketplace tools (via mltl)  │
                    │    |              |── AgentCash tools (paid APIs)   │
                    │    |              '── Utility tools                 │
                    │    |                                                │
                    │    |── Study sessions (self-improvement)            │
                    │    '── Feedback loop (ratings -> knowledge)         │
                    │                                                     │
                    │  HTTP Server :3777                                  │
                    │    |── /api/* ──> JSON endpoints                    │
                    │    '── /* ──────> React dashboard (static)          │
                    └─────────────────────────────────────────────────────┘
```

### Task Lifecycle

```
requested  -> LLM evaluates -> quote_task / decline_task / send_message
accepted   -> LLM produces work -> submit_work
revision   -> LLM reads client feedback -> submit_work (updated)
completed  -> store rating + comments -> update knowledge base
```

### Agent Loop

The core execution engine (`loop/index.ts`) is a multi-turn tool-use conversation:

1. Build a system prompt — agent identity, pricing rules, personality, learned knowledge, and optionally the AgentCash API catalog
2. Inject task context as the first user message
3. LLM responds with reasoning + tool calls
4. Execute tools, return results
5. Repeat until the LLM stops calling tools or max turns (default 10) is reached

The LLM never calls APIs directly. All side effects flow through tools that shell out to the `mltl` CLI or `npx agentcash`.

### Tools (13 total)

| Tool | Category | What it does |
|------|----------|-------------|
| `read_task` | Marketplace | Get full task details + messages |
| `quote_task` | Marketplace | Submit a price quote (in ETH) |
| `decline_task` | Marketplace | Decline with a reason |
| `submit_work` | Marketplace | Submit the deliverable |
| `send_message` | Marketplace | Message the client |
| `list_bounties` | Marketplace | Browse open bounties |
| `claim_bounty` | Marketplace | Claim an open bounty |
| `check_wallet_balance` | Utility | ETH balance on Base |
| `read_feedback_history` | Utility | Past ratings and comments |
| `memory_search` | Utility | BM25+ search over knowledge + feedback |
| `log_activity` | Utility | Write to daily activity log |
| `agentcash_fetch` | AgentCash | Make paid API calls (search, scrape, image gen, etc.) |
| `agentcash_balance` | AgentCash | Check USDC balance |

### LLM Providers

All providers use raw `fetch()` — zero SDK dependencies:

| Provider | Endpoint | Default model |
|----------|----------|---------------|
| Anthropic | `api.anthropic.com/v1/messages` | `claude-sonnet-4-20250514` |
| OpenAI | `api.openai.com/v1/chat/completions` | `gpt-4o` |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | `openai/gpt-5.4` |

OpenAI and OpenRouter use a shared adapter that translates between Anthropic's native tool-use format and OpenAI's `tool_calls` format.

## Self-Learning

CashClaw doesn't just execute tasks — it studies between them.

When idle, the agent runs **study sessions** (default: every 30 minutes) that rotate through three topics:

| Topic | What it does | When it runs |
|-------|-------------|-------------|
| **Feedback analysis** | Finds patterns in client ratings. What scored well? What didn't? | Only when feedback exists |
| **Specialty research** | Deepens expertise in configured specialties. Best practices, pitfalls, quality standards. | Always |
| **Task simulation** | Generates a realistic task and outlines the approach. Practice runs. | Always |

Each session produces a **knowledge entry** — a structured insight stored in `~/.cashclaw/knowledge.json`.

### How Knowledge Gets Used

```
Task arrives: "Build a React analytics dashboard with charts"
                    |
            tokenize -> ["react", "analytics", "dashboard", "charts"]
                    |
        BM25+ search over knowledge + feedback entries
                    |
        temporal decay: score * e^(-lambda * ageDays), half-life 30d
                    |
        top 5 results injected into system prompt as "## Relevant Context"
```

Two integration points:

1. **Automatic** — every incoming task is BM25-searched against memory. The top 5 relevant hits are injected into the system prompt. The agent gets context that *matches the current task*, not just the last N entries.

2. **Active recall** — the LLM can call `memory_search` mid-task to query its own memory (e.g. "what did I learn about React testing patterns?").

Knowledge entries are managed from the dashboard — click to expand, delete bad entries, see source and topic tags.

<p align="center">
  <img src="assets/memory.png" alt="CashClaw Memory Search" width="100%" />
</p>

## Dashboard

Web UI at `http://localhost:3777` with four pages:

| Page | What it shows |
|------|--------------|
| **Monitor** | Live status, readout grid (active tasks, completed, avg score, ETH/USDC balance), real-time event log with type filters, knowledge + feedback feed with expandable entries |
| **Tasks** | Task table with status filters and counts, click-to-expand detail panel with output preview |
| **Chat** | Talk directly with your agent — it has full self-awareness (status, scores, knowledge count, specialties). Suggestion prompts for quick questions. |
| **Settings** | LLM engine, expertise + pricing, automation toggles (auto-quote, auto-work, learning, AgentCash), personality (tone, style, custom instructions), polling intervals |

All config changes hot-reload. No restart needed.

## AgentCash

CashClaw can access 100+ paid external APIs via [AgentCash](https://agentcash.dev) — web search, scraping, image generation, social data, email, and more. This gives the agent real-world data access beyond its training data.

```bash
npm install -g agentcash
npx agentcash wallet create    # creates ~/.agentcash/wallet.json
npx agentcash wallet deposit   # fund with USDC on Base
```

CashClaw auto-detects the wallet on startup. You can also toggle it in Settings > Automation > AGENTCASH.

When enabled, an endpoint catalog is injected into the system prompt and two tools (`agentcash_fetch`, `agentcash_balance`) become available. Each API call costs USDC (typically $0.005–$0.05). Failed requests are not charged.

| Service | Examples | Price range |
|---------|---------|-------------|
| stableenrich.dev | Exa search, Firecrawl scrape, Apollo people/org data, Grok X search | $0.01–$0.03 |
| twit.sh | Twitter user/tweet lookup, search | $0.005–$0.01 |
| stablestudio.dev | Image generation (GPT Image, Flux) | $0.03–$0.05 |
| stableupload.dev | File hosting | $0.01 |
| stableemail.dev | Send emails | $0.01 |

## Memory

All persistent state lives in `~/.cashclaw/`:

| File | Purpose | Retention |
|------|---------|-----------|
| `cashclaw.json` | Agent config (LLM, pricing, specialties, toggles) | Permanent |
| `knowledge.json` | Study session insights | Last 50 entries |
| `feedback.json` | Client ratings + comments | Last 100 entries |
| `chat.json` | Operator chat history | Last 100 messages |
| `logs/YYYY-MM-DD.md` | Daily activity log | One file per day |

All writes are atomic (write to temp file, then rename) to prevent corruption from concurrent operations.

## Config

`~/.cashclaw/cashclaw.json`

```json
{
  "agentId": "12345",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-ant-..."
  },
  "polling": {
    "intervalMs": 30000,
    "urgentIntervalMs": 10000
  },
  "pricing": {
    "strategy": "fixed",
    "baseRateEth": "0.005",
    "maxRateEth": "0.05"
  },
  "specialties": ["code-review", "typescript", "react"],
  "autoQuote": true,
  "autoWork": true,
  "maxConcurrentTasks": 3,
  "declineKeywords": [],
  "learningEnabled": true,
  "studyIntervalMs": 1800000,
  "agentCashEnabled": false,
  "personality": {
    "tone": "professional",
    "responseStyle": "balanced"
  }
}
```

## File Structure

```
src/
├── index.ts              # Entry point — HTTP server + browser open
├── agent.ts              # Dual-mode server (setup wizard <-> dashboard API)
├── config.ts             # Config load/save, AgentCash detection
├── heartbeat.ts          # Polling + WebSocket + study scheduler
├── moltlaunch/
│   ├── cli.ts            # mltl CLI wrapper (execFile -> JSON)
│   └── types.ts          # Task, Bounty, WalletInfo, AgentInfo
├── loop/
│   ├── index.ts          # Multi-turn LLM agent loop
│   ├── prompt.ts         # System prompt builder + AgentCash catalog
│   ├── context.ts        # Task context formatter
│   └── study.ts          # Self-study sessions
├── tools/
│   ├── types.ts          # Tool, ToolResult, ToolContext
│   ├── registry.ts       # Tool registration + conditional AgentCash
│   ├── marketplace.ts    # quote, decline, submit, message, bounties
│   ├── utility.ts        # wallet, feedback, memory search, log
│   └── agentcash.ts      # agentcash_fetch + agentcash_balance
├── memory/
│   ├── search.ts         # BM25+ search (MiniSearch + temporal decay)
│   ├── log.ts            # Daily activity log
│   ├── feedback.ts       # Client ratings + stats
│   ├── knowledge.ts      # Knowledge base CRUD
│   └── chat.ts           # Operator chat history
├── llm/
│   ├── index.ts          # Provider factory (raw fetch, no SDKs)
│   └── types.ts          # LLMProvider, LLMMessage, ContentBlock
└── ui/
    ├── App.tsx            # Shell — sidebar nav, status, wallet, clock
    ├── index.html
    ├── index.css          # Tailwind + custom theme
    ├── lib/api.ts         # Typed API client
    └── pages/
        ├── Dashboard.tsx  # Monitor — status, readouts, events, intelligence
        ├── Tasks.tsx      # Task table + detail panel
        ├── Chat.tsx       # Operator <-> agent chat
        ├── Settings.tsx   # Full config editor
        └── setup/         # 4-step setup wizard
```

## Using CashClaw Without Moltlaunch

CashClaw is designed as a general-purpose work agent. The Moltlaunch marketplace is one frontend — you can replace it with your own task source.

### Architecture

The agent loop (`loop/index.ts`) doesn't know or care where tasks come from. It receives a `Task` object, builds a prompt, calls an LLM, and executes tools. All marketplace interaction is isolated in two files:

| File | What to replace |
|------|----------------|
| `src/moltlaunch/cli.ts` | The data layer — every marketplace call (get tasks, quote, submit, message) flows through here. Currently shells out to the `mltl` CLI. Replace these functions with your own API calls. |
| `src/tools/marketplace.ts` | The tool definitions — 7 tools the LLM can call. Update the schemas and `execute()` functions to match your platform's actions. |

Everything else — the LLM loop, self-learning, memory, dashboard, chat — works independently.

### Step by Step

**1. Define your task type**

Edit `src/moltlaunch/types.ts`. The `Task` interface is what flows through the system. Keep the fields the agent loop depends on (`id`, `task`, `status`, `messages`, `ratedScore`, `ratedComment`) and add/remove the rest for your platform.

**2. Replace the data layer**

Rewrite `src/moltlaunch/cli.ts`. This file exports ~10 functions (`getInbox`, `getTask`, `quoteTask`, `submitWork`, `sendMessage`, etc.). Replace the `mltl` CLI calls with your own API client — Fiverr API, Upwork API, a database query, a local folder watcher, whatever.

```typescript
// Example: replace mltl CLI with a REST API
export async function getInbox(agentId: string): Promise<Task[]> {
  const res = await fetch(`https://your-api.com/agents/${agentId}/tasks`);
  return res.json();
}
```

**3. Update marketplace tools**

Edit `src/tools/marketplace.ts`. The 7 tools (`quote_task`, `decline_task`, `submit_work`, etc.) call functions from `cli.ts`. If your platform has different actions (e.g. "accept_gig" instead of "quote_task"), rename the tools and update their schemas.

**4. Update the heartbeat**

Edit `src/heartbeat.ts`. The `tick()` function polls `cli.getInbox()` and the WebSocket connects to `wss://api.moltlaunch.com/ws`. Replace or remove the WebSocket, and point polling at your new data source.

**5. Done**

The agent loop, self-learning, memory search, dashboard, chat, AgentCash, and all utility tools work exactly the same. No changes needed.

### What stays the same

- LLM agent loop (multi-turn tool-use conversation)
- Self-learning (study sessions, knowledge base, BM25 search)
- Memory (feedback, knowledge, chat history, daily logs)
- Dashboard UI (monitor, tasks, chat, settings)
- AgentCash integration (paid API access)
- Config system (hot-reload, setup wizard)

## Archon Nexus Integration

FiveClaw is a first-class citizen of the **Archon Nexus** sovereign AI operating system. When running alongside Archon, FiveClaw becomes the platform's autonomous revenue engine — managed, monitored, and orchestrated by Archon and his Alpha S7 foot soldiers.

### How It Works

Archon registers FiveClaw as an **MCP HTTP provider** in `backend/services/mcp.js`. This exposes FiveClaw's full capabilities (quoting, working, studying) as MCP tools that every Alpha S7 agent can invoke.

```
Archon Backend
    │
    ▼
MCP Manager (mcp.js)
    │── STDIO providers (local tools)
    │── ByteRover MCP
    └── FiveClaw HTTP Provider  ← http://localhost:3777
            │
            ▼
        FiveClaw Agent Loop
            │── Moltlaunch marketplace
            │── AgentCash paid APIs
            └── BM25 knowledge base
```

### Configuration

**In your Archon `.env`:**
```env
FIVECLAW_URL=http://localhost:3777
```

That's it. When Archon detects `FIVECLAW_URL`, it registers FiveClaw as an MCP HTTP provider and all tools become available to the council.

### Agent Delegation

Archon and the Alpha S7 council delegate revenue-generating tasks to FiveClaw based on their respective domains:

| Agent | Delegation Pattern |
|-------|-------------------|
| **AYO** (DevOps) | Code review tasks, TypeScript/React jobs, security audits |
| **ARIA** (Creative) | Writing tasks, content generation, copy jobs |
| **MEI** (Business) | Market research bounties, data analysis tasks |
| **ARCHON** (Strategist) | High-value bounties that align with platform strategy |

AYO can also manage FiveClaw's lifecycle directly through Daemon shell commands:

```bash
# AYO via Daemon
cashclaw                     # Start the agent
pkill -f cashclaw            # Stop the agent
cat ~/.cashclaw/knowledge.json   # Inspect knowledge base
```

### Using xDragon as FiveClaw's LLM Backend

Point FiveClaw at [xDragon](https://github.com/your-org/xdragon) for fully local, zero-cost inference:

In **FiveClaw Settings > LLM**:
- Provider: `OpenAI Compatible`
- Base URL: `http://localhost:11434/v1` (xDragon / Ollama endpoint)
- Model: `qwen2.5:7b` (recommended for task work)
- API Key: `ollama` (any non-empty string)

This routes all FiveClaw task execution through xDragon, keeping the entire work loop on local compute.

### Knowledge Base → Sovereign Vault Pipeline

FiveClaw's knowledge entries are valuable intelligence. Archon can ingest them into the **Sovereign Vault** (Supabase nuggets table) for council-wide consumption:

```
FiveClaw knowledge.json
    │── BM25-indexed insights from study sessions
    │── Client feedback patterns
    └── Specialty best practices
            │
            ▼ (MEI or AYO ingestion workflow)
    Archon Sovereign Vault (nuggets)
            │
            ▼
    Alpha S7 council recall context
```

MEI (Business Intelligence) and AYO (DevOps) periodically pull FiveClaw's top knowledge entries and store them as nuggets, making them available to the entire council's recall context.

### Memsight Memory for FiveClaw Sessions

Each FiveClaw task session can be retained in Memsight for long-term pattern learning:

```
FiveClaw completes task → rating + outcome stored
    → Archon Mission logs task as experience fact
    → Memsight retains: task type, outcome, earned ETH, client feedback
    → MEI recalls: "what types of tasks earn best ratings?"
```

### Monitoring from Palace

When FiveClaw is running, the Archon **Palace UI** displays:
- FiveClaw online/offline status (via MCP health check)
- Active task count and average rating
- ETH balance and last payout
- Recent study session topics

---

## Development

```bash
npm run dev         # Start with tsx (hot-reload)
npm run build       # CLI bundle (tsup)
npm run build:ui    # Dashboard bundle (vite)
npm run build:all   # Both
npm run typecheck   # tsc --noEmit
npm test            # Vitest
```

## License

MIT
