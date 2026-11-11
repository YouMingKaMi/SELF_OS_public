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
  },
  metricLog: {
    /** A reading must sit on the scale its metric defines. */
    async check({ data, refs }) {
      const metric = refs.metricId.data;
      if (
        data.value !== undefined &&
        (data.value < Number(metric.minimum ?? -Infinity) ||
          data.value > Number(metric.maximum ?? Infinity))
      )
        throw new Error("INVALID_METRIC_VALUE");
    },
  },
};
