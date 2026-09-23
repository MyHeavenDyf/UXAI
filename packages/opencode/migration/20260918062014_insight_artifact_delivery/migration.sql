CREATE TABLE `insight_artifact_delivery_event` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`part_id` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`lease` text,
	`lease_until` integer,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insight_artifact_delivery_receipt` (
	`part_id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`tool` text NOT NULL,
	`task_id` text,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insight_artifact_delivery_task` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`tool` text NOT NULL,
	`completed_part_id` text
);
--> statement-breakpoint
CREATE TABLE `insight_artifact_delivery_turn` (
	`message_id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`root_message_id` text NOT NULL,
	`root_session_id` text NOT NULL,
	`directory` text NOT NULL,
	`account` text,
	`uid` text,
	`version` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `insight_artifact_delivery_event_due_idx` ON `insight_artifact_delivery_event` (`state`,`next_at`);