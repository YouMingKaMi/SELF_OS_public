import { createHash } from "node:crypto";
import {
  schema,
  type AnyEntity,
  type Changes,
  type Command,
  type Data,
  type EntityType,
  type Receipt,
} from "../../../packages/contracts/entities.ts";
import type { EntitySpec } from "../../../packages/contracts/fields.ts";
import { normalize } from "../domain/normalize.ts";
import type { EntityRule, Rules, Store } from "./ports.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}

/**
 * The one write path and the one read path of the sync protocol.
 * Knows nothing about any business module: field shapes come from the schema,
 * business rules are injected by the composition root.
 */
export class SyncService {
  private store: Store;
  private rules: Rules;
  private now: () => Date;
  constructor(store: Store, rules: Rules, now: () => Date = () => new Date()) {
    this.store = store;
    this.rules = rules;
    this.now = now;
  }

  async execute(
    owner: string,
    device: string,
    command: Command,
  ): Promise<Receipt> {
    if (!Object.hasOwn(schema, command.entityType))
      throw new Error("INVALID_ENTITY");
    const type = command.entityType;
    const spec: EntitySpec = schema[type];
    // Rules are typed per entity; the kernel only ever pairs a rule with data of its own type.
    const rule = this.rules[type] as EntityRule<EntityType> | undefined;
    let data =
      command.action === "put" ? normalize(spec, command.data ?? {}) : null;
    if (data) rule?.validate?.(data as never);
    const hash = createHash("sha256")
      .update(JSON.stringify(canonical(command)))
      .digest("hex");

    return this.store.transaction(owner, async (tx) => {
      const prior = await tx.receipt(device, command.operationId);
      if (prior) {
        // Same id + same payload replays the outcome; same id + other payload is a client bug.
        if (prior.hash !== hash) throw new Error("OPERATION_REUSED");
        const current = await tx.get(prior.entityType, prior.entityId);
        return prior.outcome === "accepted" && current
          ? { outcome: "accepted", entity: current, revision: prior.revision! }
          : { outcome: "conflict", current };
      }
      const current = (await tx.get(
        type,
        command.entityId,
      )) as AnyEntity | null;
      let result: Receipt;
      if ((current?.version ?? 0) !== command.baseVersion)
        result = { outcome: "conflict", current };
      else {
        if (!data) {
          if (!current) throw new Error("NOT_FOUND");
        } else {
          if (rule?.prepare)
            data = normalize(
              spec,
              rule.prepare({
                data: data as never,
                current: current as never,
                occurredAt: command.occurredAt,
              }) as Data,
            );
          const refs: Record<string, AnyEntity> = {};
          for (const [key, f] of Object.entries(spec.fields)) {
            if (f.kind !== "ref" || data[key] === undefined) continue;
            const target = await tx.get(
              f.target as EntityType,
              String(data[key]),
            );
            if (!target || target.deleted)
              throw new Error("MISSING_REFERENCE:" + key);
            refs[key] = target;
          }
          await rule?.check?.(
            {
              id: command.entityId,
              data: data as never,
              current: current as never,
              refs,
            },
            tx,
          );
        }
        const entity: AnyEntity = {
          id: command.entityId,
          type,
          version: command.baseVersion + 1,
          data: data ?? current!.data,
          deleted: command.action === "delete",
          updatedAt: this.now().toISOString(),
        };
        const revision = await tx.save(entity);
        result = { outcome: "accepted", entity, revision };
      }
      await tx.saveReceipt(device, command.operationId, {
        hash,
        outcome: result.outcome,
        entityType: type,
        entityId: command.entityId,
        revision: result.outcome === "accepted" ? result.revision : null,
      });
      return result;
    });
  }

  /** Entities changed after `cursor`, each at its latest confirmed state, in revision order. */
  async changes(owner: string, cursor = "0", limit = 200): Promise<Changes> {
    const size = Math.min(Math.max(limit, 1), 500);
    const rows = await this.store.changes(owner, cursor, size + 1);
    const changes = rows.slice(0, size);
    return {
      changes,
      nextCursor: changes.at(-1)?.revision ?? cursor,
      hasMore: rows.length > size,
    };
  }
}
