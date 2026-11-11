import { randomUUID } from "node:crypto";
import type { SyncService } from "../modules/kernel/server.ts";
import type {
  AnyEntity,
  Command,
  Data,
  Entity,
  EntityData,
  EntityType,
} from "../packages/contracts/entities.ts";

/** A tiny client for tests: remembers versions so each call reads like a user action. */
export function client(sync: SyncService, owner: string, device = "device") {
  const send = (command: Command) => sync.execute(owner, device, command);
  const command = (
    type: EntityType,
    id: string,
    baseVersion: number,
    data?: Data,
  ): Command => ({
    operationId: randomUUID(),
    entityId: id,
    entityType: type,
    baseVersion,
    action: data ? "put" : "delete",
    data,
    occurredAt: new Date().toISOString(),
  });
  async function accepted(c: Command) {
    const receipt = await send(c);
    if (receipt.outcome !== "accepted")
      throw new Error("Expected accepted, got conflict");
    return receipt.entity;
  }
  return {
    owner,
    send,
    command,
    create: <T extends EntityType>(type: T, data: EntityData<T>) =>
      accepted(command(type, randomUUID(), 0, data as Data)) as Promise<
        Entity<T>
      >,
    update: <T extends EntityType>(entity: Entity<T> | AnyEntity, data: Data) =>
      accepted(
        command(entity.type, entity.id, entity.version, {
          ...entity.data,
          ...data,
        }),
      ) as Promise<Entity<T>>,
    remove: (entity: AnyEntity) =>
      accepted(command(entity.type, entity.id, entity.version)),
  };
}
