CREATE TABLE `agent_tool_call_parent` (
	`message_id` text PRIMARY KEY,
	`invocation_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_tool_call` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`call_id` text NOT NULL,
	`process_id` integer NOT NULL,
	`process_token` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`data` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_tool_call_open_idx` ON `agent_tool_call` (`ended_at`);