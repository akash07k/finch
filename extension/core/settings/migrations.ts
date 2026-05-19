/**
 * @module settings/migrations
 *
 * One-shot settings migrations. Each runs at most once per profile,
 * gated by a marker key in browser.storage.local. Migrations run
 * BEFORE module init in background.ts so modules read the migrated
 * shape, not the legacy one.
 */

import type { Logger } from "@oriole/logger";

/**
 * A single migration. The runner checks `id` against a marker key in
 * browser.storage.local; the migration runs only when the marker is
 * absent. After `run()` resolves, the runner writes the marker so the
 * migration is skipped on subsequent boots.
 */
interface Migration {
  /** Marker key. Migration runs only when this key is absent. */
  id: string;

  /** Run the migration. Should be idempotent. */
  run(logger: Logger): Promise<void>;
}

/**
 * Migrations in declaration order. Add a new migration by appending
 * an entry; do not reorder existing entries. The marker key is the
 * only durable record that a migration ran, so renaming an `id`
 * effectively re-runs the migration on every existing profile.
 */
const MIGRATIONS: Migration[] = [
  {
    id: "_migrations.windowsFocusSplit",
    /**
     * Splits the legacy `sounds.events.windows.onFocusChanged` config
     * into `sounds.events.windows.onFocused`. Existing user settings
     * (enabled flag, volume, pitch) follow the focused side because the
     * original sound was tuned to be a focus-gain cue. The legacy key
     * is removed so it cannot drift back into the registry view.
     */
    async run(logger) {
      const stored = await browser.storage.local.get([
        "sounds.events.windows.onFocusChanged",
        "sounds.events.windows.onFocused",
      ]);

      const legacy = stored["sounds.events.windows.onFocusChanged"];
      const alreadyMigrated = stored["sounds.events.windows.onFocused"] !== undefined;

      if (legacy !== undefined && !alreadyMigrated) {
        await browser.storage.local.set({
          "sounds.events.windows.onFocused": legacy,
        });
        logger.info("Migrated legacy windows.onFocusChanged config to windows.onFocused", {
          migration: "windowsFocusSplit",
        });
      }

      await browser.storage.local.remove("sounds.events.windows.onFocusChanged");
    },
  },
];

/**
 * Run all pending migrations in declaration order. A migration whose
 * marker key is already present in storage is skipped. After a
 * migration's `run()` resolves, its marker is written so subsequent
 * boots skip it.
 *
 * Errors from a single migration are caught and logged; later
 * migrations still run. The marker is only written on success, so a
 * failed migration retries on the next boot.
 */
export async function runMigrations(logger: Logger): Promise<void> {
  const markerKeys = MIGRATIONS.map((m) => m.id);
  const stored = await browser.storage.local.get(markerKeys);

  for (const migration of MIGRATIONS) {
    if (stored[migration.id]) continue;

    try {
      await migration.run(logger);
      await browser.storage.local.set({ [migration.id]: true });
    } catch (error) {
      logger.error(`Migration failed: ${migration.id}`, error instanceof Error ? error : undefined);
    }
  }
}
