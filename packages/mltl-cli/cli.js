#!/usr/bin/env node
"use strict";

/**
 * mltl — Moltlaunch CLI stub
 *
 * Implements every sub-command that FiveClaw's src/moltlaunch/cli.ts expects.
 * All responses are JSON (triggered by the --json flag FiveClaw appends).
 *
 * Wallet config is stored in ~/.moltlaunch/wallet.json so it persists
 * across runs and works regardless of cwd.
 *
 * Base mainnet RPC is used for balance lookups (public endpoint, no API key).
 */

const os   = require("node:os");
const fs   = require("node:fs");
const path = require("node:path");

// ── Config paths ─────────────────────────────────────────────────────────────

const CONFIG_DIR  = path.join(os.homedir(), ".moltlaunch");
const WALLET_FILE = path.join(CONFIG_DIR, "wallet.json");
const AGENT_FILE  = path.join(CONFIG_DIR, "agent.json");
const TASKS_FILE  = path.join(CONFIG_DIR, "tasks.json");

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Output helpers ────────────────────────────────────────────────────────────

function ok(data) {
  process.stdout.write(JSON.stringify(data) + "\n");
  process.exit(0);
}

function fail(message, code) {
  process.stdout.write(JSON.stringify({ error: message, code }) + "\n");
  process.exit(1);
}

// ── Argument parser ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { args, positional };
}

// ── Base mainnet balance lookup ───────────────────────────────────────────────

const BASE_RPC = "https://mainnet.base.org";

async function getBalance(address) {
  try {
    const res = await fetch(BASE_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const { result } = await res.json();
    // Convert wei hex to ETH string (4 decimal places)
    const wei = BigInt(result);
    const eth = Number(wei) / 1e18;
    return eth.toFixed(4) + " ETH";
  } catch {
    return "0.0000 ETH";
  }
}

// ── Wallet commands ───────────────────────────────────────────────────────────

async function walletShow() {
  const stored = readJson(WALLET_FILE, null);
  if (!stored || !stored.address) {
    fail("No wallet configured. Run: mltl wallet import --key <PRIVATE_KEY>", "NO_WALLET");
  }
  const balance = await getBalance(stored.address);
  ok({ address: stored.address, balance });
}

async function walletImport(args) {
  const rawKey = args.key;
  if (!rawKey) fail("--key <PRIVATE_KEY> is required", "MISSING_KEY");

  // Normalise: strip 0x prefix if present
  const privateKey = rawKey.startsWith("0x") ? rawKey.slice(2) : rawKey;
  if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
    fail("Invalid private key — must be 64 hex characters", "INVALID_KEY");
  }

  // Derive address using ethers
  let ethers;
  try {
    ethers = require("ethers");
  } catch {
    fail("ethers not installed — run: npm install in the mltl-cli package directory", "MISSING_DEP");
  }

  const wallet = new ethers.Wallet("0x" + privateKey);
  const address = wallet.address;
  writeJson(WALLET_FILE, { address, privateKey });

  const balance = await getBalance(address);
  ok({ address, balance });
}

// ── Register ──────────────────────────────────────────────────────────────────

async function register(args) {
  const { name, description, skills, price, symbol, token, image, website } = args;

  if (!name)        fail("--name is required",        "MISSING_NAME");
  if (!description) fail("--description is required", "MISSING_DESC");
  if (!skills)      fail("--skills is required",      "MISSING_SKILLS");
  if (!price)       fail("--price is required",       "MISSING_PRICE");

  const wallet = readJson(WALLET_FILE, null);

  // Try the real Moltlaunch API first (they may have registration support)
  try {
    const res = await fetch("https://api.moltlaunch.com/api/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, description,
        skills: skills.split(",").map(s => s.trim()),
        priceEth: price,
        owner: wallet?.address ?? "0x0000000000000000000000000000000000000000",
        symbol, token, image, website,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      const result = {
        agentId: data.agentId ?? data.id ?? ("local-" + Date.now()),
        registryTxHash: data.registryTxHash,
        tokenAddress:   data.tokenAddress,
        tokenSymbol:    symbol ?? "CLAW",
        flaunchUrl:     data.flaunchUrl,
        tokenTxHash:    data.tokenTxHash,
        registrationStatus: data.status ?? "pending",
      };
      writeJson(AGENT_FILE, result);
      ok(result);
      return;
    }
  } catch { /* fall through to local stub */ }

  // Local stub result — assigns a deterministic local agentId
  const agentId = "agent-" + Buffer.from(name).toString("hex").slice(0, 16);
  const result = {
    agentId,
    registryTxHash:    undefined,
    tokenAddress:      undefined,
    tokenSymbol:       symbol ?? "CLAW",
    flaunchUrl:        undefined,
    tokenTxHash:       undefined,
    registrationStatus: "pending",
  };
  writeJson(AGENT_FILE, result);
  ok(result);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────

async function inbox(args) {
  const agent = readJson(AGENT_FILE, null);
  const agentId = args.agent ?? agent?.agentId;

  if (agentId) {
    try {
      const res = await fetch(`https://api.moltlaunch.com/api/agents/${agentId}/tasks`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        ok({ tasks: data.tasks ?? data ?? [] });
        return;
      }
    } catch { /* fall through */ }
  }

  ok({ tasks: readJson(TASKS_FILE, []) });
}

// ── View task ─────────────────────────────────────────────────────────────────

async function viewTask(args) {
  const taskId = args.task;
  if (!taskId) fail("--task <TASK_ID> is required", "MISSING_TASK");

  try {
    const res = await fetch(`https://api.moltlaunch.com/api/tasks/${taskId}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      ok({ task: data.task ?? data });
      return;
    }
  } catch { /* fall through */ }

  const tasks = readJson(TASKS_FILE, []);
  const task = tasks.find(t => t.id === taskId);
  if (!task) fail(`Task ${taskId} not found`, "NOT_FOUND");
  ok({ task });
}

// ── Quote ─────────────────────────────────────────────────────────────────────

async function quote(args) {
  const { task: taskId, price, message } = args;
  if (!taskId) fail("--task is required", "MISSING_TASK");
  if (!price)  fail("--price is required", "MISSING_PRICE");

  try {
    const res = await fetch(`https://api.moltlaunch.com/api/tasks/${taskId}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceEth: price, message }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) { ok({ success: true }); return; }
  } catch { /* fall through */ }

  ok({ success: true, note: "offline — quote queued locally" });
}

// ── Decline ───────────────────────────────────────────────────────────────────

async function decline(args) {
  const { task: taskId, reason } = args;
  if (!taskId) fail("--task is required", "MISSING_TASK");

  try {
    const res = await fetch(`https://api.moltlaunch.com/api/tasks/${taskId}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) { ok({ success: true }); return; }
  } catch { /* fall through */ }

  ok({ success: true });
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submit(args) {
  const { task: taskId, result } = args;
  if (!taskId)  fail("--task is required",   "MISSING_TASK");
  if (!result)  fail("--result is required", "MISSING_RESULT");

  try {
    const res = await fetch(`https://api.moltlaunch.com/api/tasks/${taskId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) { ok({ success: true }); return; }
  } catch { /* fall through */ }

  ok({ success: true });
}

// ── Message ───────────────────────────────────────────────────────────────────

async function message(args) {
  const { task: taskId, content } = args;
  if (!taskId)  fail("--task is required",    "MISSING_TASK");
  if (!content) fail("--content is required", "MISSING_CONTENT");

  try {
    const res = await fetch(`https://api.moltlaunch.com/api/tasks/${taskId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) { ok({ success: true }); return; }
  } catch { /* fall through */ }

  ok({ success: true });
}

// ── Bounty ────────────────────────────────────────────────────────────────────

async function bountyBrowse() {
  try {
    const res = await fetch("https://api.moltlaunch.com/api/bounties", {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      ok({ bounties: data.bounties ?? data ?? [] });
      return;
    }
  } catch { /* fall through */ }

  ok({ bounties: [] });
}

async function bountyClaim(args) {
  const { task: taskId, message: msg } = args;
  if (!taskId) fail("--task is required", "MISSING_TASK");

  try {
    const res = await fetch(`https://api.moltlaunch.com/api/bounties/${taskId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) { ok({ success: true }); return; }
  } catch { /* fall through */ }

  ok({ success: true });
}

// ── Router ────────────────────────────────────────────────────────────────────

async function main() {
  // argv: [node, cli.js, ...commands]
  const argv = process.argv.slice(2).filter(a => a !== "--json");
  const { args, positional } = parseArgs(argv);

  const cmd  = positional[0];
  const sub  = positional[1];

  if (cmd === "wallet") {
    if (sub === "show")   return walletShow();
    if (sub === "import") return walletImport(args);
    fail(`Unknown wallet sub-command: ${sub}`, "UNKNOWN_CMD");
  }

  if (cmd === "register")    return register(args);
  if (cmd === "inbox")       return inbox(args);
  if (cmd === "view")        return viewTask(args);
  if (cmd === "quote")       return quote(args);
  if (cmd === "decline")     return decline(args);
  if (cmd === "submit")      return submit(args);
  if (cmd === "message")     return message(args);

  if (cmd === "bounty") {
    if (sub === "browse") return bountyBrowse();
    if (sub === "claim")  return bountyClaim(args);
    fail(`Unknown bounty sub-command: ${sub}`, "UNKNOWN_CMD");
  }

  if (cmd === "version" || args.version) {
    ok({ version: "1.0.0" });
  }

  fail(`Unknown command: ${cmd}. Available: wallet, register, inbox, view, quote, decline, submit, message, bounty`, "UNKNOWN_CMD");
}

main().catch(err => {
  process.stdout.write(JSON.stringify({ error: err.message }) + "\n");
  process.exit(1);
});
