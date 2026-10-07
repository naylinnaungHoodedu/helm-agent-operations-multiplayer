import { openDB } from "idb";
import type { ScenarioId } from "@helm/content-schema";
import type { SaveGameV1 } from "@helm/sim-core";

const DB_NAME = "helm-sim-db";
const STORE_NAME = "save-games";
const autosaveKey = (scenarioId: ScenarioId) => `autosave:${scenarioId}`;

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  }
});

export const loadAutosave = async (scenarioId: ScenarioId): Promise<SaveGameV1 | null> => {
  const db = await dbPromise;
  return (await db.get(STORE_NAME, autosaveKey(scenarioId))) ?? null;
};

export const saveAutosave = async (saveGame: SaveGameV1) => {
  const db = await dbPromise;
  await db.put(STORE_NAME, saveGame, autosaveKey(saveGame.scenarioId));
};
