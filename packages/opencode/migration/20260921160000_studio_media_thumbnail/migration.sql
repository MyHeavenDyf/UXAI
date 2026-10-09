CREATE TABLE `studio_media_thumbnail` (
  `id` text PRIMARY KEY NOT NULL,
  `generation_id` text NOT NULL,
  `session_id` text NOT NULL,
  `directory` text NOT NULL,
  `media_index` integer NOT NULL,
  `kind` text NOT NULL,
  `source_url` text NOT NULL,
  `status` text NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `next_retry_at` integer NOT NULL,
  `lease_owner` text,
  `lease_expires_at` integer,
  `thumbnail_path` text,
  `error` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`generation_id`) REFERENCES `studio_generation`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_media_thumbnail_generation_media_idx` ON `studio_media_thumbnail` (`generation_id`,`media_index`);
--> statement-breakpoint
CREATE INDEX `studio_media_thumbnail_directory_status_retry_idx` ON `studio_media_thumbnail` (`directory`,`status`,`next_retry_at`);
--> statement-breakpoint
CREATE INDEX `studio_media_thumbnail_session_idx` ON `studio_media_thumbnail` (`session_id`);
