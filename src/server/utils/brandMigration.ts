import { createRequire } from 'node:module';

const migration = createRequire(import.meta.url)('../../../scripts/migrate-user-data.cjs') as {
  migrateUserData(): void;
  migrateProjectData(root: string): void;
};
export const migrateProjectData = migration.migrateProjectData;
const { migrateUserData } = migration;
if (!process.env.VITEST && !process.env.NODE_TEST_CONTEXT) migrateUserData();
