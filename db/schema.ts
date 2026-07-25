import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const inventoryGroups = sqliteTable("inventory_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  zoneId: text("zone_id").notNull(),
  species: text("species").notNull(),
  height: text("height").notNull(),
  caliper: text("caliper").notNull(),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull().default("Available"),
  client: text("client").notNull().default(""),
  orderNumber: text("order_number").notNull().default(""),
  plantedOn: text("planted_on").notNull(),
});

export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  zoneId: text("zone_id").notNull(),
  activityType: text("activity_type").notNull(),
  activityDate: text("activity_date").notNull(),
  details: text("details").notNull().default(""),
  performedBy: text("performed_by").notNull().default(""),
});
