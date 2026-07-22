import { neon } from '@neondatabase/serverless';

export function db() {
  return neon(process.env.DATABASE_URL);
}
