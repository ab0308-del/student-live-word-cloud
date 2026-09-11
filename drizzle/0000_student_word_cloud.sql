CREATE TABLE `settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `question` text NOT NULL,
  `is_open` integer NOT NULL DEFAULT 1,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `responses` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `student_name` text,
  `answer` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_responses_answer` ON `responses` (`answer`);
--> statement-breakpoint
CREATE INDEX `idx_responses_created_at` ON `responses` (`created_at`);
--> statement-breakpoint
PRAGMA optimize;
