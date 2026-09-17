CREATE TABLE `insight_artifact_observation` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`tool_call_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `insight_artifact_fact` ADD `state` text DEFAULT 'processed' NOT NULL;--> statement-breakpoint
ALTER TABLE `insight_artifact_fact` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `insight_artifact_fact` ADD `next_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `insight_artifact_fact` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `task_id` text;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `query_tool` text;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `query_input` text;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `next_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `deadline_at` integer;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `lease` text;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `lease_until` integer;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `error` text;--> statement-breakpoint
ALTER TABLE `insight_artifact_task` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `insight_artifact_observation_message_idx` ON `insight_artifact_observation` (`message_id`,`updated_at`);
--> statement-breakpoint
UPDATE `insight_artifact_task` SET `state` = 'unsupported', `error` = 'legacy task lacks provider polling metadata' WHERE `provider` IS NULL;
