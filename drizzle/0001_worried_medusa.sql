CREATE TABLE `inventory_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`client` text DEFAULT '' NOT NULL,
	`order_number` text DEFAULT '' NOT NULL,
	`marking_method` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
