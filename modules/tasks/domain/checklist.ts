export type ChecklistItem = { id: string; label: string };
type Template = { items?: string[]; itemIds?: string[] };
type Run = {
  itemIds?: string[];
  itemLabels?: string[];
  checked?: string[];
  checkedItemIds?: string[];
  ambiguousChecked?: string[];
};

export function checklistItems(template: Template): ChecklistItem[] {
  return (template.items ?? []).map((label, index) => ({
    id: template.itemIds?.[index] ?? `legacy:${index}`,
    label,
  }));
}

/** Match unchanged labels for clients without IDs. New labels receive fresh IDs. */
export function reconcileChecklistItems(
  items: string[],
  previous: ChecklistItem[],
  revision: number,
): string[] {
  const remaining = new Map<string, string[]>();
  for (const { label, id } of previous) {
    const queue = remaining.get(label) ?? [];
    queue.push(id);
    remaining.set(label, queue);
  }
  return items.map(
    (label, index) =>
      remaining.get(label)?.shift() ?? `legacy-r${revision}:${index}`,
  );
}

export function runState(template: Template, run?: Run) {
  const items =
    run?.itemIds && run.itemLabels
      ? checklistItems({ itemIds: run.itemIds, items: run.itemLabels })
      : checklistItems(template);
  const checked = new Set(run?.checkedItemIds);
  const ambiguous = new Set(run?.ambiguousChecked);
  if (run?.checkedItemIds === undefined) {
    const byLabel = new Map<string, string[]>();
    for (const { label, id } of items) {
      const ids = byLabel.get(label) ?? [];
      ids.push(id);
      byLabel.set(label, ids);
    }
    for (const label of run?.checked ?? []) {
      const ids = byLabel.get(label);
      if (ids?.length === 1) checked.add(ids[0]);
      else ambiguous.add(label);
    }
  }
  return { items, checked, ambiguous };
}

export function runFields(
  items: ChecklistItem[],
  checked: ReadonlySet<string>,
  ambiguous: ReadonlySet<string>,
) {
  return {
    itemIds: items.map((item) => item.id),
    itemLabels: items.map((item) => item.label),
    checkedItemIds: items
      .filter((item) => checked.has(item.id))
      .map((item) => item.id),
    checked: [
      ...new Set(
        items.filter((item) => checked.has(item.id)).map((item) => item.label),
      ),
    ],
    ambiguousChecked: [...ambiguous],
  };
}
