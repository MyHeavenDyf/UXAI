ALTER TABLE `studio_history` ADD `prompt` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `display_prompt` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `detail_prompt` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `detail_title` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `model` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `style_model` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `video_mode` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `video_quality_mode` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `tool_action` text;--> statement-breakpoint
ALTER TABLE `studio_history` ADD `is_custom` integer;