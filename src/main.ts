#!/usr/bin/env node
import { loadConfig } from './core/config';
import { loadEnvFile } from './core/env';
import { createLogger } from './core/logger';
import { Nova } from './nova';

async function main(): Promise<void> {
  loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const nova = new Nova(config, { logger: createLogger(config.logLevel) });
  try {
    await nova.start();
  } catch (error) {
    nova.logger.error('Nova', `Could not start on port ${config.port}`, error);
    process.exit(1);
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    nova.logger.info('Nova', `${signal} received, shutting down`);
    await nova.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
