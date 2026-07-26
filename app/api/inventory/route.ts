import { env } from "cloudflare:workers";

type InventoryPayload = {
  action?: "add-group" | "update-group" | "delete-group" | "add-activity" | "add-allocation" | "update-allocation" | "receive-allocation" | "remove-seed-data";
  zoneId?: string;
  species?: string;
  height?: string;
  caliper?: string;
  quantity?: number;
  priceCents?: number;
  client?: string;
  orderNumber?: string;
  plantedOn?: string;
  groupId?: number;
  confirmGroupId?: number;
  allocationId?: number;
  status?: "Tagged" | "Sold";
  markingMethod?: string;
  activityType?: string;
  activityDate?: string;
  details?: string;
  performedBy?: string;
};

async function ensureSchema() {
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
}

async function migrateLegacyCommitments() {
  await env.DB.prepare(`INSERT INTO inventory_allocations
    (group_id, quantity, status, client, order_number, marking_method)
    SELECT g.id, g.quantity, g.status, g.client, g.order_number, 'Legacy record'
    FROM inventory_groups g
    WHERE g.status IN ('Tagged', 'Sold')
      AND NOT EXISTS (SELECT 1 FROM inventory_allocations a WHERE a.group_id = g.id)`).run();
}

async function availableForGroup(groupId: number, excludingAllocationId?: number) {
  const row = await env.DB.prepare(`SELECT
    g.quantity - COALESCE(SUM(CASE WHEN a.id != ? OR ? IS NULL THEN a.quantity ELSE 0 END), 0) AS available
    FROM inventory_groups g
    LEFT JOIN inventory_allocations a ON a.group_id = g.id
    WHERE g.id = ?
    GROUP BY g.id`)
    .bind(excludingAllocationId ?? null, excludingAllocationId ?? null, groupId)
    .first<{ available: number }>();
  return row?.available ?? -1;
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
    const activities = await env.DB.prepare(
      "SELECT id, group_id AS groupId, zone_id AS zoneId, activity_type AS activityType, activity_date AS activityDate, details, performed_by AS performedBy FROM activities ORDER BY activity_date DESC, id DESC"
    ).all();
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
      if (!data.zoneId || !data.species || !data.height || !data.caliper || !data.quantity || !data.plantedOn || !Number.isInteger(data.priceCents) || data.priceCents < 0) {
        return Response.json({ error: "Complete all required inventory fields with a valid non-negative price." }, { status: 400 });
      }
      const existing = await env.DB.prepare(`SELECT id, price_cents AS priceCents FROM inventory_groups
        WHERE zone_id = ? AND lower(species) = lower(?) AND height = ? AND caliper = ? LIMIT 1`)
        .bind(data.zoneId, data.species.trim(), data.height.trim(), data.caliper.trim())
        .first<{ id: number; priceCents: number }>();
      if (existing) {
        if (existing.priceCents !== data.priceCents) {
          return Response.json({ error: "This group already exists with a different price. Edit the existing group before adding more trees." }, { status: 409 });
        }
        await env.DB.prepare("UPDATE inventory_groups SET quantity = quantity + ?, planted_on = MIN(planted_on, ?) WHERE id = ?")
          .bind(data.quantity, data.plantedOn, existing.id).run();
        return Response.json({ ok: true, id: existing.id, merged: true }, { status: 200 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,price_cents,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,'Available','','',?) RETURNING id"
      ).bind(data.zoneId, data.species.trim(), data.height.trim(), data.caliper.trim(), data.quantity, data.priceCents, data.plantedOn).first();
      return Response.json({ ok: true, id: result?.id }, { status: 201 });
    }

    if (data.action === "update-group") {
      if (!data.groupId || !data.zoneId?.trim() || !data.species?.trim() || !data.height?.trim() || !data.caliper?.trim() || !data.quantity || data.quantity < 1 || !Number.isInteger(data.priceCents) || data.priceCents < 0) {
        return Response.json({ error: "Complete the zone, species, size, quantity, and price fields." }, { status: 400 });
      }
      const group = await env.DB.prepare(`SELECT g.id,
        COALESCE((SELECT SUM(quantity) FROM inventory_allocations WHERE group_id = g.id), 0) AS committed
        FROM inventory_groups g WHERE g.id = ?`).bind(data.groupId).first<{ id: number; committed: number }>();
      if (!group) return Response.json({ error: "That inventory group no longer exists." }, { status: 404 });
      if (data.quantity < group.committed) {
        return Response.json({ error: `Quantity cannot be lower than the ${group.committed} trees currently tagged or sold.` }, { status: 409 });
      }
      const duplicate = await env.DB.prepare(`SELECT id FROM inventory_groups
        WHERE id != ? AND zone_id = ? AND lower(species) = lower(?) AND height = ? AND caliper = ? LIMIT 1`)
        .bind(data.groupId, data.zoneId.trim(), data.species.trim(), data.height.trim(), data.caliper.trim())
        .first<{ id: number }>();
      if (duplicate) {
        return Response.json({ error: "Another inventory group already uses that zone, species, height, and caliper." }, { status: 409 });
      }
      await env.DB.batch([
        env.DB.prepare(`UPDATE inventory_groups
          SET zone_id = ?, species = ?, height = ?, caliper = ?, quantity = ?, price_cents = ?,
              planted_on = CASE WHEN ? = '' THEN planted_on ELSE ? END
          WHERE id = ?`)
          .bind(
            data.zoneId.trim(), data.species.trim(), data.height.trim(), data.caliper.trim(), data.quantity, data.priceCents,
            data.plantedOn || "", data.plantedOn || "", data.groupId,
          ),
        env.DB.prepare("UPDATE activities SET zone_id = ? WHERE group_id = ?").bind(data.zoneId.trim(), data.groupId),
      ]);
      return Response.json({ ok: true });
    }

    if (data.action === "delete-group") {
      if (!data.groupId || data.confirmGroupId !== data.groupId) {
        return Response.json({ error: "Inventory group confirmation did not match." }, { status: 400 });
      }
      const group = await env.DB.prepare(
        "SELECT id, species, quantity FROM inventory_groups WHERE id = ?"
      ).bind(data.groupId).first<{ id: number; species: string; quantity: number }>();
      if (!group) return Response.json({ error: "That inventory group has already been removed." }, { status: 404 });
      await env.DB.batch([
        env.DB.prepare("DELETE FROM inventory_allocations WHERE group_id = ?").bind(data.groupId),
        env.DB.prepare("DELETE FROM activities WHERE group_id = ?").bind(data.groupId),
        env.DB.prepare("DELETE FROM inventory_groups WHERE id = ?").bind(data.groupId),
      ]);
      return Response.json({ ok: true, removedQuantity: group.quantity, species: group.species });
    }

    if (data.action === "add-activity") {
      if (!data.groupId || !data.zoneId || !data.activityType || !data.activityDate) {
        return Response.json({ error: "Select a tree group and activity date." }, { status: 400 });
      }
      await env.DB.prepare(
        "INSERT INTO activities (group_id,zone_id,activity_type,activity_date,details,performed_by) VALUES (?,?,?,?,?,?)"
      ).bind(data.groupId, data.zoneId, data.activityType, data.activityDate, data.details || "", data.performedBy || "").run();
      return Response.json({ ok: true }, { status: 201 });
    }

    if (data.action === "add-allocation" || data.action === "update-allocation") {
      if (!data.groupId || !data.quantity || !data.status || !["Tagged", "Sold"].includes(data.status) || !data.client) {
        return Response.json({ error: "Enter a client, quantity, and Tagged or Sold status." }, { status: 400 });
      }
      const available = await availableForGroup(data.groupId, data.action === "update-allocation" ? data.allocationId : undefined);
      if (data.quantity > available) {
        return Response.json({ error: `Only ${available} trees are available in this group.` }, { status: 400 });
      }
      if (data.action === "update-allocation") {
        if (!data.allocationId) return Response.json({ error: "Missing client allocation." }, { status: 400 });
        await env.DB.prepare(`UPDATE inventory_allocations
          SET quantity = ?, status = ?, client = ?, order_number = ?, marking_method = ?
          WHERE id = ? AND group_id = ?`)
          .bind(data.quantity, data.status, data.client.trim(), data.orderNumber || "", data.markingMethod || "", data.allocationId, data.groupId).run();
        return Response.json({ ok: true });
      }
      const result = await env.DB.prepare(`INSERT INTO inventory_allocations
        (group_id, quantity, status, client, order_number, marking_method)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
        .bind(data.groupId, data.quantity, data.status, data.client.trim(), data.orderNumber || "", data.markingMethod || "").first();
      return Response.json({ ok: true, id: result?.id }, { status: 201 });
    }

    if (data.action === "receive-allocation") {
      if (!data.allocationId) return Response.json({ error: "Missing sold allocation." }, { status: 400 });
      const allocation = await env.DB.prepare(
        "SELECT id, group_id AS groupId, quantity, status FROM inventory_allocations WHERE id = ?"
      ).bind(data.allocationId).first<{ id: number; groupId: number; quantity: number; status: string }>();
      if (!allocation || allocation.status !== "Sold") {
        return Response.json({ error: "Only sold trees can be marked received." }, { status: 400 });
      }
      await env.DB.batch([
        env.DB.prepare("UPDATE inventory_groups SET quantity = quantity - ? WHERE id = ?").bind(allocation.quantity, allocation.groupId),
        env.DB.prepare("DELETE FROM inventory_allocations WHERE id = ?").bind(allocation.id),
        env.DB.prepare("DELETE FROM inventory_groups WHERE id = ? AND quantity <= 0").bind(allocation.groupId),
      ]);
      return Response.json({ ok: true, removedQuantity: allocation.quantity });
    }

    if (data.action === "remove-seed-data") {
      const seedGroups = await env.DB.prepare(`SELECT id, quantity FROM inventory_groups WHERE
        (id = 1 AND zone_id = 'F70-FRONT-01' AND species = 'Live Oak' AND quantity = 86 AND planted_on = '2024-02-12') OR
        (id = 2 AND zone_id = 'F70-FRONT-01' AND species = 'Bald Cypress' AND quantity = 42 AND planted_on = '2023-11-06') OR
        (id = 3 AND zone_id = 'F70-NORTH-03' AND species = 'Mahogany' AND quantity = 28 AND planted_on = '2023-08-18') OR
        (id = 4 AND zone_id = 'F40-WEST-05' AND species = 'Gumbo Limbo' AND quantity = 115 AND planted_on = '2025-01-20') OR
        (id = 5 AND zone_id = 'F25-NORTH-02' AND species = 'Royal Poinciana' AND quantity = 64 AND planted_on = '2024-05-14')`).all<{ id: number; quantity: number }>();
      if (seedGroups.results.length === 0) {
        return Response.json({ ok: true, removedGroups: 0, removedQuantity: 0, removedAllocations: 0 });
      }
      if (seedGroups.results.length !== 5) {
        return Response.json({ error: "The original seed records no longer match the expected set, so nothing was removed." }, { status: 409 });
      }
      const allocationCount = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM inventory_allocations WHERE group_id IN (1,2,3,4,5)"
      ).first<{ count: number }>();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM inventory_allocations WHERE group_id IN (1,2,3,4,5)"),
        env.DB.prepare("DELETE FROM activities WHERE group_id IN (1,2,3,4,5)"),
        env.DB.prepare("DELETE FROM inventory_groups WHERE id IN (1,2,3,4,5)"),
      ]);
      return Response.json({
        ok: true,
        removedGroups: 5,
        removedQuantity: seedGroups.results.reduce((sum, group) => sum + group.quantity, 0),
        removedAllocations: allocationCount?.count ?? 0,
      });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save change" }, { status: 500 });
  }
}
