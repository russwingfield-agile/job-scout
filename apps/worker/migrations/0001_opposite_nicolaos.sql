CREATE TABLE `vectors` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`posted_ts` integer,
	`group_id` text,
	`embedding` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vectors_kind_posted_ts` ON `vectors` (`kind`,`posted_ts`);