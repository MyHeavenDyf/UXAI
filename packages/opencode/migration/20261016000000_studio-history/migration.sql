CREATE TABLE IF NOT EXISTS `studio_history_excluded` (
	`media_id` text NOT NULL,
	`directory` text NOT NULL,
	`generation_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `studio_history_excluded_pk` PRIMARY KEY(`directory`, `media_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `studio_history` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`directory` text NOT NULL,
	`generation_id` text NOT NULL,
	`media_index` integer NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`thumbnail_url` text,
	`thumbnail_status` text,
	`width` integer,
	`height` integer,
	`aspect_ratio` text,
	`resolution` text,
	`ratio` text,
	`capability` text,
	`duration` text,
	`created_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `studio_history_pk` PRIMARY KEY(`directory`, `id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `studio_history_excluded_directory_idx` ON `studio_history_excluded` (`directory`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `studio_history_excluded_generation_idx` ON `studio_history_excluded` (`directory`,`generation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `studio_history_directory_idx` ON `studio_history` (`directory`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `studio_history_directory_created_idx` ON `studio_history` (`directory`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `studio_history_directory_kind_created_idx` ON `studio_history` (`directory`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `studio_history_session_idx` ON `studio_history` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `studio_history_generation_idx` ON `studio_history` (`generation_id`);
