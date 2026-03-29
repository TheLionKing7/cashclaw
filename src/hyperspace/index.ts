/**
 * Hyperspace idle-compute client for FiveClaw.
 *
 * When FiveClaw has no active tasks, it contributes compute to the Hyperspace
 * P2P inference network via the local hyperspace-x-node daemon.
 * Points (HYPER) accumulate automatically and convert to USDC.
 *
 * The daemon itself is a separate process managed by hyperspace-x-node.
 * This module is a thin HTTP client that talks to its REST API.
 */

import type { HyperspaceConfig } from "../config.js";

export interface WalletInfo {
  points: number;
  usdc: number;
  raw: string;
}

export interface NodeStatus {
  running: boolean;
  profile: string;
  uptime: number;
  error?: string;
}

let _contributing = false;
let _config: HyperspaceConfig | undefined;

/** Initialise — call once when agent starts up (noop if no hyperspace config). */
export function initHyperspace(config: HyperspaceConfig | undefined): void {
  _config = config;
}

function buildHeaders(cfg: HyperspaceConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.gatewayKey) headers["x-archon-gateway-key"] = cfg.gatewayKey;
  return headers;
}

/** `true` when compute contribution is currently active. */
export function isContributing(): boolean {
  return _contributing;
}

/**
 * Start contributing compute to Hyperspace.
 * Safe to call when already contributing — returns immediately.
 */
export async function startHyperspaceContribution(): Promise<void> {
  if (!_config) return;
  if (_contributing) return;

  try {
    const res = await fetch(`${_config.nodeUrl}/start`, {
      method: "POST",
      headers: buildHeaders(_config),
      body: JSON.stringify({ profile: _config.profile ?? "inference" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      _contributing = true;
    }
  } catch {
    // Hyperspace node is offline — silently ignore, will retry next idle cycle
  }
}

/**
 * Stop contributing compute to Hyperspace.
 * Must be called before starting a task so GPU/CPU is freed for work.
 * Safe to call when not contributing — returns immediately.
 */
export async function stopHyperspaceContribution(): Promise<void> {
  if (!_config) return;
  if (!_contributing) return;

  try {
    const res = await fetch(`${_config.nodeUrl}/stop`, {
      method: "POST",
      headers: buildHeaders(_config),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      _contributing = false;
    }
  } catch {
    // If stop fails, assume it stopped anyway — we don't want to block task work
    _contributing = false;
  }
}

/** Fetch wallet balance (HYPER points + USDC). Returns null if daemon is unreachable. */
export async function getHyperspaceEarnings(): Promise<WalletInfo | null> {
  if (!_config) return null;

  try {
    const res = await fetch(`${_config.nodeUrl}/wallet`, {
      headers: buildHeaders(_config),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { points?: number; usdc?: number; raw?: string };
    return {
      points: data.points ?? 0,
      usdc: data.usdc ?? 0,
      raw: data.raw ?? "",
    };
  } catch {
    return null;
  }
}

/** Fetch node status (running, profile, uptime). Returns null if daemon is unreachable. */
export async function getHyperspaceStatus(): Promise<NodeStatus | null> {
  if (!_config) return null;

  try {
    const res = await fetch(`${_config.nodeUrl}/status`, {
      headers: buildHeaders(_config),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NodeStatus;
    // Sync local state with daemon reality
    _contributing = data.running;
    return data;
  } catch {
    return null;
  }
}
