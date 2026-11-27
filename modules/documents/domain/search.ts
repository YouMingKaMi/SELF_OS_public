const bucketCount = 1 << 15;
const rowsPerBlock = 32;

export type SearchDocument = { id: string; title: string; body: string };
type Block = { buckets: Uint32Array; texts: string[]; ids: string[] };

function documentText({ title, body }: SearchDocument) {
  // Keep the substring semantics of the existing document list.
  return (title + " " + body).toLowerCase();
}

function bucket(first: number, second = 0, third = 0) {
  const hash =
    Math.imul(first, 31) + Math.imul(second, 993) + Math.imul(third, 30727);
  return (hash ^ (hash >>> 16)) & (bucketCount - 1);
}

/** One bitmap per hash bucket, split into 32-document blocks. Verify candidates
 * against the exact text so hash collisions and out-of-order grams are harmless. */
export class DocumentSearchIndex {
  private readonly blocks: Block[] = [];
  private readonly slots = new Map<string, number>();
  private readonly freeSlots: number[] = [];
  private nextSlot = 0;

  private writeBuckets(
    buckets: Uint32Array,
    text: string,
    bit: number,
    add: boolean,
  ) {
    const change = add
      ? (index: number) => {
          buckets[index] |= bit;
        }
      : (index: number) => {
          buckets[index] &= ~bit;
        };
    for (let i = 0; i < text.length; i++) {
      const first = text.charCodeAt(i) + 1;
      change(bucket(first));
      if (i + 1 >= text.length) continue;
      const second = text.charCodeAt(i + 1) + 1;
      change(bucket(first, second));
      if (i + 2 < text.length)
        change(bucket(first, second, text.charCodeAt(i + 2) + 1));
    }
  }

  upsert(document: SearchDocument) {
    const text = documentText(document);
    const existing = this.slots.get(document.id);
    const slot = existing ?? this.freeSlots.pop() ?? this.nextSlot++;
    const blockIndex = Math.floor(slot / rowsPerBlock);
    const row = slot % rowsPerBlock;
    const block = (this.blocks[blockIndex] ??= {
      buckets: new Uint32Array(bucketCount),
      texts: [],
      ids: [],
    });
    if (existing !== undefined) {
      if (block.texts[row] === text) return;
      this.writeBuckets(block.buckets, block.texts[row], 1 << row, false);
    }
    this.slots.set(document.id, slot);
    block.texts[row] = text;
    block.ids[row] = document.id;
    this.writeBuckets(block.buckets, text, 1 << row, true);
  }

  remove(id: string) {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    const block = this.blocks[Math.floor(slot / rowsPerBlock)];
    const row = slot % rowsPerBlock;
    this.writeBuckets(block.buckets, block.texts[row], 1 << row, false);
    block.texts[row] = "";
    block.ids[row] = "";
    this.slots.delete(id);
    this.freeSlots.push(slot);
  }

  find(query: string) {
    const text = query.toLowerCase();
    if (!text) return [...this.slots.keys()];
    const width = Math.min(3, text.length);
    const keys = new Set<number>();
    for (let i = 0; i + width <= text.length; i++) {
      keys.add(
        bucket(
          text.charCodeAt(i) + 1,
          width > 1 ? text.charCodeAt(i + 1) + 1 : 0,
          width > 2 ? text.charCodeAt(i + 2) + 1 : 0,
        ),
      );
    }
    const matches: string[] = [];
    for (const { buckets, texts, ids } of this.blocks) {
      let candidates = -1;
      for (const key of keys) {
        candidates &= buckets[key];
        if (!candidates) break;
      }
      while (candidates) {
        const row = 31 - Math.clz32(candidates & -candidates);
        if (texts[row].includes(text)) matches.push(ids[row]);
        candidates &= candidates - 1;
      }
    }
    return matches;
  }
}
