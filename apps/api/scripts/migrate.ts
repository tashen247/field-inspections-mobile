import { runMigrations } from '@fim/db';
import { resolveDatabaseUrl } from '../src/config.js';

const url = resolveDatabaseUrl(process.env);
if (!url) throw new Error('DATABASE_URL is not set');
await runMigrations(url);
console.log('migrations applied');
