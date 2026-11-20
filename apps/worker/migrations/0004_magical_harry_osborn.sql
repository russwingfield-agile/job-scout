PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assessments` (
	`group_id` text PRIMARY KEY NOT NULL,
	`model` text,
	`fit_score` real,
	`best_cv_id` text,
	`result_json` text,
	`status` text NOT NULL,
	`prompt_version` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_assessments`("group_id", "model", "fit_score", "best_cv_id", "result_json", "status", "prompt_version", "created_at") SELECT "group_id", "model", "fit_score", "best_cv_id", "result_json", "status", "prompt_version", "created_at" FROM `assessments`;--> statement-breakpoint
DROP TABLE `assessments`;--> statement-breakpoint
ALTER TABLE `__new_assessments` RENAME TO `assessments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;