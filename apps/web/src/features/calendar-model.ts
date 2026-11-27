import { Lunar, LunarMonth } from "lunar-typescript";
import { solarOccurrence } from "../../../../modules/calendar/index.ts";
import type { AnyEntity as Entity } from "../data/entities.ts";
import { today, str, num } from "../ui/shared.tsx";
export function nextOccurrence(e: Entity, from = today()): string | null {
  try {
    const base = str(e, "date");
    const repeat = str(e, "repeat", "once");
    if (e.data.calendar === "lunar") {
      const initial = Lunar.fromYmd(
        num(e, "lunarYear"),
        num(e, "lunarMonth") * (e.data.leap ? -1 : 1),
        num(e, "lunarDay"),
      );
      if (repeat === "once") return initial.getSolar().toYmd();
      const unit =
        repeat === "weekly"
          ? "week"
          : repeat === "monthly"
            ? "month"
            : repeat === "yearly"
              ? "year"
              : str(e, "intervalUnit", "day");
      const interval = repeat === "custom" ? num(e, "interval", 1) : 1;
      if (unit === "day" || unit === "week") {
        const step = interval * (unit === "week" ? 7 : 1);
        const elapsed = Math.max(
          0,
          Math.ceil(
            (Date.parse(from) - Date.parse(initial.getSolar().toYmd())) /
              86400000,
          ),
        );
        return initial
          .next(Math.ceil(elapsed / step) * step)
          .getSolar()
          .toYmd();
      }
      const first = LunarMonth.fromYm(initial.getYear(), initial.getMonth());
      if (!first) return null;
      const fromYear = Number(from.slice(0, 4));
      const start = unit === "year" ? Math.max(0, Math.floor((fromYear - 1 - initial.getYear()) / interval)) : 0;
      let nextMonth: LunarMonth | null = first;
      for (let i = start; nextMonth && nextMonth.getYear() <= 2100; i++) {
        const year = initial.getYear() + i * interval;
        if (unit === "year" && year > 2100) break;
        const target = unit === "month" ? nextMonth : LunarMonth.fromYm(year, initial.getMonth());
        if (unit === "month") nextMonth = nextMonth.next(interval);
        if (!target) continue;
        const result = Lunar.fromYmd(
          target.getYear(),
          target.getMonth(),
          Math.min(initial.getDay(), target.getDayCount()),
        )
          .getSolar()
          .toYmd();
        if (result >= from) return result;
      }
      return null;
    }
    if (!base) return null;
    if (repeat === "once") return base;
    const unit =
      repeat === "weekly"
        ? "week"
        : repeat === "monthly"
          ? "month"
          : repeat === "yearly"
            ? "year"
            : str(e, "intervalUnit", "day");
    const interval = repeat === "custom" ? num(e, "interval", 1) : 1;
    return solarOccurrence(base, from, unit, interval);
  } catch {
    return null;
  }
}
