import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "jdt-command-board";
const app =
  getApps()[0] ||
  initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || "(default)");

const [groups, activities, allocations, counters] = await Promise.all([
  db.collection("fieldLedgerInventoryGroups").get(),
  db.collection("fieldLedgerActivities").get(),
  db.collection("fieldLedgerAllocations").get(),
  db.doc("fieldLedgerMeta/counters").get(),
]);

const result = {
  projectId,
  groups: groups.size,
  trees: groups.docs.reduce(
    (sum, document) => sum + Number(document.get("quantity") || 0),
    0,
  ),
  activities: activities.size,
  allocations: allocations.size,
  counters: counters.exists ? counters.data() : null,
};

console.log(JSON.stringify(result, null, 2));

if (
  result.groups !== 187 ||
  result.trees !== 22868 ||
  result.activities !== 3 ||
  result.allocations !== 0
) {
  process.exitCode = 1;
}

