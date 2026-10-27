/** Device identity must be migrated before any new identity can be generated. */
export function waitForBrandMigration(): Promise<void> {
  return (globalThis as typeof globalThis & { veymuxMigrationReady?: Promise<void> }).veymuxMigrationReady ?? Promise.resolve();
}
