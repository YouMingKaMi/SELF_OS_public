-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE sync_clock (
  owner_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE sync_receipts (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  operation_id uuid NOT NULL,
  hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'conflict')),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  revision bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, device_id, operation_id)
);
-- One row per entity pointing at its latest revision: the change feed is compact by construction.
CREATE TABLE sync_heads (
  owner_id text NOT NULL,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY (owner_id, entity_id)
);
CREATE UNIQUE INDEX sync_heads_revision_idx ON sync_heads (owner_id, revision);
CREATE TABLE workspace_departments (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "features" jsonb,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE practice_domains (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "focused" boolean,
  "order" double precision,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE practice_activities (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "domain_id" uuid NOT NULL,
  "name" text NOT NULL,
  "archived" boolean,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE practice_problems (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "domain_id" uuid NOT NULL,
  "activity_id" uuid,
  "title" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending', 'active', 'resolved', 'discarded')),
  "focused" boolean,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE practice_solutions (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "problem_id" uuid NOT NULL,
  "parent_id" uuid,
  "title" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending', 'active', 'resolved', 'discarded')),
  "reason" text,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE practice_sessions (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "domain_id" uuid NOT NULL,
  "activity_id" uuid,
  "problem_id" uuid,
  "solution_id" uuid,
  "title" text NOT NULL,
  "day" date NOT NULL,
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "elapsed_seconds" double precision,
  "running_since" timestamptz,
  "status" text NOT NULL CHECK ("status" IN ('running', 'paused', 'finished', 'cancelled')),
  "note" text,
  "manual" boolean,
  "segments" jsonb,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE practice_progress (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "domain_id" uuid NOT NULL,
  "activity_id" uuid,
  "problem_id" uuid,
  "solution_id" uuid,
  "day" date NOT NULL,
  "body" text NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE tasks (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "title" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending', 'completed', 'discarded')),
  "schedule_kind" text NOT NULL CHECK ("schedule_kind" IN ('unscheduled', 'recent', 'day', 'deadline', 'range')),
  "schedule_date" date,
  "schedule_start" date,
  "schedule_end" date,
  "created_at" timestamptz,
  "completed_at" timestamptz,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE preparation_checklists (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "items" jsonb,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE preparation_runs (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "checklist_id" uuid NOT NULL,
  "day" date NOT NULL,
  "checked" jsonb,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE habit_definitions (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('binary', 'quantity', 'checklist')),
  "unit" text,
  "items" jsonb,
  "status" text NOT NULL CHECK ("status" IN ('active', 'paused', 'optional', 'archived')),
  "show_home" boolean,
  "order" double precision,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE habit_rules (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "habit_id" uuid NOT NULL,
  "effective_from" date NOT NULL,
  "target" double precision,
  "weekdays" jsonb,
  "kind" text CHECK ("kind" IN ('binary', 'quantity', 'checklist')),
  "unit" text,
  "items" jsonb,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE habit_logs (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "habit_id" uuid NOT NULL,
  "rule_id" uuid,
  "day" date NOT NULL,
  "value" double precision,
  "items" jsonb,
  "hidden" boolean,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE expense_budgets (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "month" text NOT NULL CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "amount_minor" bigint NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE expense_categories (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "parent_id" uuid,
  "necessary" boolean,
  "default_child_id" uuid,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE expense_entries (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "title" text NOT NULL,
  "day" date NOT NULL,
  "amount_minor" bigint NOT NULL,
  "category_id" uuid,
  "subcategory_id" uuid,
  "necessary" boolean,
  "mode" text NOT NULL CHECK ("mode" IN ('immediate', 'estimated', 'fixed')),
  "start_day" date,
  "end_day" date,
  "ended_day" date,
  "recovery_minor" bigint,
  "recovery_day" date,
  "note" text,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE recurring_expenses (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "category_id" uuid,
  "active" boolean,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE treasury_wallets (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL CHECK ("category" IN ('cny', 'external', 'crypto', 'stock')),
  "asset" text,
  "currency" text NOT NULL,
  "unit_price" numeric,
  "exchange_rate" numeric,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE treasury_entries (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "wallet_id" uuid NOT NULL,
  "mode" text NOT NULL CHECK ("mode" IN ('set', 'delta')),
  "quantity" numeric NOT NULL,
  "at" timestamptz NOT NULL,
  "reason" text,
  "unit_price" numeric,
  "exchange_rate" numeric,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE documents (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "kind" text NOT NULL CHECK ("kind" IN ('note', 'thought', 'monthly')),
  "day" date,
  "month" text CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "domain_id" uuid,
  "activity_id" uuid,
  "source" text CHECK ("source" IN ('unknown', 'original', 'ai', 'assisted', 'excerpt')),
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE journal_entries (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('chronicle', 'raw')),
  "day" date NOT NULL,
  "body" text NOT NULL,
  "complete" boolean,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE idea_entries (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "body" text NOT NULL,
  "day" date NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending', 'completed', 'discarded')),
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE metric_definitions (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "unit" text,
  "minimum" double precision,
  "maximum" double precision,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE metric_entries (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "metric_id" uuid NOT NULL,
  "day" date NOT NULL,
  "value" double precision,
  "note" text,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE important_days (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "name" text NOT NULL,
  "calendar" text NOT NULL CHECK ("calendar" IN ('solar', 'lunar')),
  "date" date,
  "lunar_year" integer,
  "lunar_month" integer,
  "lunar_day" integer,
  "leap" boolean,
  "repeat" text NOT NULL CHECK ("repeat" IN ('once', 'weekly', 'monthly', 'yearly', 'custom')),
  "interval" integer,
  "interval_unit" text NOT NULL CHECK ("interval_unit" IN ('day', 'week', 'month', 'year')),
  "remind_days" integer,
  "dismissed_date" text,
  "note" text,
  PRIMARY KEY (owner_id, id)
);
ALTER TABLE practice_activities ADD CONSTRAINT practice_activities_domain_id_fk FOREIGN KEY (owner_id, "domain_id") REFERENCES practice_domains(owner_id, id);
CREATE INDEX practice_activities_domain_id_idx ON practice_activities (owner_id, "domain_id") WHERE NOT deleted;
ALTER TABLE practice_problems ADD CONSTRAINT practice_problems_domain_id_fk FOREIGN KEY (owner_id, "domain_id") REFERENCES practice_domains(owner_id, id);
ALTER TABLE practice_problems ADD CONSTRAINT practice_problems_activity_id_fk FOREIGN KEY (owner_id, "activity_id") REFERENCES practice_activities(owner_id, id);
CREATE INDEX practice_problems_domain_id_idx ON practice_problems (owner_id, "domain_id") WHERE NOT deleted;
CREATE INDEX practice_problems_activity_id_idx ON practice_problems (owner_id, "activity_id") WHERE NOT deleted;
ALTER TABLE practice_solutions ADD CONSTRAINT practice_solutions_problem_id_fk FOREIGN KEY (owner_id, "problem_id") REFERENCES practice_problems(owner_id, id);
ALTER TABLE practice_solutions ADD CONSTRAINT practice_solutions_parent_id_fk FOREIGN KEY (owner_id, "parent_id") REFERENCES practice_solutions(owner_id, id);
CREATE INDEX practice_solutions_problem_id_idx ON practice_solutions (owner_id, "problem_id") WHERE NOT deleted;
CREATE INDEX practice_solutions_parent_id_idx ON practice_solutions (owner_id, "parent_id") WHERE NOT deleted;
ALTER TABLE practice_sessions ADD CONSTRAINT practice_sessions_domain_id_fk FOREIGN KEY (owner_id, "domain_id") REFERENCES practice_domains(owner_id, id);
ALTER TABLE practice_sessions ADD CONSTRAINT practice_sessions_activity_id_fk FOREIGN KEY (owner_id, "activity_id") REFERENCES practice_activities(owner_id, id);
ALTER TABLE practice_sessions ADD CONSTRAINT practice_sessions_problem_id_fk FOREIGN KEY (owner_id, "problem_id") REFERENCES practice_problems(owner_id, id);
ALTER TABLE practice_sessions ADD CONSTRAINT practice_sessions_solution_id_fk FOREIGN KEY (owner_id, "solution_id") REFERENCES practice_solutions(owner_id, id);
CREATE INDEX practice_sessions_domain_id_idx ON practice_sessions (owner_id, "domain_id") WHERE NOT deleted;
CREATE INDEX practice_sessions_activity_id_idx ON practice_sessions (owner_id, "activity_id") WHERE NOT deleted;
CREATE INDEX practice_sessions_problem_id_idx ON practice_sessions (owner_id, "problem_id") WHERE NOT deleted;
CREATE INDEX practice_sessions_solution_id_idx ON practice_sessions (owner_id, "solution_id") WHERE NOT deleted;
CREATE INDEX practice_sessions_day_idx ON practice_sessions (owner_id, "day") WHERE NOT deleted;
ALTER TABLE practice_progress ADD CONSTRAINT practice_progress_domain_id_fk FOREIGN KEY (owner_id, "domain_id") REFERENCES practice_domains(owner_id, id);
ALTER TABLE practice_progress ADD CONSTRAINT practice_progress_activity_id_fk FOREIGN KEY (owner_id, "activity_id") REFERENCES practice_activities(owner_id, id);
ALTER TABLE practice_progress ADD CONSTRAINT practice_progress_problem_id_fk FOREIGN KEY (owner_id, "problem_id") REFERENCES practice_problems(owner_id, id);
ALTER TABLE practice_progress ADD CONSTRAINT practice_progress_solution_id_fk FOREIGN KEY (owner_id, "solution_id") REFERENCES practice_solutions(owner_id, id);
CREATE INDEX practice_progress_domain_id_idx ON practice_progress (owner_id, "domain_id") WHERE NOT deleted;
CREATE INDEX practice_progress_activity_id_idx ON practice_progress (owner_id, "activity_id") WHERE NOT deleted;
CREATE INDEX practice_progress_problem_id_idx ON practice_progress (owner_id, "problem_id") WHERE NOT deleted;
CREATE INDEX practice_progress_solution_id_idx ON practice_progress (owner_id, "solution_id") WHERE NOT deleted;
CREATE INDEX practice_progress_day_idx ON practice_progress (owner_id, "day") WHERE NOT deleted;
CREATE INDEX tasks_schedule_date_idx ON tasks (owner_id, "schedule_date") WHERE NOT deleted;
CREATE INDEX tasks_schedule_start_idx ON tasks (owner_id, "schedule_start") WHERE NOT deleted;
CREATE INDEX tasks_schedule_end_idx ON tasks (owner_id, "schedule_end") WHERE NOT deleted;
ALTER TABLE preparation_runs ADD CONSTRAINT preparation_runs_checklist_id_fk FOREIGN KEY (owner_id, "checklist_id") REFERENCES preparation_checklists(owner_id, id);
CREATE INDEX preparation_runs_checklist_id_idx ON preparation_runs (owner_id, "checklist_id") WHERE NOT deleted;
CREATE INDEX preparation_runs_day_idx ON preparation_runs (owner_id, "day") WHERE NOT deleted;
ALTER TABLE habit_rules ADD CONSTRAINT habit_rules_habit_id_fk FOREIGN KEY (owner_id, "habit_id") REFERENCES habit_definitions(owner_id, id);
CREATE INDEX habit_rules_habit_id_idx ON habit_rules (owner_id, "habit_id") WHERE NOT deleted;
CREATE INDEX habit_rules_effective_from_idx ON habit_rules (owner_id, "effective_from") WHERE NOT deleted;
ALTER TABLE habit_logs ADD CONSTRAINT habit_logs_habit_id_fk FOREIGN KEY (owner_id, "habit_id") REFERENCES habit_definitions(owner_id, id);
ALTER TABLE habit_logs ADD CONSTRAINT habit_logs_rule_id_fk FOREIGN KEY (owner_id, "rule_id") REFERENCES habit_rules(owner_id, id);
CREATE INDEX habit_logs_habit_id_idx ON habit_logs (owner_id, "habit_id") WHERE NOT deleted;
CREATE INDEX habit_logs_rule_id_idx ON habit_logs (owner_id, "rule_id") WHERE NOT deleted;
CREATE INDEX habit_logs_day_idx ON habit_logs (owner_id, "day") WHERE NOT deleted;
ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_parent_id_fk FOREIGN KEY (owner_id, "parent_id") REFERENCES expense_categories(owner_id, id);
ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_default_child_id_fk FOREIGN KEY (owner_id, "default_child_id") REFERENCES expense_categories(owner_id, id);
CREATE INDEX expense_categories_parent_id_idx ON expense_categories (owner_id, "parent_id") WHERE NOT deleted;
CREATE INDEX expense_categories_default_child_id_idx ON expense_categories (owner_id, "default_child_id") WHERE NOT deleted;
ALTER TABLE expense_entries ADD CONSTRAINT expense_entries_category_id_fk FOREIGN KEY (owner_id, "category_id") REFERENCES expense_categories(owner_id, id);
ALTER TABLE expense_entries ADD CONSTRAINT expense_entries_subcategory_id_fk FOREIGN KEY (owner_id, "subcategory_id") REFERENCES expense_categories(owner_id, id);
CREATE INDEX expense_entries_day_idx ON expense_entries (owner_id, "day") WHERE NOT deleted;
CREATE INDEX expense_entries_category_id_idx ON expense_entries (owner_id, "category_id") WHERE NOT deleted;
CREATE INDEX expense_entries_subcategory_id_idx ON expense_entries (owner_id, "subcategory_id") WHERE NOT deleted;
CREATE INDEX expense_entries_start_day_idx ON expense_entries (owner_id, "start_day") WHERE NOT deleted;
CREATE INDEX expense_entries_end_day_idx ON expense_entries (owner_id, "end_day") WHERE NOT deleted;
CREATE INDEX expense_entries_ended_day_idx ON expense_entries (owner_id, "ended_day") WHERE NOT deleted;
CREATE INDEX expense_entries_recovery_day_idx ON expense_entries (owner_id, "recovery_day") WHERE NOT deleted;
ALTER TABLE recurring_expenses ADD CONSTRAINT recurring_expenses_category_id_fk FOREIGN KEY (owner_id, "category_id") REFERENCES expense_categories(owner_id, id);
CREATE INDEX recurring_expenses_category_id_idx ON recurring_expenses (owner_id, "category_id") WHERE NOT deleted;
ALTER TABLE treasury_entries ADD CONSTRAINT treasury_entries_wallet_id_fk FOREIGN KEY (owner_id, "wallet_id") REFERENCES treasury_wallets(owner_id, id);
CREATE INDEX treasury_entries_wallet_id_idx ON treasury_entries (owner_id, "wallet_id") WHERE NOT deleted;
ALTER TABLE documents ADD CONSTRAINT documents_domain_id_fk FOREIGN KEY (owner_id, "domain_id") REFERENCES practice_domains(owner_id, id);
ALTER TABLE documents ADD CONSTRAINT documents_activity_id_fk FOREIGN KEY (owner_id, "activity_id") REFERENCES practice_activities(owner_id, id);
CREATE INDEX documents_day_idx ON documents (owner_id, "day") WHERE NOT deleted;
CREATE INDEX documents_domain_id_idx ON documents (owner_id, "domain_id") WHERE NOT deleted;
CREATE INDEX documents_activity_id_idx ON documents (owner_id, "activity_id") WHERE NOT deleted;
CREATE INDEX journal_entries_day_idx ON journal_entries (owner_id, "day") WHERE NOT deleted;
CREATE INDEX idea_entries_day_idx ON idea_entries (owner_id, "day") WHERE NOT deleted;
ALTER TABLE metric_entries ADD CONSTRAINT metric_entries_metric_id_fk FOREIGN KEY (owner_id, "metric_id") REFERENCES metric_definitions(owner_id, id);
CREATE INDEX metric_entries_metric_id_idx ON metric_entries (owner_id, "metric_id") WHERE NOT deleted;
CREATE INDEX metric_entries_day_idx ON metric_entries (owner_id, "day") WHERE NOT deleted;
CREATE INDEX important_days_date_idx ON important_days (owner_id, "date") WHERE NOT deleted;
