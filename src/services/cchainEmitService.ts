import { Kafka, Producer, logLevel } from 'kafkajs';
import { notifyCchainDeposit } from './cchainOrderService';
import type { CchainDepositEvent } from './cchainEmitServiceTypes';

export type { CchainDepositEvent };

let producer: Producer | null = null;

async function getProducer(): Promise<Producer | null> {
  if (producer) return producer;
  const brokers = (process.env.KAFKA_BROKERS || '').trim();
  if (!brokers) return null;
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'avaramp-cchain',
    brokers: brokers.split(','),
    logLevel: logLevel.WARN,
  });
  producer = kafka.producer();
  try {
    await producer.connect();
  } catch (err) {
    console.error('[CchainListener] Kafka connect failed, fallback only:', (err as Error).message);
    producer = null;
  }
  return producer;
}

/**
 * Emit a confirmed C-Chain deposit; attempts Kafka (`avaramp.cchain_token_in`)
 * then falls back to the configured HTTP endpoint, and always notifies the
 * in-process order-correlation/sweep handler so funds are not lost even with no
 * broker/failover configured.
 */
export async function emitCchainDeposit(
  event: CchainDepositEvent
): Promise<{ emitted: boolean }> {
  let delivered = false;

  if (process.env.KAFKA_BROKERS?.trim()) {
    const p = await getProducer();
    if (p) {
      try {
        await p.send({
          topic: process.env.KAFKA_TOKEN_IN_TOPIC || 'avaramp.cchain_token_in',
          messages: [{ key: String(event.depositId), value: JSON.stringify(event) }],
        });
        delivered = true;
      } catch (err) {
        console.error(`[CchainListener] Kafka emit error: ${(err as Error).message}`);
      }
    }
  }

  if (!delivered && process.env.CCHAIN_LISTENER_FALLBACK_URL) {
    try {
      const res = await fetch(process.env.CCHAIN_LISTENER_FALLBACK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.CCHAIN_LISTENER_FALLBACK_AUTH_TOKEN
            ? { Authorization: `Bearer ${process.env.CCHAIN_LISTENER_FALLBACK_AUTH_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(Number(process.env.CALLBACK_TIMEOUT_MS || 10000)),
      });
      delivered = res.ok;
      if (!res.ok) console.error(`[CchainListener] Fallback POST failed: status=${res.status}`);
    } catch (err) {
      console.error(`[CchainListener] Fallback POST error: ${(err as Error).message}`);
    }
  }

  // In-process handler guarantees the deposit reaches the sweep/correlation step.
  try {
    await notifyCchainDeposit(event);
  } catch (err) {
    console.error(`[CchainListener] In-process handler error: ${(err as Error).message}`);
  }

  return { emitted: delivered };
}