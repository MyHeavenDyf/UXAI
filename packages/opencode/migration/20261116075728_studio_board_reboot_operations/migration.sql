CREATE TABLE `studio_board_operation` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`provider_task_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	CONSTRAINT `fk_studio_board_operation_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
