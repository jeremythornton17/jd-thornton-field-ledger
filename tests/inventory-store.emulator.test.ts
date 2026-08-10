import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Run this test through the Firestore emulator script.");
}
process.env.FIREBASE_PROJECT_ID = "demo-field-ledger-test";

const store = await import("../lib/inventory-store.ts");
const { adminDb } = await import("../lib/firebase-admin.ts");

const COLLECTIONS = [
  store.GROUPS,
  store.GROUP_KEYS,
  store.ALLOCATIONS,
  store.ACTIVITIES,
];

const baseGroup = {
  zoneId: "F25-N-01",
  species: "Live Oak",
  height: "12-14 ft",
  caliper: "3 in",
  quantity: 5,
  priceCents: 25000,
  plantedOn: "2026-01-15",
};

async function clearFirestore() {
  for (const collectionName of COLLECTIONS) {
    const snapshot = await adminDb.collection(collectionName).get();
    for (let index = 0; index < snapshot.docs.length; index += 400) {
      const batch = adminDb.batch();
      snapshot.docs.slice(index, index + 400).forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }
  await adminDb.doc(store.COUNTERS).delete().catch(() => undefined);
}

async function seedGroup(overrides: Partial<typeof baseGroup> = {}) {
  return (await store.addOrMergeGroup({ ...baseGroup, ...overrides })).id;
}

function allocation(groupId: number, quantity: number, status: "Tagged" | "Sold" = "Tagged") {
  return {
    groupId,
    quantity,
    status,
    client: "Test Client",
    orderNumber: "TEST-1",
    markingMethod: "Orange tape around the trunk",
  };
}

beforeEach(clearFirestore);
after(clearFirestore);

test("addAllocation rejects a quantity larger than availability", async () => {
  const groupId = await seedGroup();
  await assert.rejects(
    store.addAllocation(allocation(groupId, 6)),
    (error: unknown) => error instanceof store.StoreError && error.status === 409,
  );
});

test("concurrent allocations cannot over-commit a group", async () => {
  const groupId = await seedGroup();
  const results = await Promise.allSettled([
    store.addAllocation(allocation(groupId, 4)),
    store.addAllocation(allocation(groupId, 4)),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);

  const inventory = await store.listInventory();
  assert.equal(inventory.allocations.reduce((sum, item) => sum + item.quantity, 0), 4);
  assert.equal(inventory.groups[0].availableQuantity, 1);
});

test("updateAllocation rejects a quantity beyond remaining availability", async () => {
  const groupId = await seedGroup();
  const firstId = await store.addAllocation(allocation(groupId, 3));
  await store.addAllocation(allocation(groupId, 2));

  await assert.rejects(
    store.updateAllocation(firstId, allocation(groupId, 4)),
    (error: unknown) => error instanceof store.StoreError && error.status === 409,
  );
});

test("updateAllocation excludes the current allocation from committed quantity", async () => {
  const groupId = await seedGroup();
  const allocationId = await store.addAllocation(allocation(groupId, 4));
  await store.updateAllocation(allocationId, allocation(groupId, 5));

  const inventory = await store.listInventory();
  assert.equal(inventory.allocations[0].quantity, 5);
  assert.equal(inventory.groups[0].availableQuantity, 0);
});

test("deleteGroup rejects groups with committed trees", async () => {
  const groupId = await seedGroup();
  await store.addAllocation(allocation(groupId, 1));

  await assert.rejects(
    store.deleteGroup(groupId),
    (error: unknown) => error instanceof store.StoreError && error.status === 409,
  );
  assert.equal((await adminDb.collection(store.GROUPS).doc(String(groupId)).get()).exists, true);
});

test("receiving a sold allocation clears the commitment and permits deletion", async () => {
  const groupId = await seedGroup();
  const allocationId = await store.addAllocation(allocation(groupId, 2, "Sold"));
  assert.equal(await store.receiveAllocation(allocationId), 2);

  const removed = await store.deleteGroup(groupId);
  assert.equal(removed.removedQuantity, 3);
  assert.equal((await adminDb.collection(store.GROUPS).doc(String(groupId)).get()).exists, false);
});

test("addOrMergeGroup rejects a duplicate size group with a different price", async () => {
  await seedGroup();
  await assert.rejects(
    store.addOrMergeGroup({ ...baseGroup, quantity: 2, priceCents: 30000 }),
    (error: unknown) => error instanceof store.StoreError && error.status === 409,
  );
});

test("updateGroup rejects quantity below client commitments", async () => {
  const groupId = await seedGroup();
  await store.addAllocation(allocation(groupId, 3));

  await assert.rejects(
    store.updateGroup(groupId, { ...baseGroup, quantity: 2 }),
    (error: unknown) => error instanceof store.StoreError && error.status === 409,
  );
});

test("large activity histories are derived from the group and deleted in chunks", async () => {
  const groupId = await seedGroup();
  for (let start = 1; start <= 510; start += 400) {
    const batch = adminDb.batch();
    for (let id = start; id < Math.min(start + 400, 511); id += 1) {
      batch.set(adminDb.collection(store.ACTIVITIES).doc(String(id)), {
        id,
        groupId,
        zoneId: "LEGACY-ZONE",
        activityType: "Maintenance",
        activityDate: "2026-08-01",
        details: `Activity ${id}`,
        performedBy: "Test Crew",
      });
    }
    await batch.commit();
  }

  const updatedGroup = { ...baseGroup, zoneId: "F25-N-02" };
  await store.updateGroup(groupId, updatedGroup);
  const storedActivity = await adminDb.collection(store.ACTIVITIES).doc("1").get();
  assert.equal(storedActivity.get("zoneId"), "LEGACY-ZONE");
  const activityPage = await store.listActivities({ limit: 1 });
  assert.equal(activityPage.activities[0].zoneId, "F25-N-02");

  await store.deleteGroup(groupId);
  assert.equal((await adminDb.collection(store.ACTIVITIES).where("groupId", "==", groupId).get()).empty, true);
  assert.equal((await adminDb.collection(store.GROUPS).doc(String(groupId)).get()).exists, false);
});
