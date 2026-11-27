import type { Rules } from "../kernel/index.ts";

export const rules: Rules = {
  metric: {
    validate(data) {
      if (
        data.minimum !== undefined &&
        data.maximum !== undefined &&
        data.minimum > data.maximum
      )
        throw new Error("INVALID_METRIC_RANGE");
    },
    async check({ id, data, current }, reader) {
      const scaleChanged = current && (["unit", "minimum", "maximum"] as const)
        .some((key) => data[key] !== current.data[key]);
      if (scaleChanged && await reader.count("metricLog", { eq: { metricId: id } })) {
        throw new Error("METRIC_SCALE_HAS_HISTORY");
      }
    },
  },
  metricLog: {
    /** A reading must sit on the scale its metric defines. */
    async check({ data, current, refs }, reader) {
      const metric = refs.metricId.data;
      if (data.value === undefined && !data.note?.trim()) throw new Error("EMPTY_METRIC_LOG");
      if (
        data.value !== undefined &&
        (data.value < Number(metric.minimum ?? -Infinity) ||
          data.value > Number(metric.maximum ?? Infinity))
      )
        throw new Error("INVALID_METRIC_VALUE");
      const sameDay = current && !current.deleted && current.data.metricId === data.metricId && current.data.day === data.day;
      const count = await reader.count("metricLog", { eq: { metricId: data.metricId, day: data.day } });
      if (count > (sameDay ? 1 : 0)) throw new Error("DUPLICATE_METRIC_DAY");
    },
  },
};
