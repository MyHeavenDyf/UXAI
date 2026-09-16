CREATE TABLE `insight_artifact_event` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`payload` text,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`lease_until` integer,
	`reason` text
);
--> statement-breakpoint
CREATE TABLE `insight_artifact_fact` (
	`part_id` text PRIMARY KEY,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insight_artifact_scan` (
	`message_id` text PRIMARY KEY,
	`baseline` text NOT NULL,
	`diagnostic` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insight_artifact_task` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`tool` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insight_artifact_turn` (
	`message_id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`root_message_id` text NOT NULL,
	`root_session_id` text NOT NULL,
	`directory` text NOT NULL,
	`account` text,
	`uid` text,
	`version` text,
	`owner` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `insight_artifact_pending_idx` ON `insight_artifact_event` (`state`,`next_at`);