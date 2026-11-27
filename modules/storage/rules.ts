import type { Rules } from "../kernel/index.ts";

export const rules: Rules = {
  storageBox: {
    prepare({ data, current }) {
      // A tombstone is rejected by the generic live-reference check before check runs.
      if (current?.deleted && data.parentId === current.id) throw new Error("STORAGE_BOX_CYCLE");
      return { ...data, zone: data.zone.trim(), name: data.name.trim() };
    },
    async check({ id, data, current }, reader) {
      if (!data.parentId || (data.parentId === current?.data.parentId && !current.deleted)) return;

      const seen = new Set([id.toLowerCase()]);
      let parentId: string | undefined = data.parentId;
      while (parentId) {
        if (seen.has(parentId)) throw new Error("STORAGE_BOX_CYCLE");
        seen.add(parentId);
        const nextId: string = parentId;
        const parent = await reader.get("storageBox", nextId);
        if (!parent || parent.deleted) throw new Error("MISSING_REFERENCE:parentId");
        parentId = parent.data.parentId;
      }
    },
    async checkDelete(box, reader) {
      if (
        await reader.count("storageBox", { eq: { parentId: box.id } }) ||
        await reader.count("storageItem", { eq: { boxId: box.id } }) ||
        await reader.count("storageItem", { eq: { homeBoxId: box.id } })
      ) {
        throw new Error("STORAGE_BOX_NOT_EMPTY");
      }
    },
  },
  storageItem: {
    validate(data) {
      if (data.status === "in_box" && !data.boxId)
        throw new Error("STORAGE_BOX_REQUIRED");
    },
    prepare({ data }) {
      return { ...data, name: data.name.trim(), icon: data.icon?.trim() || undefined };
    },
  },
};
