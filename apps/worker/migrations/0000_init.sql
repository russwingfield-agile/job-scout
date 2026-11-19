CREATE TABLE `applications` (
	`group_id` text PRIMARY KEY NOT NULL,
	`cv_id_sent` text,
	`applied_at` text,
	`notes` text,
	`skip_reason` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assessments` (
	`group_id` text PRIMARY KEY NOT NULL,
	`model` text,
	`fit_score` real,
	`best_cv_id` text,
	`result_json` text NOT NULL,
	`status` text NOT NULL,
	`prompt_version` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cover_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`cv_id` text,
	`kind` text,
	`tone` text,
	`text` text,
	`created_at` text
);
--> statement-breakpoint
CREATE TABLE `cvs` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text,
	`text_md` text NOT NULL,
	`summary_json` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_cv_similarity` (
	`group_id` text NOT NULL,
	`cv_id` text NOT NULL,
	`similarity` real,
	PRIMARY KEY(`group_id`, `cv_id`)
);
--> statement-breakpoint
CREATE TABLE `job_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_job_id` text,
	`status` text NOT NULL,
	`prefilter_score` real,
	`final_score` real,
	`feedback_adj` real DEFAULT 0,
	`feedback_reasons_json` text,
	`best_cv_id` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`run_id` text,
	`new_postings_since_action` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_groups_status_score` ON `job_groups` (`status`,"final_score" DESC);--> statement-breakpoint
CREATE INDEX `idx_groups_first_seen_at` ON `job_groups` (`first_seen_at`);--> statement-breakpoint
CREATE TABLE `job_profile_hits` (
	`job_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`run_id` text,
	PRIMARY KEY(`job_id`, `profile_id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`source` text NOT NULL,
	`source_job_id` text NOT NULL,
	`url` text,
	`external_apply_url` text,
	`title` text,
	`employer_name` text,
	`is_agency` integer,
	`location` text,
	`work_mode` text,
	`employment_type` text,
	`salary_text` text,
	`pay_min` real,
	`pay_max` real,
	`pay_period` text,
	`annualised_min` real,
	`annualised_max` real,
	`ir35` text,
	`contract_length_months` real,
	`posted_at` text,
	`expires_at` text,
	`description_text` text,
	`description_html` text,
	`applications_count` integer,
	`filter_reason` text,
	`raw_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `job_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_jobs_source_job` ON `jobs` (`source`,`source_job_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_group_id` ON `jobs` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_posted_at` ON `jobs` (`posted_at`);--> statement-breakpoint
CREATE TABLE `processed_messages` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text,
	`stage` text,
	`ref` text,
	`message` text,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_run_errors_run_id` ON `run_errors` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_key` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`phase` text DEFAULT 'ingest' NOT NULL,
	`pending_ingest` integer DEFAULT 0 NOT NULL,
	`pending_score` integer DEFAULT 0 NOT NULL,
	`counts_json` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_slot_key_unique` ON `runs` (`slot_key`);--> statement-breakpoint
CREATE INDEX `idx_runs_started_at` ON `runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `search_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`cv_id` text NOT NULL,
	`job_titles_json` text NOT NULL,
	`must_keywords_json` text,
	`exclude_keywords_json` text,
	`locations_json` text NOT NULL,
	`radius_miles` integer DEFAULT 25,
	`employment_types_json` text NOT NULL,
	`min_day_rate` integer,
	`min_salary` integer,
	`ir35_preference` text DEFAULT 'any',
	`work_modes_json` text,
	`max_onsite_days` integer,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cv_id`) REFERENCES `cvs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text,
	`source` text,
	`endpoint` text,
	`status` integer,
	`ms` integer,
	`created_at` text
);
--> statement-breakpoint
CREATE TABLE `status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` text,
	`from_status` text,
	`to_status` text,
	`at` text
);
--> statement-breakpoint
CREATE INDEX `idx_status_history_group_id` ON `status_history` (`group_id`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`reed_calls` integer DEFAULT 0,
	`llm_calls` integer DEFAULT 0,
	`embed_calls` integer DEFAULT 0,
	`neurons_est` integer DEFAULT 0
);
