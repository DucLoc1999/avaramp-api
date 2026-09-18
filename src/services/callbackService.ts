import crypto from 'crypto';
import db from '../db';
import type { WebhookEvent } from '../models/webhook';

const TIMEOUT_MS = parseInt(process.env.CALLBACK_TIMEOUT_MS || '8000');
const MAX_RETRIES = parseInt(process.env.CALLBACK_RETRY_COUNT || '3');
const RETRY_DELAY_MS = parseInt(process.env.CALLBACK_RETRY_DELAY_MS || '5000');
const SIGNATURE_SECRET = process.env.CALLBACK_SIGNATURE_SECRET;
const ROTATION_WINDOW_MS = 5 * 60 * 1000;

interface DualSecretConfig {
  current: string | null;
  previous: string | null;
  rotatedAt: Date | null;
}

async function getDualSecretConfig(): Promise<DualSecretConfig> {
  try {
    const rows = await db('config').whereIn('key', ['callback_secret_current', 'callback_secret_previous', 'callback_secret_rotated_at']).select('key', 'value');

    const config: DualSecretConfig = { current: null, previous: null, rotatedAt: null };

    for (const row of rows) {
      if (row.key === 'callback_secret_current') config.current = row.value;
      if (row.key === 'callback_secret_previous') config.previous = row.value;
      if (row.key === 'callback_secret_rotated_at') config.rotatedAt = row.value ? new Date(row.value) : null;
    }

    if (!config.current) {
      console.log('[Callback] No DB secret found, falling back to CALLBACK_SIGNATURE_SECRET env var');
      config.current = SIGNATURE_SECRET || null;
    }

    if (!config.current) {
      console.warn('[Callback] WARNING: No signing secret configured — callbacks will be sent unsigned');
    }

    return config;
  } catch (err) {
    console.error('[Callback] getDualSecretConfig DB error, falling back to env var:', err);
    return { current: SIGNATURE_SECRET || null, previous: null, rotatedAt: null };
  }
}

function computeSignature(secret: string, timestamp: string, body: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

async function postCallback(
  callbackUrl: string,
  payload: WebhookEvent,
  attempt: number
): Promise<{ success: boolean; status?: number; error?: string }> {
  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const secretConfig = await getDualSecretConfig();

  let signature: string | null = null;

  if (secretConfig.current) {
    signature = computeSignature(secretConfig.current, timestamp, body);
  } else {
    console.warn(`[Callback] No secret available — sending unsigned callback to ${callbackUrl}`);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Timestamp': timestamp,
  };

  if (signature) {
    headers['X-Signature'] = signature;
  }

  console.log(`[Callback] POST attempt=${attempt} url=${callbackUrl} timestamp=${timestamp} hasSig=${!!signature} orderId=${payload.payload?.order_id} topic=${payload.topic}`);

  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.ok) {
      console.log(`[Callback] SUCCESS status=${response.status} url=${callbackUrl}`);
      return { success: true, status: response.status };
    }

    let responseBody = '';
    try { responseBody = await response.text(); } catch { /* ignore */ }
    console.error(`[Callback] FAILED status=${response.status} url=${callbackUrl} body=${responseBody}`);
    return { success: false, status: response.status, error: `HTTP ${response.status}: ${responseBody}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    console.error(`[Callback] FETCH ERROR url=${callbackUrl} timeout=${isTimeout} error=${error}`);
    return { success: false, error };
  }
}

export async function fireCallback(
  callbackUrl: string,
  orderId: string | number,
  oldState: number,
  newState: number,
  oldProcessingState?: number | null,
  newProcessingState?: number | null,
  txHash?: string | null
): Promise<void> {
  if (!callbackUrl) return;

  const payload: WebhookEvent = {
    id: String(orderId),
    topic: 'order.state_changed',
    ts: new Date().toISOString(),
    payload: {
      order_id: String(orderId),
      old_order_state: oldState,
      new_order_state: newState,
      transaction_hash: txHash,
    },
  };

  if (typeof oldProcessingState === 'number') {
    payload.payload.old_order_processing_state = oldProcessingState;
  }
  if (typeof newProcessingState === 'number') {
    payload.payload.new_order_processing_state = newProcessingState;
  }

  console.log(`[Callback] fireCallback orderId=${orderId} url=${callbackUrl} stateChange=${oldState}→${newState}`);

  let logId: number | undefined;

  try {
    const [entry] = await db('callback_logs')
      .insert({
        order_id: Number(orderId),
        callback_url: callbackUrl,
        payload: JSON.stringify(payload),
        attempts: 0,
        status: 'pending',
      })
      .returning('id');
    logId = entry.id;
  } catch {
    console.error('[Callback] Failed to create log entry');
  }

  let lastError: string = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[Callback] Attempt ${attempt}/${MAX_RETRIES} for order ${orderId}`);
    const result = await postCallback(callbackUrl, payload, attempt);

    if (logId) {
      try {
        await db('callback_logs')
          .where({ id: logId })
          .update({
            attempts: attempt,
            last_attempt_at: db.fn.now(),
            status: result.success ? 'success' : 'pending',
          });
      } catch {
        console.error('[Callback] Failed to update log entry');
      }
    }

    if (result.success) {
      if (logId) {
        try {
          await db('callback_logs')
            .where({ id: logId })
            .update({ status: 'success' });
        } catch {
          console.error('[Callback] Failed to mark log as success');
        }
      }
      return;
    }

    lastError = result.error || `HTTP ${result.status}`;

    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  if (logId) {
    try {
      await db('callback_logs')
        .where({ id: logId })
        .update({ status: 'failed' });
    } catch {
      console.error('[Callback] Failed to mark log as failed');
    }
  }

  console.error(`[Callback] Failed after ${MAX_RETRIES} attempts for order ${orderId}:`, lastError);
}
