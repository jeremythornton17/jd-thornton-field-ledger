import { env } from "cloudflare:workers";
import { TEXT_LIMITS, clampText, isNonEmptyString, isPositiveInteger, isValidDate } from "./validation.mjs";
import { isKnownZoneId } from "./zones";

function formatCentsForLog(cents: number | undefined) {
  return (cents ?? 0) > 0 ? `$${((cents ?? 0) / 100).toFixed(2)}` : "no price";
}

type AddGroupResult =
  | { ok: true; id: number; merged: boolean }
  | { ok: false; error: string; status: number };

// Shared by the single "add-group" action and CSV bulk import: validates one
// row and either merges its quantity into a matching existing group (same
// zone/species/height/caliper/price) or inserts a new group.
async function addOrMergeGroup(input: GroupInput): Promise<AddGroupResult> {
  if (
    !isKnownZoneId(input.zoneId) ||
    !isNonEmptyString(input.species) ||
    !isNonEmptyString(input.height) ||
    !isNonEmptyString(input.caliper) ||
    !isPositiveInteger(input.quantity) ||
    !Number.isInteger(input.priceCents) ||
    (input.priceCents ?? -1) < 0 ||
    !isValidDate(input.plantedOn)
  ) {
    return { ok: false, error: "Complete all required inventory fields with a valid zone, positive quantity, price, and planting date.", status: 400 };
  }
  const species = clampText(input.species, TEXT_LIMITS.species);
  const height = clampText(input.height, TEXT_LIMITS.height);
  const caliper = clampText(input.caliper, TEXT_LIMITS.caliper);
  const existing = await env.DB.prepare(`SELECT id, price_cents AS priceCents FROM inventory_groups
    WHERE zone_id = ? AND lower(species) = lower(?) AND height = ? AND caliper = ? LIMIT 1`)
    .bind(input.zoneId, species, height, caliper)
    .first<{ id: number; priceCents: number }>();
  if (existing) {
    if (existing.priceCents !== input.priceCents) {
      return { ok: false, error: "This group already exists with a different price. Edit the existing group before adding more trees.", status: 409 };
    }
    await env.DB.prepare("UPDATE inventory_groups SET quantity = quantity + ?, planted_on = MIN(planted_on, ?) WHERE id = ?")
      .bind(input.quantity, input.plantedOn, existing.id).run();
    return { ok: true, id: existing.id, merged: true };
  }
  const result = await env.DB.prepare(
    "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,price_cents,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,'Available','','',?) RETURNING id"
  ).bind(input.zoneId, species, height, caliper, input.quantity, input.priceCents, input.plantedOn).first<{ id: number }>();
  return { ok: true, id: result!.id, merged: false };
}

type GroupInput = {
  zoneId?: string;
  species?: string;
  height?: string;
  caliper?: string;
  quantity?: number;
  priceCents?: number;
  plantedOn?: string;
};

type InventoryPayload = GroupInput & {
  action?: "add-group" | "update-group" | "delete-group" | "add-activity" | "add-allocation" | "update-allocation" | "receive-allocation" | "bulk-add-groups";
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
  rows?: GroupInput[];
};

// Schema creation and the legacy-commitments backfill only ever need to run
// once per warm isolate, not on every request. These flags memoize that so a
// busy isolate doesn't re-run DDL and a full-table migration scan on every
// GET/POST it handles.
let schemaEnsured = false;
let legacyCommitmentsMigrated = false;

async function ensureSchema() {
  if (schemaEnsured) return;
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id TEXT NOT NULL,
      species TEXT NOT NULL,
      height TEXT NOT NULL,
      caliper TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Available',
      client TEXT NOT NULL DEFAULT '',
      order_number TEXT NOT NULL DEFAULT '',
      planted_on TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      zone_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      performed_by TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      order_number TEXT NOT NULL DEFAULT '',
      marking_method TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS inventory_allocations_group_idx ON inventory_allocations(group_id)"),
  ]);
  const columns = await db.prepare("PRAGMA table_info(inventory_groups)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "price_cents")) {
    await db.prepare("ALTER TABLE inventory_groups ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0").run();
  }
  schemaEnsured = true;
}

async function migrateLegacyCommitments() {
  if (legacyCommitmentsMigrated) return;
  await env.DB.prepare(`INSERT INTO inventory_allocations
    (group_id, quantity, status, client, order_number, marking_method)
    SELECT g.id, g.quantity, g.status, g.client, g.order_number, 'Legacy record'
    FROM inventory_groups g
    WHERE g.status IN ('Tagged', 'Sold')
      AND NOT EXISTS (SELECT 1 FROM inventory_allocations a WHERE a.group_id = g.id)`).run();
  legacyCommitmentsMigrated = true;
}

export async function GET() {
  try {
    await ensureSchema();
    await migrateLegacyCommitments();
    const groups = await env.DB.prepare(`SELECT
      g.id, g.zone_id AS zoneId, g.species, g.height, g.caliper, g.quantity, g.price_cents AS priceCents,
      MAX(g.quantity - COALESCE(a.committed, 0), 0) AS availableQuantity,
      COALESCE(a.tagged, 0) AS taggedQuantity,
      COALESCE(a.sold, 0) AS soldQuantity,
      g.planted_on AS plantedOn
      FROM inventory_groups g
      LEFT JOIN (
        SELECT group_id,
          SUM(quantity) AS committed,
          SUM(CASE WHEN status = 'Tagged' THEN quantity ELSE 0 END) AS tagged,
          SUM(CASE WHEN status = 'Sold' THEN quantity ELSE 0 END) AS sold
        FROM inventory_allocations GROUP BY group_id
      ) a ON a.group_id = g.id
      WHERE g.quantity > 0
      ORDER BY g.id DESC`).all();
    const allocations = await env.DB.prepare(`SELECT
      a.id, a.group_id AS groupId, a.quantity, a.status, a.client,
      a.order_number AS orderNumber, a.marking_method AS markingMethod,
      a.created_at AS createdAt, g.zone_id AS zoneId, g.species, g.height, g.caliper, g.price_cents AS priceCents
      FROM inventory_allocations a
      JOIN inventory_groups g ON g.id = a.group_id
      ORDER BY a.id DESC`).all();
    // Left-joined so a tree group's field-work history stays intact (species,
    // height, caliper) even after the group's quantity has dropped to zero
    // and it no longer appears in the active inventory list above.
    const activities = await env.DB.prepare(`SELECT
      a.id, a.group_id AS groupId, a.zone_id AS zoneId, a.activity_type AS activityType,
      a.activity_date AS activityDate, a.details, a.performed_by AS performedBy,
      g.species, g.height, g.caliper
      FROM activities a
      LEFT JOIN inventory_groups g ON g.id = a.group_id
      ORDER BY a.activity_date DESC, a.id DESC`).all();
    return Response.json({ groups: groups.results, allocations: allocations.results, activities: activities.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load inventory" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const data = (await request.json()) as InventoryPayload;

    if (data.action === "add-group") {
      const outcome = await addOrMergeGroup(data);
      if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
      return Response.json({ ok: true, id: outcome.id, merged: outcome.merged }, { status: outcome.merged ? 200 : 201 });
    }

    if (data.action === "bulk-add-groups") {
      if (!Array.isArray(data.rows) || !data.rows.length) {
        return Response.json({ error: "No rows to import." }, { status: 400 });
      }
      if (data.rows.length > 500) {
        return Response.json({ error: "Import is limited to 500 rows at a time." }, { status: 400 });
      }
      // Rows are applied one at a time (not batched) since each depends on a
      // read (does a matching group already exist?) before deciding whether
      // to merge or insert -- exactly like a single add-group call.
      let created = 0;
      let merged = 0;
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < data.rows.length; i++) {
        const outcome = await addOrMergeGroup(data.rows[i]);
        if (!outcome.ok) errors.push({ row: i + 1, error: outcome.error });
        else if (outcome.merged) merged++;
        else created++;
      }
      return Response.json({ ok: true, created, merged, errors });
    }

    if (data.action === "update-group") {
      if (
        !isPositiveInteger(data.groupId) ||
        !isKnownZoneId(data.zoneId) ||
        !isNonEmptyString(data.species) ||
        !isNonEmptyString(data.height) ||
        !isNonEmptyString(data.caliper) ||
        !isPositiveInteger(data.quantity) ||
        !Number.isInteger(data.priceCents) ||
        (data.priceCents ?? -1) < 0 ||
        (data.plantedOn !== "" && data.plantedOn !== undefined && !isValidDate(data.plantedOn))
      ) {
        return Response.json({ error: "Complete the zone, species, size, quantity, and price fields with a valid, mapped zone." }, { status: 400 });
      }
      const zoneId = data.zoneId;
      const species = clampText(data.species, TEXT_LIMITS.species);
      const height = clampText(data.height, TEXT_LIMITS.height);
      const caliper = clampText(data.caliper, TEXT_LIMITS.caliper);
      const group = await env.DB.prepare(`SELECT g.id, g.quantity, g.price_cents AS priceCents,
        COALESCE((SELECT SUM(quantity) FROM inventory_allocations WHERE group_id = g.id), 0) AS committed
        FROM inventory_groups g WHERE g.id = ?`).bind(data.groupId).first<{ id: number; quantity: number; priceCents: number; committed: number }>();
      if (!group) return Response.json({ error: "That inventory group no longer exists." }, { status: 404 });
      if (data.quantity < group.committed) {
        return Response.json({ error: `Quantity cannot be lower than the ${group.committed} trees currently tagged or sold.` }, { status: 409 });
      }
      const duplicate = await env.DB.prepare(`SELECT id FROM inventory_groups
        WHERE id != ? AND zone_id = ? AND lower(species) = lower(?) AND height = ? AND caliper = ? LIMIT 1`)
        .bind(data.groupId, zoneId, species, height, caliper)
        .first<{ id: number }>();
      if (duplicate) {
        return Response.json({ error: "Another inventory group already uses that zone, species, height, and caliper." }, { status: 409 });
      }
      const statements = [
        env.DB.prepare(`UPDATE inventory_groups
          SET zone_id = ?, species = ?, height = ?, caliper = ?, quantity = ?, price_cents = ?,
              planted_on = CASE WHEN ? = '' THEN planted_on ELSE ? END
          WHERE id = ?`)
          .bind(zoneId, species, height, caliper, data.quantity, data.priceCents, data.plantedOn || "", data.plantedOn || "", data.groupId),
        env.DB.prepare("UPDATE activities SET zone_id = ? WHERE group_id = ?").bind(zoneId, data.groupId),
      ];
      // Price and quantity are edited in place with no other history, so log
      // a milestone whenever either changes -- otherwise a mis-edit (or a
      // deliberate repricing) leaves no trace of what the value used to be.
      const changeNotes: string[] = [];
      if (data.priceCents !== group.priceCents) {
        changeNotes.push(`Price changed from ${formatCentsForLog(group.priceCents)} to ${formatCentsForLog(data.priceCents)} per tree.`);
      }
      if (data.quantity !== group.quantity) {
        changeNotes.push(`Quantity changed from ${group.quantity} to ${data.quantity}.`);
      }
      if (changeNotes.length) {
        statements.push(
          env.DB.prepare(
            "INSERT INTO activities (group_id,zone_id,activity_type,activity_date,details,performed_by) VALUES (?,?,?,?,?,?)"
          ).bind(data.groupId, zoneId, "Inventory adjustment", new Date().toISOString().slice(0, 10), changeNotes.join(" "), ""),
        );
      }
      await env.DB.batch(statements);
      return Response.json({ ok: true });
    }

    if (data.action === "delete-group") {
      if (!isPositiveInteger(data.groupId) || data.confirmGroupId !== data.groupId) {
        return Response.json({ error: "Inventory group confirmation did not match." }, { status: 400 });
      }
      const group = await env.DB.prepare(`SELECT g.id, g.species, g.quantity,
        COALESCE((SELECT SUM(quantity) FROM inventory_allocations WHERE group_id = g.id AND status = 'Tagged'), 0) AS taggedQuantity,
        COALESCE((SELECT SUM(quantity) FROM inventory_allocations WHERE group_id = g.id AND status = 'Sold'), 0) AS soldQuantity
        FROM inventory_groups g WHERE g.id = ?`)
        .bind(data.groupId).first<{ id: number; species: string; quantity: number; taggedQuantity: number; soldQuantity: number }>();
      if (!group) return Response.json({ error: "That inventory group has already been removed." }, { status: 404 });
      // Refuse to delete out from under a live client commitment. Someone has
      // to resolve those allocations first (edit them off the group, or mark
      // sold trees received) so a mis-click can't take a real sale — and its
      // work history — down with it.
      const committed = group.taggedQuantity + group.soldQuantity;
      if (committed > 0) {
        return Response.json({
          error: `This group has ${committed} tree${committed === 1 ? "" : "s"} tagged or sold to clients. Resolve those allocations (or mark sold trees received) before deleting the group.`,
        }, { status: 409 });
      }
      await env.DB.batch([
        env.DB.prepare("DELETE FROM inventory_allocations WHERE group_id = ?").bind(data.groupId),
        env.DB.prepare("DELETE FROM activities WHERE group_id = ?").bind(data.groupId),
        env.DB.prepare("DELETE FROM inventory_groups WHERE id = ?").bind(data.groupId),
      ]);
      // Best-effort: an orphaned R2 object just wastes storage, it's not worth
      // failing the delete over if photo storage is unconfigured or errors.
      await env.PHOTOS?.delete(`groups/${data.groupId}`).catch(() => {});
      return Response.json({ ok: true, removedQuantity: group.quantity, species: group.species });
    }

    if (data.action === "add-activity") {
      if (
        !isPositiveInteger(data.groupId) ||
        !isKnownZoneId(data.zoneId) ||
        !isNonEmptyString(data.activityType) ||
        !isValidDate(data.activityDate)
      ) {
        return Response.json({ error: "Select a tree group, a known zone, an activity type, and a valid date." }, { status: 400 });
      }
      await env.DB.prepare(
        "INSERT INTO activities (group_id,zone_id,activity_type,activity_date,details,performed_by) VALUES (?,?,?,?,?,?)"
      ).bind(
        data.groupId,
        data.zoneId,
        clampText(data.activityType, TEXT_LIMITS.activityType),
        data.activityDate,
        clampText(data.details ?? "", TEXT_LIMITS.details),
        clampText(data.performedBy ?? "", TEXT_LIMITS.performedBy),
      ).run();
      return Response.json({ ok: true }, { status: 201 });
    }

    if (data.action === "add-allocation" || data.action === "update-allocation") {
      if (
        !isPositiveInteger(data.groupId) ||
        !isPositiveInteger(data.quantity) ||
        !data.status ||
        !["Tagged", "Sold"].includes(data.status) ||
        !isNonEmptyString(data.client)
      ) {
        return Response.json({ error: "Enter a client, a positive quantity, and Tagged or Sold status." }, { status: 400 });
      }
      const client = clampText(data.client, TEXT_LIMITS.client);
      const orderNumber = clampText(data.orderNumber ?? "", TEXT_LIMITS.orderNumber);
      const markingMethod = clampText(data.markingMethod ?? "", TEXT_LIMITS.markingMethod);

      if (data.action === "update-allocation") {
        if (!isPositiveInteger(data.allocationId)) {
          return Response.json({ error: "Missing client allocation." }, { status: 400 });
        }
        // The availability check and the write happen inside one statement so
        // two concurrent edits against the same group can't both pass a
        // separate "is there enough available" read and jointly over-commit
        // more trees than the group actually has.
        const updated = await env.DB.prepare(`UPDATE inventory_allocations
          SET quantity = ?, status = ?, client = ?, order_number = ?, marking_method = ?
          WHERE id = ? AND group_id = ?
            AND ? <= (
              SELECT g.quantity - COALESCE(SUM(CASE WHEN a.id != ? THEN a.quantity ELSE 0 END), 0)
              FROM inventory_groups g
              LEFT JOIN inventory_allocations a ON a.group_id = g.id
              WHERE g.id = ?
            )`)
          .bind(
            data.quantity, data.status, client, orderNumber, markingMethod,
            data.allocationId, data.groupId,
            data.quantity, data.allocationId, data.groupId,
          ).run();
        if (!updated.meta.changes) {
          return Response.json({ error: "That allocation could not be updated — it may no longer exist, or the requested quantity exceeds what's available." }, { status: 409 });
        }
        return Response.json({ ok: true });
      }

      const inserted = await env.DB.prepare(`INSERT INTO inventory_allocations
        (group_id, quantity, status, client, order_number, marking_method)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE ? <= (
          SELECT g.quantity - COALESCE(SUM(a.quantity), 0)
          FROM inventory_groups g
          LEFT JOIN inventory_allocations a ON a.group_id = g.id
          WHERE g.id = ?
        )
        RETURNING id`)
        .bind(data.groupId, data.quantity, data.status, client, orderNumber, markingMethod, data.quantity, data.groupId)
        .first<{ id: number }>();
      if (!inserted) {
        return Response.json({ error: "Not enough trees are available in this group for that quantity." }, { status: 409 });
      }
      return Response.json({ ok: true, id: inserted.id }, { status: 201 });
    }

    if (data.action === "receive-allocation") {
      if (!isPositiveInteger(data.allocationId)) {
        return Response.json({ error: "Missing sold allocation." }, { status: 400 });
      }
      const allocation = await env.DB.prepare(
        "SELECT id, group_id AS groupId, quantity, status FROM inventory_allocations WHERE id = ?"
      ).bind(data.allocationId).first<{ id: number; groupId: number; quantity: number; status: string }>();
      if (!allocation || allocation.status !== "Sold") {
        return Response.json({ error: "Only sold trees can be marked received." }, { status: 400 });
      }
      // The group row is kept (at quantity 0 if fully received) rather than
      // deleted, so any field-work history recorded against it stays joinable
      // instead of becoming an orphaned reference. It's clamped to zero as a
      // safety net in case the on-hand quantity and the sold allocation ever
      // drift apart.
      await env.DB.batch([
        env.DB.prepare("UPDATE inventory_groups SET quantity = MAX(quantity - ?, 0) WHERE id = ?").bind(allocation.quantity, allocation.groupId),
        env.DB.prepare("DELETE FROM inventory_allocations WHERE id = ?").bind(allocation.id),
      ]);
      return Response.json({ ok: true, removedQuantity: allocation.quantity });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save change" }, { status: 500 });
  }
}
