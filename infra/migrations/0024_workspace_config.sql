-- Generated from packages/contracts/schema.ts. Applied migrations are immutable.
CREATE TABLE workspace_configs (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  "preset" text CHECK ("preset" IN ('council', 'standard', 'minimal', 'custom')),
  "disabled_features" jsonb,
  "feature_aliases" text,
  "hidden_departments" jsonb,
  "department_aliases" text,
  "sidebar_favorites" jsonb,
  "phone_shortcuts" jsonb,
  "home_cards" jsonb,
  PRIMARY KEY (owner_id, id)
);
