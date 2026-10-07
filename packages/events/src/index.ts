import type { CinematicScriptV1 } from "@helm/content-schema";
import type { PackId } from "@helm/entity-graph";

export interface CatastrophicEventResultV1 {
  id: string;
  packId: PackId;
  title: string;
  trustPenalty: number;
  cashPenalty: number;
  freezePackHours: number;
  triggeredAtHour: number;
  scriptLines: string[];
  recoveryText: string;
}

export const findEventScript = (events: CinematicScriptV1[], eventId: string) =>
  events.find((event) => event.id === eventId);

export const toCatastrophicResult = (
  script: CinematicScriptV1,
  triggeredAtHour: number
): CatastrophicEventResultV1 => ({
  id: script.id,
  packId: script.packId,
  title: script.title,
  trustPenalty: script.trustPenalty,
  cashPenalty: script.cashPenalty,
  freezePackHours: script.freezePackHours,
  triggeredAtHour,
  scriptLines: script.scriptLines,
  recoveryText: script.recoveryText
});
