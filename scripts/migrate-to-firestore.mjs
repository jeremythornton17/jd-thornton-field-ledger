import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const inventoryPath = process.argv[2];
const workLogPath = process.argv[3];
if (!inventoryPath || !workLogPath) {
  throw new Error(
    "Usage: node scripts/migrate-to-firestore.mjs <inventory.csv> <work-log.csv>",
  );
}

const projectId = process.env.FIREBASE_PROJECT_ID || "jdt-command-board";
const app =
  getApps()[0] ||
  initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || "(default)");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  const headers = rows.shift().map((value) => value.trim());
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function groupKey(group) {
  return createHash("sha256")
    .update(
      [
        group.zoneId.trim(),
        group.species.trim().toLocaleLowerCase(),
        group.height.trim(),
        group.caliper.trim(),
      ].join("\u001f"),
    )
    .digest("hex");
}

function matchKey(group) {
  return [
    group.zoneId.trim(),
    group.species.trim().toLocaleLowerCase(),
    group.height.trim(),
    group.caliper.trim(),
  ].join("\u001f");
}

async function assertEmpty(collection) {
  const snapshot = await db.collection(collection).limit(1).get();
  if (!snapshot.empty) {
    throw new Error(
      `${collection} already contains data. Migration stopped to prevent duplicates.`,
    );
  }
}

for (const collection of [
  "fieldLedgerInventoryGroups",
  "fieldLedgerGroupKeys",
  "fieldLedgerActivities",
  "fieldLedgerAllocations",
]) {
  await assertEmpty(collection);
}

const inventoryRows = parseCsv(await readFile(inventoryPath, "utf8"));
const workRows = parseCsv(await readFile(workLogPath, "utf8"));

// The production export is ordered newest ID first. IDs 1-5 were the removed
// prototype seed records, so the 187 current rows map exactly to IDs 192..6.
const groups = inventoryRows.map((row, index) => ({
  id: inventoryRows.length + 5 - index,
  zoneId: row.Zone.trim(),
  species: row.Species.trim(),
  speciesLower: row.Species.trim().toLocaleLowerCase(),
  height: row.Height.trim(),
  caliper: row.Caliper.trim(),
  quantity: Number(row.Quantity),
  priceCents: Math.round(Number(row["Price Each"] || 0) * 100),
  plantedOn: row["Planted On"].trim(),
}));

const byMatchKey = new Map(groups.map((group) => [matchKey(group), group]));
const activities = workRows.map((row) => {
  const matched = byMatchKey.get(
    matchKey({
      zoneId: row.Zone,
      species: row.Species,
      height: row.Height,
      caliper: row.Caliper,
    }),
  );
  if (!matched) {
    throw new Error(
      `Work-log row ${row.ID} could not be matched to an inventory group.`,
    );
  }
  return {
    id: Number(row.ID),
    groupId: matched.id,
    zoneId: row.Zone.trim(),
    activityType: row.Activity.trim(),
    activityDate: row.Date.trim(),
    details: row.Details.trim(),
    performedBy: row["Performed By"].trim(),
  };
});

const writes = [];
for (const group of groups) {
  writes.push({
    ref: db.collection("fieldLedgerInventoryGroups").doc(String(group.id)),
    data: {
      ...group,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  });
  writes.push({
    ref: db.collection("fieldLedgerGroupKeys").doc(groupKey(group)),
    data: { groupId: group.id },
  });
}
for (const activity of activities) {
  writes.push({
    ref: db.collection("fieldLedgerActivities").doc(String(activity.id)),
    data: { ...activity, createdAt: FieldValue.serverTimestamp() },
  });
}
writes.push({
  ref: db.doc("fieldLedgerMeta/counters"),
  data: {
    group: Math.max(...groups.map((group) => group.id)),
    activity: Math.max(0, ...activities.map((activity) => activity.id)),
    allocation: 0,
    migratedAt: FieldValue.serverTimestamp(),
    source: "Sites production export 2026-07-26",
  },
});

for (let index = 0; index < writes.length; index += 450) {
  const batch = db.batch();
  for (const write of writes.slice(index, index + 450)) {
    batch.set(write.ref, write.data);
  }
  await batch.commit();
}

const totalTrees = groups.reduce((sum, group) => sum + group.quantity, 0);
console.log(
  JSON.stringify(
    {
      projectId,
      groups: groups.length,
      trees: totalTrees,
      activities: activities.length,
      allocations: 0,
      highestGroupId: Math.max(...groups.map((group) => group.id)),
    },
    null,
    2,
  ),
);

