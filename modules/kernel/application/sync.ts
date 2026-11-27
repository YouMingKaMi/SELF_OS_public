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
import { legacyPut } from "../../../packages/contracts/edit.ts";
import { normalize } from "../domain/normalize.ts";
import type { EntityRule, Rules, Store, Transaction } from "./ports.ts";
import { requireScope } from "./scope.ts";
import type { SyncScope } from "../../../packages/contracts/snapshot.ts";
import {
  maxBatchCommands, type BatchMember, type BatchReceipt, type CommandBatch,
} from "../../../packages/contracts/command-batch.ts";
import { recoveryKeys, type RecoveryMatch, type RecoveryRequest } from "../../../packages/contracts/recovery.ts";

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

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
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
    const { scope, ...payload } = command;
    const hash = digest(payload);
    return this.store.transaction(owner, async (tx) => {
      requireScope(await tx.state(), scope);
      if (!Object.hasOwn(schema, command.entityType)) throw new Error("INVALID_ENTITY");
      const prior = await tx.receipt(device, command.operationId);
      if (prior) {
        // Legacy single-command receipts can still carry the scope in their digest.
        if (prior.hash !== hash && (!scope || prior.hash !== digest(command)))
          throw new Error("OPERATION_REUSED");
        const current = await tx.get(prior.entityType, prior.entityId);
        return prior.outcome === "accepted" && current
          ? { outcome: "accepted", entity: current, revision: prior.revision! }
          : { outcome: "conflict", current };
      }
      const result = await this.write(tx, command);
      await tx.saveReceipt(device, command.operationId, {
        hash,
        outcome: result.outcome,
        entityType: command.entityType,
        entityId: command.entityId,
        revision: result.outcome === "accepted" ? result.revision : null,
      });
      return result;
    });
  }

  /** Execute ordered writes under the owner lock, with one operation ID for the whole intent. */
  async executeBatch(owner: string, device: string, batch: CommandBatch): Promise<BatchReceipt> {
    const { commands, operationId, scope } = batch;
    if (commands.length < 2 || commands.length > maxBatchCommands ||
        new Set(commands.map((command) => command.entityId.toLowerCase())).size !== commands.length)
      throw new Error("INVALID_BATCH");
    const hash = digest({ batch: { operationId, commands } });
    return this.store.transaction(owner, async (tx) => {
      requireScope(await tx.state(), scope);
      const prior = await tx.receipt(device, operationId);
      const effects: Extract<Receipt, { outcome: "accepted" }>[] = [];
      if (prior) {
        if (prior.hash !== hash) throw new Error("OPERATION_REUSED");
        if (prior.outcome === "conflict") return {
          outcome: "conflict",
          entityId: prior.entityId,
          current: await tx.get(prior.entityType, prior.entityId),
        };
        if (prior.revision === null) throw new Error("Invalid stored batch receipt");
        // Each member advances the counter once and the enclosing lock makes the run contiguous.
        let revision = BigInt(prior.revision) - BigInt(commands.length - 1);
        for (const command of commands) {
          const entity = await tx.get(command.entityType, command.entityId);
          if (!entity) throw new Error("Missing entity for stored batch receipt");
          effects.push({ outcome: "accepted", entity, revision: String(revision++) });
        }
        return { outcome: "accepted", effects };
      }

      // Check every version before writing so a conflict can commit only the receipt.
      for (const command of commands) {
        if (!Object.hasOwn(schema, command.entityType)) throw new Error("INVALID_ENTITY");
        const current = await tx.get(command.entityType, command.entityId);
        if ((current?.version ?? 0) === command.baseVersion) continue;
        await tx.saveReceipt(device, operationId, {
          hash, outcome: "conflict", entityType: command.entityType,
          entityId: command.entityId, revision: null,
        });
        return { outcome: "conflict", entityId: command.entityId, current };
      }

      for (const command of commands) {
        const result = await this.write(tx, command);
        if (result.outcome !== "accepted") throw new Error("Batch version changed within its transaction");
        effects.push(result);
      }
      const last = effects[effects.length - 1];
      await tx.saveReceipt(device, operationId, {
        hash, outcome: "accepted", entityType: last.entity.type,
        entityId: last.entity.id, revision: last.revision,
      });
      return { outcome: "accepted", effects };
    });
  }

  private async write(tx: Transaction, command: BatchMember): Promise<Receipt> {
    if (!Object.hasOwn(schema, command.entityType)) throw new Error("INVALID_ENTITY");
    const type = command.entityType;
    const spec: EntitySpec = schema[type];
    // Rules are typed per entity; the kernel only pairs a rule with its own entity type.
    const rule = this.rules[type] as EntityRule<EntityType> | undefined;
    const current: AnyEntity | null = await tx.get(type, command.entityId);
    if ((current?.version ?? 0) !== command.baseVersion) return { outcome: "conflict", current };
    let data = null;
    if (command.action === "delete") {
      if (!current) throw new Error("NOT_FOUND");
      if (!current.deleted) await rule?.checkDelete?.(current as never, tx);
    } else {
      const input = command.data ?? {};
      if (command.action === "patch" && (!current || current.deleted))
        throw new Error("NOT_FOUND");
      // Keep nulls until normalize so it can reject unknown fields, including a clear.
      data = normalize(spec, command.action === "patch"
        ? { ...current!.data, ...input }
        : legacyPut(type, current?.data, input));
      rule?.validate?.(data as never);
      if (rule?.prepare)
        data = normalize(
          spec,
          rule.prepare({
            data: data as never,
            current: current as never,
            occurredAt: command.occurredAt,
          }) as Data,
        );
      if (rule?.resolve)
        data = normalize(
          spec,
          await rule.resolve({ data: data as never, current: current as never }, tx) as Data,
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
    return { outcome: "accepted", entity, revision };
  }

  /** Entities changed after `cursor`, each at its latest confirmed state, in revision order. */
  async changes(owner: string, cursor = "0", limit = 200, scope?: SyncScope): Promise<Changes> {
    const size = Math.min(Math.max(limit, 1), 500);
    const rows = await this.store.changes(owner, cursor, size + 1, scope);
    const changes = rows.slice(0, size);
    return {
      changes,
      nextCursor: changes.at(-1)?.revision ?? cursor,
      hasMore: rows.length > size,
    };
  }

  state(owner: string) {
    return this.store.transaction(owner, (tx) => tx.state());
  }

  /** Look up durable receipts and exact single-record matches without replaying an old write. */
  reconcile(owner: string, device: string, request: RecoveryRequest) {
    return this.store.transaction(owner, async (tx) => {
      const current = await tx.state();
      requireScope(current, request.scope);
      const watermark = BigInt(request.watermark);
      if (watermark > BigInt(current.watermark)) throw new Error("CURSOR_AHEAD");
      const matches: RecoveryMatch[] = [];
      for (const probe of request.probes) {
        const prior = await tx.receipt(device, probe.operationId);
        if (prior) {
          let samePayload = false;
          if (probe.command?.operationId === probe.operationId && !probe.batch) {
            const { scope, ...payload } = probe.command;
            samePayload = prior.hash === digest(payload) ||
              (!!scope && prior.hash === digest(probe.command));
          } else if (probe.batch?.operationId === probe.operationId && !probe.command) {
            const { operationId, commands } = probe.batch;
            samePayload = prior.hash === digest({ batch: { operationId, commands } });
          }
          if (prior.outcome === "accepted" && prior.revision !== null &&
              samePayload && BigInt(prior.revision) <= watermark &&
              prior.entityId === probe.entityId && prior.entityType === probe.entityType)
            matches.push({ operationId: probe.operationId, kind: "receipt", entityId: prior.entityId });
          continue;
        }
        const type = probe.entityType as keyof typeof recoveryKeys;
        if (!probe.creation || watermark !== BigInt(current.watermark) ||
            !Object.hasOwn(recoveryKeys, type)) continue;
        let data: ReturnType<typeof normalize>;
        try { data = normalize(schema[type], probe.creation); }
        catch { continue; }
        const keys = recoveryKeys[type];
        if (keys.some((key) => data[key] === undefined)) continue;
        const filter = { eq: Object.fromEntries(keys.map((key) => [key, data[key]])) };
        if (await tx.count(type, filter) !== 1) continue;
        const entity = type === "budget"
          ? await tx.latest(type, filter, "month")
          : await tx.latest(type, filter, "day");
        if (entity && digest(entity.data) === digest(data)) {
          matches.push({ operationId: probe.operationId, kind: "businessKey",
            entityId: entity.id, version: entity.version });
        }
      }
      return { matches };
    });
  }

  snapshot(owner: string, scope: SyncScope) {
    return this.store.snapshot(owner, scope);
  }

  snapshotPage(owner: string, id: string, after = "0", limit = 200) {
    return this.store.snapshotPage(owner, id, after, Math.min(Math.max(limit, 1), 500));
  }
}
