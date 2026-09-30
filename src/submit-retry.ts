/**
 * Retry helper for transient transaction-submission failures.
 *
 * The wallet SDK talks to the node over a WebSocket relay that is periodically
 * torn down and re-established. If a submission lands in that window it fails
 * with a clean close rather than a chain-level rejection:
 *
 *   SubmissionError: Transaction submission failed
 *     disconnected from wss://rpc.<network>.midnight.network/: 1000:: Normal Closure
 *
 * That is transient and worth retrying — the proof is already built, so a retry
 * only re-submits. Genuine rejections (insufficient funds, a failed assert, an
 * invalid transaction) are rethrown immediately so real bugs stay loud.
 */

const TRANSIENT = [
  /normal closure/i,
  /disconnected from/i,
  /submission error/i,
  /transaction submission failed/i,
  /socket hang up/i,
  /websocket is not connected/i,
];

function flatten(err: unknown, depth = 0): string {
  if (!err || depth > 5) return '';
  const e = err as { message?: string; cause?: unknown };
  return [e.message ?? String(err), flatten(e.cause, depth + 1)].join(' ');
}

export function isTransientSubmissionError(err: unknown): boolean {
  const text = flatten(err);
  // A chain-level rejection can still mention "submission"; these never are.
  if (/insufficient|not enough dust|already stamped|already voted|out of range|poll is closed/i.test(text)) {
    return false;
  }
  return TRANSIENT.some((re) => re.test(text));
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  label?: string;
  onRetry?: (attempt: number, err: unknown) => void;
}

/** Runs `fn`, retrying only transient submission failures. */
export async function withSubmissionRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 4, delayMs = 4000, label = 'submission', onRetry } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientSubmissionError(err) || attempt === attempts) throw err;
      onRetry?.(attempt, err);
      console.log(`  ${label}: relay socket closed mid-submit (attempt ${attempt}/${attempts}); retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
