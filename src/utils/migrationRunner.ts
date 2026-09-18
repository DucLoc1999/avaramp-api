import db from '../db';
import { logger } from '../config/logger';

export async function runMigrations(): Promise<void> {
  const [, log] = await db.migrate.latest();
  if (log.length > 0) {
    logger.info({ migrations: log }, `Ran ${log.length} migration(s)`);
  }
}
