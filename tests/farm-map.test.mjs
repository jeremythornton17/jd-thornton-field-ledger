import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { farms } = JSON.parse(
  readFileSync(new URL("../public/farm-map.json", import.meta.url), "utf8"),
);
const tenAcre = farms.find((farm) => farm.code === "F10");

function bounds(coordinates) {
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

test("farm zone IDs remain unique across the map", () => {
  const ids = farms.flatMap((farm) => farm.zones.map((zone) => zone.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("10 Acre retains its inventory-linked zones and pumps", () => {
  assert.ok(tenAcre);
  assert.deepEqual(
    tenAcre.zones.map((zone) => zone.id).sort(),
    ["EAST", "WEST"].flatMap((side) =>
      Array.from({ length: 7 }, (_, index) => `F10-${side}-${String(index + 1).padStart(2, "0")}`),
    ).sort(),
  );
  assert.deepEqual(tenAcre.pumps.map((pump) => pump.name).sort(), ["East Pump", "West Pump"]);
});

test("10 Acre labels stay centered in non-overlapping rectangular zones", () => {
  const zones = tenAcre.zones.map((zone) => ({ zone, box: bounds(zone.coordinates) }));
  for (const { zone, box } of zones) {
    assert.equal(new Set(zone.coordinates.map((point) => point[0])).size, 2, zone.id);
    assert.equal(new Set(zone.coordinates.map((point) => point[1])).size, 2, zone.id);
    assert.ok(Math.abs(zone.labelCoordinates[0] - (box.minX + box.maxX) / 2) < 1e-9, zone.id);
    assert.ok(Math.abs(zone.labelCoordinates[1] - (box.minY + box.maxY) / 2) < 1e-9, zone.id);
  }
  for (let index = 0; index < zones.length; index++) {
    for (let other = index + 1; other < zones.length; other++) {
      const a = zones[index].box;
      const b = zones[other].box;
      assert.ok(
        a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY,
        `${zones[index].zone.id} overlaps ${zones[other].zone.id}`,
      );
    }
  }
});

test("10 Acre pump houses fit in the corridor between zone banks", () => {
  const westEdge = Math.max(...tenAcre.zones.filter((zone) => zone.pump === "West")
    .map((zone) => bounds(zone.coordinates).maxX));
  const eastEdge = Math.min(...tenAcre.zones.filter((zone) => zone.pump === "East")
    .map((zone) => bounds(zone.coordinates).minX));
  assert.ok(westEdge < eastEdge);
  for (const name of ["East Pump House", "West Pump House"]) {
    const feature = tenAcre.features.find((item) => item.name === name);
    assert.ok(feature, `${name} is missing`);
    const box = bounds(feature.coordinates);
    assert.ok(box.minX > westEdge && box.maxX < eastEdge, name);
  }
  assert.equal(tenAcre.roads.length, 0);
});
