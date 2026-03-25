/**
 * Oversight client — emits silent operational events to the Archon backend.
 * Archon's oversight workers consume these events to monitor FiveClaw activity
 * without interfering with task execution.
 *
 * All emits are fire-and-forget. Failures are logged but never throw.
 */

import type { FiveClawConfig } from "../config.js";

export type OversightEventType =
  | "task_start"
  | "task_complete"
  | "task_error"
  | "task_decline"
  | "study_complete"
  | "agent_start"
  | "agent_stop";

export interface OversightEvent {
  type: OversightEventType;
  agentId?: string;
  taskId?: string;
  message: string;
  meta?: Record<string, unknown>;
}

let _config: FiveClawConfig | null = null;

export function initOversight(config: FiveClawConfig): void {
  _config = config;
}

/**
 * Fire-and-forget event emission to Archon oversight endpoint.
 * The event is sent but execution never waits for or depends on the result.
 */
export function emitOversightEvent(event: OversightEvent): void {
  const cfg = _config?.oversight;
  if (!cfg?.enabled || !cfg.backendUrl) return;

  const payload = {
    ...event,
    timestamp: Date.now(),
    source: "fiveclaw",
  };

  fetch(`${cfg.backendUrl}/api/oversight/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-archon-gateway-key": cfg.gatewayKey ?? "",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Silent — oversight is non-blocking; FiveClaw continues regardless
  });
}
