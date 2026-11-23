CREATE TABLE `studio_board_submission` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`card_id` text NOT NULL,
	`generation_id` text NOT NULL,
	CONSTRAINT `fk_studio_board_submission_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `studio_board` (
	`session_id` text PRIMARY KEY,
	`directory` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`document` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_studio_board_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `session` ADD `studio_mode` text;--> statement-breakpoint
CREATE UNIQUE INDEX `studio_board_submission_generation_idx` ON `studio_board_submission` (`generation_id`);