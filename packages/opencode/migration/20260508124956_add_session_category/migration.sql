CREATE TABLE `session_category` (
  `session_id` text PRIMARY KEY REFERENCES `session`(`id`) ON DELETE CASCADE,
  `category` text NOT NULL,
  `time_created` integer,
  `time_updated` integer
);
CREATE INDEX `session_category_category_idx` ON `session_category` (`category`);
