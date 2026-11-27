import type { Rules } from "../kernel/index.ts";

export const calendarRules = (validLunarDate: (year: number, month: number, day: number) => boolean): Rules => ({
  importantDay: {
    validate(data) {
      if (data.calendar === "solar" && !data.date)
        throw new Error("REQUIRED:date");
      if (
        data.calendar === "lunar" &&
        (data.lunarYear === undefined ||
          data.lunarMonth === undefined ||
          data.lunarDay === undefined ||
          !validLunarDate(data.lunarYear, data.leap ? -data.lunarMonth : data.lunarMonth, data.lunarDay))
      )
        throw new Error("INVALID_LUNAR_DATE");
      if (data.repeat === "custom" && data.interval === undefined)
        throw new Error("INVALID_INTERVAL");
    },
  },
});
