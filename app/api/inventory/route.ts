import { type NextRequest } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { adminBucket } from "@/lib/firebase-admin";
import {
  addActivity,
  addAllocation,
  addOrMergeGroup,
  deleteGroup,
  listInventory,
  receiveAllocation,
  reserveIdBlock,
  StoreError,
  updateAllocation,
  updateGroup,
  type GroupInput,
} from "@/lib/inventory-store";
import {
  TEXT_LIMITS,
  clampText,
  isNonEmptyString,
  isPositiveInteger,
  isValidDate,
} from "./validation.mjs";
import { isKnownZoneId } from "./zones";

type InventoryPayload = Partial<GroupInput> & {
  action?:
    | "add-group"
    | "update-group"
    | "delete-group"
    | "add-activity"
    | "add-allocation"
    | "update-allocation"
    | "receive-allocation"
    | "bulk-add-groups";
  client?: string;
  orderNumber?: string;
  groupId?: number;
  confirmGroupId?: number;
  allocationId?: number;
  status?: "Tagged" | "Sold";
  markingMethod?: string;
  activityType?: string;
  activityDate?: string;
  details?: string;
  performedBy?: string;
  rows?: Partial<GroupInput>[];
};

function storeErrorResponse(error: unknown, fallback: string) {
  const auth = authErrorResponse(error);
  if (auth) return auth;
  if (error instanceof StoreError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(`[field-ledger inventory] ${fallback}`, error);
  return Response.json({ error: fallback }, { status: 500 });
}

function validatedGroupInput(
  data: Partial<GroupInput>,
  options: { allowMissingDate?: boolean } = {},
): GroupInput | null {
  if (
    !isKnownZoneId(data.zoneId) ||
    !isNonEmptyString(data.species) ||
    !isNonEmptyString(data.height) ||
    !isNonEmptyString(data.caliper) ||
    !isPositiveInteger(data.quantity) ||
    !Number.isInteger(data.priceCents) ||
    (data.priceCents ?? -1) < 0 ||
    !(
      isValidDate(data.plantedOn) ||
      (options.allowMissingDate && (data.plantedOn === "" || data.plantedOn === undefined))
    )
  ) {
    return null;
  }
  return {
    zoneId: data.zoneId!,
    species: clampText(data.species, TEXT_LIMITS.species),
    height: clampText(data.height, TEXT_LIMITS.height),
    caliper: clampText(data.caliper, TEXT_LIMITS.caliper),
    quantity: data.quantity!,
    priceCents: data.priceCents!,
    plantedOn: data.plantedOn || "",
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return Response.json(await listInventory());
  } catch (error) {
    return storeErrorResponse(error, "Unable to load inventory.");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request);
    const data = (await request.json()) as InventoryPayload;

    if (data.action === "add-group") {
      const input = validatedGroupInput(data);
      if (!input) {
        return Response.json(
          {
            error:
              "Complete all required inventory fields with a valid zone, positive quantity, price, and planting date.",
          },
          { status: 400 },
        );
      }
      const result = await addOrMergeGroup(input);
      return Response.json(
        { ok: true, ...result },
        { status: result.merged ? 200 : 201 },
      );
    }

    if (data.action === "bulk-add-groups") {
      if (!Array.isArray(data.rows) || !data.rows.length) {
        return Response.json({ error: "No rows to import." }, { status: 400 });
      }
      if (data.rows.length > 500) {
        return Response.json(
          { error: "Import is limited to 500 rows at a time." },
          { status: 400 },
        );
      }
      let created = 0;
      let merged = 0;
      const errors: { row: number; error: string }[] = [];
      const validRows: { row: number; input: GroupInput }[] = [];
      for (let index = 0; index < data.rows.length; index++) {
        const input = validatedGroupInput(data.rows[index]);
        if (!input) {
          errors.push({ row: index + 1, error: "Invalid inventory fields." });
          continue;
        }
        validRows.push({ row: index + 1, input });
      }
      const firstReservedId = validRows.length
        ? await reserveIdBlock("group", validRows.length)
        : 0;
      for (let index = 0; index < validRows.length; index++) {
        const { row, input } = validRows[index];
        try {
          const result = await addOrMergeGroup(input, firstReservedId + index);
          if (result.merged) merged++;
          else created++;
        } catch (error) {
          if (!(error instanceof StoreError)) {
            console.error(`[field-ledger import] Unable to import row ${row}.`, error);
          }
          errors.push({
            row,
            error:
              error instanceof StoreError ? error.message : "Unable to import row.",
          });
        }
      }
      return Response.json({ ok: true, created, merged, errors });
    }

    if (data.action === "update-group") {
      if (!isPositiveInteger(data.groupId)) {
        return Response.json({ error: "Missing inventory group." }, { status: 400 });
      }
      const input = validatedGroupInput(data, { allowMissingDate: true });
      if (!input) {
        return Response.json(
          {
            error:
              "Complete the zone, species, size, quantity, price, and planting date fields with a valid, mapped zone.",
          },
          { status: 400 },
        );
      }
      await updateGroup(data.groupId!, input);
      return Response.json({ ok: true });
    }

    if (data.action === "delete-group") {
      if (
        !isPositiveInteger(data.groupId) ||
        data.confirmGroupId !== data.groupId
      ) {
        return Response.json(
          { error: "Inventory group confirmation did not match." },
          { status: 400 },
        );
      }
      const result = await deleteGroup(data.groupId!);
      await adminBucket
        .file(`field-ledger/groups/${data.groupId}`)
        .delete({ ignoreNotFound: true })
        .catch(() => {});
      return Response.json({ ok: true, ...result });
    }

    if (data.action === "add-activity") {
      if (
        !isPositiveInteger(data.groupId) ||
        !isKnownZoneId(data.zoneId) ||
        !isNonEmptyString(data.activityType) ||
        !isValidDate(data.activityDate)
      ) {
        return Response.json(
          {
            error:
              "Select a tree group, a known zone, an activity type, and a valid date.",
          },
          { status: 400 },
        );
      }
      const id = await addActivity({
        groupId: data.groupId!,
        activityType: clampText(data.activityType, TEXT_LIMITS.activityType),
        activityDate: data.activityDate!,
        details: clampText(data.details ?? "", TEXT_LIMITS.details),
        performedBy: clampText(
          data.performedBy ?? "",
          TEXT_LIMITS.performedBy,
        ),
      });
      return Response.json({ ok: true, id }, { status: 201 });
    }

    if (
      data.action === "add-allocation" ||
      data.action === "update-allocation"
    ) {
      if (
        !isPositiveInteger(data.groupId) ||
        !isPositiveInteger(data.quantity) ||
        !data.status ||
        !["Tagged", "Sold"].includes(data.status) ||
        !isNonEmptyString(data.client)
      ) {
        return Response.json(
          {
            error:
              "Enter a client, a positive quantity, and Tagged or Sold status.",
          },
          { status: 400 },
        );
      }
      const input = {
        groupId: data.groupId!,
        quantity: data.quantity!,
        status: data.status!,
        client: clampText(data.client, TEXT_LIMITS.client),
        orderNumber: clampText(
          data.orderNumber ?? "",
          TEXT_LIMITS.orderNumber,
        ),
        markingMethod: clampText(
          data.markingMethod ?? "",
          TEXT_LIMITS.markingMethod,
        ),
      };
      if (data.action === "update-allocation") {
        if (!isPositiveInteger(data.allocationId)) {
          return Response.json(
            { error: "Missing client allocation." },
            { status: 400 },
          );
        }
        await updateAllocation(data.allocationId!, input);
        return Response.json({ ok: true });
      }
      const id = await addAllocation(input);
      return Response.json({ ok: true, id }, { status: 201 });
    }

    if (data.action === "receive-allocation") {
      if (!isPositiveInteger(data.allocationId)) {
        return Response.json(
          { error: "Missing sold allocation." },
          { status: 400 },
        );
      }
      return Response.json({
        ok: true,
        removedQuantity: await receiveAllocation(data.allocationId!),
      });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return storeErrorResponse(error, "Unable to save change.");
  }
}
