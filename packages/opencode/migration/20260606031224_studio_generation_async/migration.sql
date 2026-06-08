CREATE TABLE `studio_generation` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`directory` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`tool_part_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_task_id` text,
	`capability` text NOT NULL,
	`status` text NOT NULL,
	`raw_status` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`queue_order` integer,
	`request` text NOT NULL,
	`result` text,
	`error` text,
	`next_poll_at` integer NOT NULL,
	`poll_attempts` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_studio_generation_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `studio_generation_directory_status_poll_idx` ON `studio_generation` (`directory`,`status`,`next_poll_at`);--> statement-breakpoint
CREATE INDEX `studio_generation_session_idx` ON `studio_generation` (`session_id`);
