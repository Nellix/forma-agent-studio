import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// A persistent, loopback-only demo. Existing authentication settings are retained.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
process.env.HOST = '127.0.0.1';
process.env.PORT ??= '3000';
process.env.DATABASE_URL = 'pglite://.data/local';
process.env.DEMO_MODE = 'true';
process.env.EMBEDDED_WORKER = 'true';
if (process.env.NODE_ENV === 'production') {
  throw new Error('Use npm start with PostgreSQL in production. This command is for local testing.');
}
await mkdir('.data', { recursive: true });
if (!process.env.ENCRYPTION_KEY) {
  const keyFile = '.data/local-encryption-key';
  try {
    await writeFile(keyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  process.env.ENCRYPTION_KEY = (await readFile(keyFile, 'utf8')).trim();
}
await import('../dist/server/main.js');
