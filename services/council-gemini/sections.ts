import type { EntityType } from "../../packages/contracts/entities.ts";
import { readableSections } from "../council-query/query.ts";

export const basicSections = {
  reference_notes: ["document"],
  tasks: readableSections.tasks,
  reading: ["readingItem"],
} as const satisfies Record<string, readonly EntityType[]>;

const { notes: _notes, ...sharedSections } = readableSections;
export const expandedSections = {
  ...basicSections,
  ...sharedSections,
  personal_thoughts: ["document"],
  monthly_reports: ["document"],
  raw_materials: ["journal"],
  memoir: ["memoir"],
  ideas: ["idea"],
  departments: ["department"],
  practice: ["domain", "activity", "problem", "solution", "practiceEvent", "session", "progress"],
  preparation_checklists: ["checklist", "checklistRun"],
  metrics: ["metric", "metricLog"],
} as const satisfies Record<string, readonly EntityType[]>;

export const expandedTypes = [...new Set(Object.values(expandedSections).flat())];
