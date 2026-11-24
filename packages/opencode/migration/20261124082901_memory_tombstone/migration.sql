CREATE TABLE `memory_tombstone` (
	`project_id` text NOT NULL,
	`topic` text NOT NULL,
	`time_deleted` integer NOT NULL,
	CONSTRAINT `memory_tombstone_pk` PRIMARY KEY(`project_id`, `topic`),
	CONSTRAINT `fk_memory_tombstone_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
