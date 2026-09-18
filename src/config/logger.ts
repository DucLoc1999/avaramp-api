/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import pino, { type DestinationStream } from 'pino';
import path from 'path';
import fs from 'fs';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const getCurrentDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getLogFilePath = (date?: string): string => {
  const dateStr = date || getCurrentDateString();
  return path.join(logsDir, `${dateStr}.log`);
};

const logFilePath = getLogFilePath();
const fileStream = pino.destination({
  dest: logFilePath,
  sync: true,
  mkdir: true,
});

// Determine if we're in development mode
const isDevelopment = process.env.NODE_ENV !== 'production';

// Use pino-pretty only in development, plain JSON in production
const consoleStream: DestinationStream = isDevelopment
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    })
  : process.stdout;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    {
      level: process.env.LOG_LEVEL || 'info',
      stream: consoleStream,
    },
    {
      level: process.env.LOG_LEVEL || 'info',
      stream: fileStream,
    },
  ])
);

export const rotateLogsIfNeeded = (): void => {
  const currentLogFile = getLogFilePath();

  if (!fs.existsSync(currentLogFile)) {
    fs.writeFileSync(currentLogFile, '');
  }
};

setInterval(
  () => {
    rotateLogsIfNeeded();
  },
  60 * 60 * 1000
);

export default logger;
