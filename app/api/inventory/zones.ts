import farmMap from "../../../public/farm-map.json";
import handWateredFarms from "../../../public/hand-watered-farms.json";

type FarmFile = { farms: Array<{ zones: Array<{ id: string }> }> };

function collectZoneIds(file: FarmFile): string[] {
  return file.farms.flatMap((farm) => farm.zones.map((zone) => zone.id));
}

// All zone ids that actually exist on one of the farm maps. Used to reject
// inventory writes against a typo'd or made-up zone id before it ever hits D1.
export const KNOWN_ZONE_IDS = new Set<string>([
  ...collectZoneIds(farmMap as unknown as FarmFile),
  ...collectZoneIds(handWateredFarms as unknown as FarmFile),
]);

export function isKnownZoneId(zoneId: unknown): zoneId is string {
  return typeof zoneId === "string" && KNOWN_ZONE_IDS.has(zoneId);
}
