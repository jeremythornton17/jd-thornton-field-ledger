import { env } from "cloudflare:workers";

type InventoryPayload = {
  action?: "add-group" | "add-activity" | "update-status";
  zoneId?: string;
  species?: string;
  height?: string;
  caliper?: string;
  quantity?: number;
  status?: string;
  client?: string;
  orderNumber?: string;
  plantedOn?: string;
  groupId?: number;
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
  ]);
}

async function seedIfEmpty() {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM inventory_groups").first<{
    count: number;
  }>();
  if ((row?.count ?? 0) > 0) return;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind("F70-FRONT-01", "Live Oak", "12–14 ft", "3.5 in", 86, "Available", "", "", "2024-02-12"),
    env.DB.prepare(
      "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind("F70-FRONT-01", "Bald Cypress", "10–12 ft", "3 in", 42, "Tagged", "Palm Beach Gardens", "SO-2408", "2023-11-06"),
    env.DB.prepare(
      "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind("F70-NORTH-03", "Mahogany", "14–16 ft", "4 in", 28, "Sold", "Evergreen Landscape", "SO-2391", "2023-08-18"),
    env.DB.prepare(
      "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind("F40-WEST-05", "Gumbo Limbo", "8–10 ft", "2.5 in", 115, "Available", "", "", "2025-01-20"),
    env.DB.prepare(
      "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind("F25-NORTH-02", "Royal Poinciana", "10–12 ft", "3 in", 64, "Available", "", "", "2024-05-14"),
  ]);
}

export async function GET() {
  try {
    await ensureSchema();
    await seedIfEmpty();
    const groups = await env.DB.prepare(
      "SELECT id, zone_id AS zoneId, species, height, caliper, quantity, status, client, order_number AS orderNumber, planted_on AS plantedOn FROM inventory_groups ORDER BY id DESC"
    ).all();
    const activities = await env.DB.prepare(
      "SELECT id, group_id AS groupId, zone_id AS zoneId, activity_type AS activityType, activity_date AS activityDate, details, performed_by AS performedBy FROM activities ORDER BY activity_date DESC, id DESC"
    ).all();
    return Response.json({ groups: groups.results, activities: activities.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load inventory" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const data = (await request.json()) as InventoryPayload;

    if (data.action === "add-group") {
      if (!data.zoneId || !data.species || !data.height || !data.caliper || !data.quantity || !data.plantedOn) {
        return Response.json({ error: "Complete all required inventory fields." }, { status: 400 });
      }
      const result = await env.DB.prepare(
        "INSERT INTO inventory_groups (zone_id,species,height,caliper,quantity,status,client,order_number,planted_on) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id"
      ).bind(data.zoneId, data.species, data.height, data.caliper, data.quantity, data.status || "Available", data.client || "", data.orderNumber || "", data.plantedOn).first();
      return Response.json({ ok: true, id: result?.id }, { status: 201 });
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

    if (data.action === "update-status") {
      if (!data.groupId || !data.status) return Response.json({ error: "Missing status update." }, { status: 400 });
      await env.DB.prepare(
        "UPDATE inventory_groups SET status=?, client=?, order_number=? WHERE id=?"
      ).bind(data.status, data.client || "", data.orderNumber || "", data.groupId).run();
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save change" }, { status: 500 });
  }
}
