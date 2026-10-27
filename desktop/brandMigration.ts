import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const packaged = new URL('./migrate-user-data.cjs', import.meta.url);
const { migrateUserData } = createRequire(import.meta.url)(existsSync(packaged) ? './migrate-user-data.cjs' : '../scripts/migrate-user-data.cjs');
if (!process.env.VITEST && !process.env.NODE_TEST_CONTEXT) migrateUserData();
