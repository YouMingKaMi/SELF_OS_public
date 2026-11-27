/** Ordered lanes at each tree node allow lookup by rank range and lane together. */
export function taskLanes(byRank: number[][], nodeSize: number) {
  const leafCount = 2 ** Math.ceil(Math.log2(Math.max(1, byRank.length)));
  const index: number[][] = new Array(leafCount * 2);
  for (let i = 0; i < leafCount; i++) {
    index[leafCount + i] = (byRank[i] ?? []).sort((a, b) => a - b);
  }
  for (let i = leafCount - 1; i > 0; i--) {
    const lower = index[i * 2];
    const upper = index[i * 2 + 1];
    const combined: number[] = [];
    let a = 0;
    let b = 0;
    while (a < lower.length && b < upper.length) {
      combined.push(lower[a] <= upper[b] ? lower[a++] : upper[b++]);
    }
    for (; a < lower.length; a++) combined.push(lower[a]);
    for (; b < upper.length; b++) combined.push(upper[b]);
    index[i] = combined;
  }
  return (fromRank: number, toRank: number, lane: number) => {
    let blocked = false;
    let outer = -Infinity;
    const inspect = (part: number) => {
      const starts = index[part];
      if (!starts.length) return;
      outer = Math.max(outer, starts[starts.length - 1] + nodeSize);
      if (blocked) return;
      const minimum = lane - nodeSize - 7;
      let low = 0;
      let high = starts.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (starts[middle] < minimum) low = middle + 1;
        else high = middle;
      }
      blocked = low < starts.length && starts[low] <= lane + 7;
    };
    for (let a = leafCount + fromRank + 1, b = leafCount + toRank; a < b; a >>= 1, b >>= 1) {
      if (a % 2) inspect(a++);
      if (b % 2) inspect(--b);
    }
    return blocked ? outer + 8 : lane;
  };
}
