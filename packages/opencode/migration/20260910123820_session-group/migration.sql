CREATE TABLE `session_group_mapping` (
	`session_id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_session_group_mapping_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_group_mapping_group_id_session_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `session_group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_group` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`namespace` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_session_group_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `studio_generation` ADD `last_poll_error` text;--> statement-breakpoint
CREATE INDEX `session_group_mapping_group_idx` ON `session_group_mapping` (`group_id`);--> statement-breakpoint
CREATE INDEX `session_group_project_idx` ON `session_group` (`project_id`);--> statement-breakpoint
CREATE INDEX `session_group_dir_ns_idx` ON `session_group` (`directory`,`namespace`);