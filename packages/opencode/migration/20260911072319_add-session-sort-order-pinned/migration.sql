ALTER TABLE `session_group_mapping` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `pinned` integer DEFAULT 0 NOT NULL;