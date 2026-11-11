import type { Rules } from "../../modules/kernel/index.ts";
import {
  IdentityService,
  PostgresIdentityStore,
  nodeSecrets,
  PostgresStore,
  SyncService,
  createPool,
  migrate,
} from "../../modules/kernel/server.ts";
import { schema, type EntityType } from "../../packages/contracts/entities.ts";
import { rules as calendar } from "../../modules/calendar/index.ts";
import { rules as documents } from "../../modules/documents/index.ts";
import { rules as finance } from "../../modules/finance/index.ts";
import { rules as habits } from "../../modules/habits/index.ts";
import { rules as metrics } from "../../modules/metrics/index.ts";
import { rules as practice } from "../../modules/practice/index.ts";
import { rules as tasks } from "../../modules/tasks/index.ts";

/** module name → the rules it contributes. Modules without server rules are absent. */
const modules: Record<string, Rules> = {
  calendar,
  documents,
  finance,
  habits,
  metrics,
  practice,
  tasks,
};

/** Composition root: the only place that knows every module. */
export function composeRules(): Rules {
  const all: Rules = {};
  for (const [module, rules] of Object.entries(modules))
    for (const type of Object.keys(rules) as EntityType[]) {
      if (schema[type].module !== module)
        throw new Error(`${module} may not attach rules to ${type}`);
      Object.assign(all, { [type]: rules[type] });
    }
  return all;
}

export async function compose(databaseUrl?: string) {
  const pool = createPool(databaseUrl);
  await migrate(pool);
  return {
    pool,
    sync: new SyncService(new PostgresStore(pool), composeRules()),
    identity: new IdentityService(
      new PostgresIdentityStore(pool),
      nodeSecrets,
      () => new Date(),
    ),
  };
}
