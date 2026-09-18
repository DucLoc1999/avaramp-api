import { cancelExpiredOrders, ORDER_EXPIRY_MS } from './orderService';

const LOG_PREFIX = '[OrderExpiryScheduler]';

/** Poll interval: check every 30 seconds. */
const POLL_INTERVAL_MS = 30_000;

async function tick() {
  try {
    const count = await cancelExpiredOrders();
    if (count > 0) {
      console.log(`${LOG_PREFIX} Auto-cancelled ${count} expired order(s)`);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Error:`, err);
  }
}

export function startOrderExpiryScheduler(): NodeJS.Timeout {
  const expiryMin = ORDER_EXPIRY_MS / 60_000;
  console.log(`${LOG_PREFIX} Started (order expiry: ${expiryMin}min, poll: ${POLL_INTERVAL_MS / 1000}s)`);
  tick(); // run once immediately
  return setInterval(tick, POLL_INTERVAL_MS);
}
