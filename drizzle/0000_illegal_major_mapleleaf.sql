CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`zone_id` text NOT NULL,
	`activity_type` text NOT NULL,
	`activity_date` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`performed_by` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`zone_id` text NOT NULL,
	`species` text NOT NULL,
	`height` text NOT NULL,
	`caliper` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'Available' NOT NULL,
	`client` text DEFAULT '' NOT NULL,
	`order_number` text DEFAULT '' NOT NULL,
	`planted_on` text NOT NULL
);
