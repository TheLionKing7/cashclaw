import { createHash } from "node:crypto";

/**
 * CardanoEscrowClient — FiveClaw's Cardano payment bridge.
 *
 * Coordinates with the Archon backend (/api/cardano/*) to:
 *  1. Register client-created escrow locks (job ID ↔ UTxO mapping)
 *  2. Claim locked ADA after job completion via Archon + Identity Shield
 *  3. Submit signed transactions back to the chain
 *
 * The Plutus validator (FiveClawPay.hs) ensures ADA can only be claimed
 * when FiveClaw's Ed25519 key signs the completion hash of the deliverable.
 */

export interface EscrowLock {
  jobId: string;
  txHash: string;
  txIndex: number;
  amountLovelace: string;
  lockedAt: number;
}

export interface ClaimResult {
  success: boolean;
  txHash?: string;
  /** Pre-built unsigned CBOR — submit via cardano-cli when Lucid is unavailable */
  cbor?: string;
  /** cardano-cli command template for manual submission */
  instructions?: string;
  error?: string;
}

export class CardanoEscrowClient {
  private readonly archonUrl: string;
  private readonly gatewayKey: string;
  /** In-process lock registry — survives the session, resets on daemon restart */
  private readonly locks = new Map<string, EscrowLock>();

  constructor(archonUrl: string, gatewayKey: string) {
    this.archonUrl = archonUrl.replace(/\/$/, "");
    this.gatewayKey = gatewayKey;
  }

  /**
   * Register a client-created UTxO escrow against a moltlaunch job ID.
   * The client calls this (via POST /api/cardano-lock on FiveClaw's local agent)
   * after locking ADA into the FiveClawPay validator.
   */
  async register(
    jobId: string,
    txHash: string,
    txIndex: number,
    amountLovelace: string,
  ): Promise<void> {
    const lock: EscrowLock = {
      jobId,
      txHash,
      txIndex,
      amountLovelace,
      lockedAt: Date.now(),
    };
    this.locks.set(jobId, lock);

    // Notify Archon for dashboard tracking (best-effort, non-fatal)
    try {
      await fetch(`${this.archonUrl}/api/cardano/escrow/notify`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jobId, txHash, txIndex, amountLovelace }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Non-fatal — retry happens on claim
    }
  }

  hasPendingEscrow(jobId: string): boolean {
    return this.locks.has(jobId);
  }

  getEscrow(jobId: string): EscrowLock | undefined {
    return this.locks.get(jobId);
  }

  /**
   * Hash the job deliverable (reasoning + tool summary) so the Plutus validator
   * can verify the claim is tied to real work output.
   * Uses SHA-256 (matches the validator's sha2_256 check in AgentAttest.hs).
   */
  static hashDeliverable(reasoning: string, toolSummary: string): string {
    return createHash("sha256")
      .update(`${reasoning}|${toolSummary}`, "utf8")
      .digest("hex");
  }

  /**
   * Claim locked ADA after job work is complete.
   *
   * Archon backend calls Identity Shield /attest to create the Ed25519 signature,
   * then builds the claim tx using Lucid (auto-submits) or cardano-cli (returns CBOR).
   *
   * @param jobId           - moltlaunch job ID
   * @param completionHash  - sha256(deliverable) hex from CardanoEscrowClient.hashDeliverable()
   * @param agentPrivKeyHex - Ed25519 private key hex (from FIVECLAW_CARDANO_PRIV_KEY env var)
   */
  async claim(
    jobId: string,
    completionHash: string,
    agentPrivKeyHex: string,
  ): Promise<ClaimResult> {
    const lock = this.locks.get(jobId);
    if (!lock) {
      return { success: false, error: `No Cardano escrow registered for job ${jobId}` };
    }

    try {
      const res = await fetch(`${this.archonUrl}/api/cardano/escrow/claim`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          jobId,
          txHash: lock.txHash,
          txIndex: lock.txIndex,
          completionHash,
          agentId: "fiveclaw",
          agentPrivKeyHex,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, error: err.error ?? res.statusText };
      }

      const data = (await res.json()) as {
        status?: string;
        cbor?: string;
        txHash?: string;
        instructions?: string;
      };

      // Lucid submitted the tx automatically
      if (data.status === "submitted" && data.txHash) {
        this.locks.delete(jobId);
        return { success: true, txHash: data.txHash };
      }

      // cardano-cli path: try to auto-submit via Archon, fall back to returning CBOR
      if (data.status === "manual" && data.cbor) {
        const submitted = await this.submitTx(data.cbor);
        if (submitted) {
          this.locks.delete(jobId);
          return { success: true, txHash: submitted };
        }
        // Leave lock in place — operator can retry
        return {
          success: true,
          cbor: data.cbor,
          instructions: data.instructions,
        };
      }

      return { success: false, error: "Unexpected claim response from Archon" };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Private helpers ───────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Archon-Gateway-Key": this.gatewayKey,
    };
  }

  private async submitTx(cbor: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.archonUrl}/api/cardano/tx/submit`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ cbor }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { txHash?: string };
      return data.txHash ?? null;
    } catch {
      return null;
    }
  }
}
