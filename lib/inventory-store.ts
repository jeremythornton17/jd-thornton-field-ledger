import { createHash } from "node:crypto";
import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";

export const GROUPS = "fieldLedgerInventoryGroups";
export const GROUP_KEYS = "fieldLedgerGroupKeys";
export const ALLOCATIONS = "fieldLedgerAllocations";
export const ACTIVITIES = "fieldLedgerActivities";
export const COUNTERS = "fieldLedgerMeta/counters";

const DELETE_BATCH_SIZE = 450;
const DEFAULT_ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_PAGE_SIZE = 200;

export type InventoryGroup = {
  id: number;
  zoneId: string;
  species: string;
  height: string;
  caliper: string;
  quantity: number;
  priceCents: number;
  availableQuantity: number;
  taggedQuantity: number;
  soldQuantity: number;
  plantedOn: string;
};

export type Allocation = {
  id: number;
  groupId: number;
  quantity: number;
  status: "Tagged" | "Sold";
  client: string;
  orderNumber: string;
  markingMethod: string;
  createdAt: string;
};

export type Activity = {
  id: number;
  groupId: number;
  zoneId: string;
  activityType: string;
  activityDate: string;
  details: string;
  performedBy: string;
};

export type GroupInput = {
  zoneId: string;
  species: string;
  height: string;
  caliper: string;
  quantity: number;
  priceCents: number;
  plantedOn: string;
};

export class StoreError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

function groupRef(id: number) {
  return adminDb.collection(GROUPS).doc(String(id));
}

function allocationRef(id: number) {
  return adminDb.collection(ALLOCATIONS).doc(String(id));
}

function activityRef(id: number) {
  return adminDb.collection(ACTIVITIES).doc(String(id));
}

function uniqueGroupKey(input: Pick<GroupInput, "zoneId" | "species" | "height" | "caliper">) {
  const value = [
    input.zoneId.trim(),
    input.species.trim().toLocaleLowerCase(),
    input.height.trim(),
    input.caliper.trim(),
  ].join("\u001f");
  return createHash("sha256").update(value).digest("hex");
}

function groupKeyRef(input: Pick<GroupInput, "zoneId" | "species" | "height" | "caliper">) {
  return adminDb.collection(GROUP_KEYS).doc(uniqueGroupKey(input));
}

async function nextId(transaction: Transaction, field: "group" | "allocation" | "activity") {
  const counterRef = adminDb.doc(COUNTERS);
  const counter = await transaction.get(counterRef);
  const value = Number(counter.get(field) || 0) + 1;
  transaction.set(counterRef, { [field]: value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return value;
}

export async function reserveIdBlock(
  field: "group" | "allocation" | "activity",
  count: number,
) {
  if (!Number.isInteger(count) || count < 1) {
    throw new StoreError("At least one ID must be reserved.");
  }
  return adminDb.runTransaction(async (transaction) => {
    const counterRef = adminDb.doc(COUNTERS);
    const counter = await transaction.get(counterRef);
    const previous = Number(counter.get(field) || 0);
    const next = previous + count;
    transaction.set(
      counterRef,
      { [field]: next, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return previous + 1;
  });
}

function assertGroupWritable(group: DocumentSnapshot<DocumentData>) {
  if (group.get("deletingAt")) {
    throw new StoreError(
      "This inventory group is being deleted. Retry the deletion if it does not finish.",
      409,
    );
  }
}

function groupData(data: DocumentData): Omit<InventoryGroup, "availableQuantity" | "taggedQuantity" | "soldQuantity"> {
  return {
    id: Number(data.id),
    zoneId: String(data.zoneId || ""),
    species: String(data.species || ""),
    height: String(data.height || ""),
    caliper: String(data.caliper || ""),
    quantity: Number(data.quantity || 0),
    priceCents: Number(data.priceCents || 0),
    plantedOn: String(data.plantedOn || ""),
  };
}

function allocationData(data: DocumentData): Allocation {
  return {
    id: Number(data.id),
    groupId: Number(data.groupId),
    quantity: Number(data.quantity || 0),
    status: data.status === "Sold" ? "Sold" : "Tagged",
    client: String(data.client || ""),
    orderNumber: String(data.orderNumber || ""),
    markingMethod: String(data.markingMethod || ""),
    createdAt: String(data.createdAt || ""),
  };
}

function activityData(data: DocumentData): Omit<Activity, "zoneId"> {
  return {
    id: Number(data.id),
    groupId: Number(data.groupId),
    activityType: String(data.activityType || ""),
    activityDate: String(data.activityDate || ""),
    details: String(data.details || ""),
    performedBy: String(data.performedBy || ""),
  };
}

export async function listInventory() {
  const [groupSnapshot, allocationSnapshot] = await Promise.all([
    adminDb.collection(GROUPS).get(),
    adminDb.collection(ALLOCATIONS).get(),
  ]);

  const allocations = allocationSnapshot.docs
    .map((doc) => allocationData(doc.data()))
    .sort((a, b) => b.id - a.id);
  const commitments = new Map<number, { tagged: number; sold: number }>();
  for (const allocation of allocations) {
    const total = commitments.get(allocation.groupId) || { tagged: 0, sold: 0 };
    total[allocation.status === "Sold" ? "sold" : "tagged"] += allocation.quantity;
    commitments.set(allocation.groupId, total);
  }

  const baseGroups = groupSnapshot.docs.map((doc) => groupData(doc.data()));
  const groupMap = new Map(baseGroups.map((group) => [group.id, group]));
  const groups: InventoryGroup[] = baseGroups
    .filter((group) => group.quantity > 0)
    .map((group) => {
      const committed = commitments.get(group.id) || { tagged: 0, sold: 0 };
      return {
        ...group,
        availableQuantity: Math.max(group.quantity - committed.tagged - committed.sold, 0),
        taggedQuantity: committed.tagged,
        soldQuantity: committed.sold,
      };
    })
    .sort((a, b) => b.id - a.id);

  return {
    groups,
    allocations: allocations.map((allocation) => ({
      ...allocation,
      zoneId: groupMap.get(allocation.groupId)?.zoneId || "",
      species: groupMap.get(allocation.groupId)?.species || "",
      height: groupMap.get(allocation.groupId)?.height || "",
      caliper: groupMap.get(allocation.groupId)?.caliper || "",
      priceCents: groupMap.get(allocation.groupId)?.priceCents || 0,
    })),
  };
}

export async function listActivities(options: { cursorId?: number; limit?: number } = {}) {
  const pageSize = Math.min(
    Math.max(options.limit || DEFAULT_ACTIVITY_PAGE_SIZE, 1),
    MAX_ACTIVITY_PAGE_SIZE,
  );
  let query = adminDb
    .collection(ACTIVITIES)
    .orderBy("activityDate", "desc")
    .limit(pageSize + 1);

  if (options.cursorId) {
    const cursor = await activityRef(options.cursorId).get();
    if (!cursor.exists) {
      throw new StoreError("That work-log page is no longer available. Reload the work log.", 409);
    }
    query = query.startAfter(cursor);
  }

  const [groupSnapshot, activitySnapshot] = await Promise.all([
    adminDb.collection(GROUPS).get(),
    query.get(),
  ]);
  const groupMap = new Map(
    groupSnapshot.docs.map((doc) => {
      const group = groupData(doc.data());
      return [group.id, group] as const;
    }),
  );
  const pageDocs = activitySnapshot.docs.slice(0, pageSize);
  const hasMore = activitySnapshot.docs.length > pageSize;

  return {
    activities: pageDocs.map((doc) => {
      const activity = activityData(doc.data());
      const group = groupMap.get(activity.groupId);
      return {
        ...activity,
        zoneId: group?.zoneId || "",
        species: group?.species ?? null,
        height: group?.height ?? null,
        caliper: group?.caliper ?? null,
      };
    }),
    nextCursor: hasMore && pageDocs.length ? Number(pageDocs.at(-1)!.id) : null,
    hasMore,
  };
}

export async function addOrMergeGroup(input: GroupInput, reservedId?: number) {
  return adminDb.runTransaction(async (transaction) => {
    const keyRef = groupKeyRef(input);
    const key = await transaction.get(keyRef);
    if (key.exists) {
      const id = Number(key.get("groupId"));
      const existingRef = groupRef(id);
      const existing = await transaction.get(existingRef);
      if (!existing.exists) {
        transaction.delete(keyRef);
        throw new StoreError("The inventory index was stale. Retry this import row.", 409);
      }
      assertGroupWritable(existing);
      if (Number(existing.get("priceCents") || 0) !== input.priceCents) {
        throw new StoreError(
          "This group already exists with a different price. Edit the existing group before adding more trees.",
          409,
        );
      }
      const plantedOn = String(existing.get("plantedOn") || "");
      transaction.update(existingRef, {
        quantity: Number(existing.get("quantity") || 0) + input.quantity,
        plantedOn:
          !plantedOn || (input.plantedOn && input.plantedOn < plantedOn)
            ? input.plantedOn
            : plantedOn,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id, merged: true };
    }

    const id = reservedId || (await nextId(transaction, "group"));
    transaction.create(groupRef(id), {
      ...input,
      id,
      speciesLower: input.species.toLocaleLowerCase(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(keyRef, { groupId: id });
    return { id, merged: false };
  });
}

export async function updateGroup(id: number, input: GroupInput) {
  await adminDb.runTransaction(async (transaction) => {
    const currentRef = groupRef(id);
    const current = await transaction.get(currentRef);
    if (!current.exists) throw new StoreError("That inventory group no longer exists.", 404);
    assertGroupWritable(current);

    const allocations = await transaction.get(
      adminDb.collection(ALLOCATIONS).where("groupId", "==", id),
    );
    const committed = allocations.docs.reduce(
      (sum, doc) => sum + Number(doc.get("quantity") || 0),
      0,
    );
    if (input.quantity < committed) {
      throw new StoreError(
        `Quantity cannot be lower than the ${committed} trees currently tagged or sold.`,
        409,
      );
    }

    const oldData = groupData(current.data()!);
    const normalizedInput = {
      ...input,
      plantedOn: input.plantedOn || oldData.plantedOn,
    };
    const oldKeyRef = groupKeyRef(oldData);
    const newKeyRef = groupKeyRef(normalizedInput);
    if (oldKeyRef.path !== newKeyRef.path) {
      const duplicate = await transaction.get(newKeyRef);
      if (duplicate.exists && Number(duplicate.get("groupId")) !== id) {
        throw new StoreError(
          "Another inventory group already uses that zone, species, height, and caliper.",
          409,
        );
      }
    }
    const changeNotes: string[] = [];
    if (normalizedInput.priceCents !== oldData.priceCents) {
      const oldPrice =
        oldData.priceCents > 0
          ? `$${(oldData.priceCents / 100).toFixed(2)}`
          : "no price";
      const newPrice =
        normalizedInput.priceCents > 0
          ? `$${(normalizedInput.priceCents / 100).toFixed(2)}`
          : "no price";
      changeNotes.push(`Price changed from ${oldPrice} to ${newPrice} per tree.`);
    }
    if (normalizedInput.quantity !== oldData.quantity) {
      changeNotes.push(`Quantity changed from ${oldData.quantity} to ${normalizedInput.quantity}.`);
    }

    let activityId: number | null = null;
    if (changeNotes.length) activityId = await nextId(transaction, "activity");

    transaction.update(currentRef, {
      ...normalizedInput,
      speciesLower: normalizedInput.species.toLocaleLowerCase(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (oldKeyRef.path !== newKeyRef.path) {
      transaction.delete(oldKeyRef);
      transaction.set(newKeyRef, { groupId: id });
    }

    if (activityId !== null) {
      transaction.create(activityRef(activityId), {
        id: activityId,
        groupId: id,
        activityType: "Inventory adjustment",
        activityDate: new Date().toISOString().slice(0, 10),
        details: changeNotes.join(" "),
        performedBy: "",
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
}

export async function deleteGroup(id: number) {
  const prepared = await adminDb.runTransaction(async (transaction) => {
    const currentRef = groupRef(id);
    const [current, allocations] = await Promise.all([
      transaction.get(currentRef),
      transaction.get(adminDb.collection(ALLOCATIONS).where("groupId", "==", id)),
    ]);
    if (!current.exists) {
      throw new StoreError("That inventory group has already been removed.", 404);
    }
    const committed = allocations.docs.reduce(
      (sum, doc) => sum + Number(doc.get("quantity") || 0),
      0,
    );
    if (committed > 0) {
      throw new StoreError(
        `This group has ${committed} tree${committed === 1 ? "" : "s"} tagged or sold to clients. Resolve those allocations (or mark sold trees received) before deleting the group.`,
        409,
      );
    }
    const data = groupData(current.data()!);
    transaction.update(currentRef, {
      deletingAt: current.get("deletingAt") || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      data,
      allocationPaths: allocations.docs.map((doc) => doc.ref.path),
    };
  });

  const activities = await adminDb
    .collection(ACTIVITIES)
    .where("groupId", "==", id)
    .get();
  const childRefs: DocumentReference<DocumentData>[] = [
    ...prepared.allocationPaths.map((path) => adminDb.doc(path)),
    ...activities.docs.map((doc) => doc.ref),
  ];
  for (let index = 0; index < childRefs.length; index += DELETE_BATCH_SIZE) {
    const batch = adminDb.batch();
    childRefs
      .slice(index, index + DELETE_BATCH_SIZE)
      .forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  await adminDb.runTransaction(async (transaction) => {
    const currentRef = groupRef(id);
    const [current, allocations] = await Promise.all([
      transaction.get(currentRef),
      transaction.get(adminDb.collection(ALLOCATIONS).where("groupId", "==", id)),
    ]);
    if (!current.exists) return;
    if (!current.get("deletingAt")) {
      throw new StoreError("The deletion was interrupted before it could be finalized.", 409);
    }
    if (!allocations.empty) {
      throw new StoreError(
        "A client allocation was added while this group was being deleted. Review the group before retrying.",
        409,
      );
    }
    transaction.delete(groupKeyRef(groupData(current.data()!)));
    transaction.delete(currentRef);
  });

  return {
    removedQuantity: prepared.data.quantity,
    species: prepared.data.species,
  };
}

export async function addActivity(input: Omit<Activity, "id" | "zoneId">) {
  return adminDb.runTransaction(async (transaction) => {
    const group = await transaction.get(groupRef(input.groupId));
    if (!group.exists) throw new StoreError("That inventory group no longer exists.", 404);
    assertGroupWritable(group);
    const id = await nextId(transaction, "activity");
    transaction.create(activityRef(id), {
      ...input,
      id,
      createdAt: FieldValue.serverTimestamp(),
    });
    return id;
  });
}

type AllocationInput = Omit<Allocation, "id" | "createdAt">;

export async function addAllocation(input: AllocationInput) {
  return adminDb.runTransaction(async (transaction) => {
    const group = await transaction.get(groupRef(input.groupId));
    if (!group.exists) throw new StoreError("That inventory group no longer exists.", 404);
    assertGroupWritable(group);
    const allocations = await transaction.get(
      adminDb.collection(ALLOCATIONS).where("groupId", "==", input.groupId),
    );
    const committed = allocations.docs.reduce(
      (sum, doc) => sum + Number(doc.get("quantity") || 0),
      0,
    );
    if (input.quantity > Number(group.get("quantity") || 0) - committed) {
      throw new StoreError(
        "Not enough trees are available in this group for that quantity.",
        409,
      );
    }
    const id = await nextId(transaction, "allocation");
    transaction.create(allocationRef(id), {
      ...input,
      id,
      createdAt: new Date().toISOString(),
    });
    return id;
  });
}

export async function updateAllocation(id: number, input: AllocationInput) {
  await adminDb.runTransaction(async (transaction) => {
    const [allocation, group, groupAllocations] = await Promise.all([
      transaction.get(allocationRef(id)),
      transaction.get(groupRef(input.groupId)),
      transaction.get(
        adminDb.collection(ALLOCATIONS).where("groupId", "==", input.groupId),
      ),
    ]);
    if (!allocation.exists || !group.exists) {
      throw new StoreError("That allocation could not be updated.", 404);
    }
    assertGroupWritable(group);
    const committedExceptCurrent = groupAllocations.docs.reduce(
      (sum, doc) =>
        sum + (Number(doc.id) === id ? 0 : Number(doc.get("quantity") || 0)),
      0,
    );
    if (input.quantity > Number(group.get("quantity") || 0) - committedExceptCurrent) {
      throw new StoreError(
        "That allocation could not be updated — the requested quantity exceeds what's available.",
        409,
      );
    }
    transaction.update(allocationRef(id), input);
  });
}

export async function receiveAllocation(id: number) {
  return adminDb.runTransaction(async (transaction) => {
    const allocation = await transaction.get(allocationRef(id));
    if (!allocation.exists || allocation.get("status") !== "Sold") {
      throw new StoreError("Only sold trees can be marked received.");
    }
    const data = allocationData(allocation.data()!);
    const group = await transaction.get(groupRef(data.groupId));
    if (!group.exists) throw new StoreError("The inventory group no longer exists.", 404);
    assertGroupWritable(group);
    transaction.update(group.ref, {
      quantity: Math.max(Number(group.get("quantity") || 0) - data.quantity, 0),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.delete(allocation.ref);
    return data.quantity;
  });
}
