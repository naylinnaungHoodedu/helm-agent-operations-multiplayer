import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { WorldSnapshot } from "@helm/sim-core";

interface TrendsPanelProps {
  world: WorldSnapshot;
}

// Normalise ARR to $K so the right-axis scale is comparable to Trust (0–100)
const normaliseData = (world: WorldSnapshot) => {
  const raw =
    world.trends.length > 0
      ? world.trends
      : [{ totalHours: world.clock.totalHours, trust: world.trust, cash: world.cash, arr: world.arr, queueDepth: world.queue.length }];

  return raw.map((point) => ({
    ...point,
    arrK: Math.round(point.arr / 1000),
    cashK: Math.round(point.cash / 1000),
  }));
};

export const TrendsPanel = ({ world }: TrendsPanelProps) => {
  const data = normaliseData(world);

  return (
    <div className="chart-shell" aria-label="Live operational trends chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 18, right: 24, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(139, 152, 165, 0.1)" vertical={false} />

          <XAxis
            dataKey="totalHours"
            stroke="#8b98a5"
            tickLine={false}
            tick={{ fontSize: 11 }}
            label={{ value: "Hours", position: "insideBottomRight", offset: -8, fill: "#8b98a5", fontSize: 11 }}
          />

          {/* Left axis — Trust (0–100) */}
          <YAxis
            yAxisId="trust"
            stroke="#8b98a5"
            tickLine={false}
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            label={{ value: "Trust", angle: -90, position: "insideLeft", fill: "#00d9ff", fontSize: 11 }}
          />

          {/* Right axis — Volume ($K / queue depth) */}
          <YAxis
            yAxisId="volume"
            orientation="right"
            stroke="#8b98a5"
            tickLine={false}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v}`}
            label={{ value: "$K / Cards", angle: 90, position: "insideRight", fill: "#8b98a5", fontSize: 11 }}
          />

          <Tooltip
            contentStyle={{
              background: "rgba(8, 12, 18, 0.95)",
              border: "1px solid rgba(31, 41, 55, 1)",
              borderRadius: "14px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.82rem",
            }}
            formatter={(value: any, name: any) => {
              const numVal = Number(value);
              if (name === "trust") return [`${numVal.toFixed(1)}`, "Trust"];
              if (name === "arrK") return [`$${numVal}K`, "ARR"];
              if (name === "cashK") return [`$${numVal}K`, "Cash"];
              if (name === "queueDepth") return [numVal, "Queue depth"];
              return [value, name];
            }}
            labelFormatter={(label) => `Hour ${label}`}
          />

          <Legend
            wrapperStyle={{ fontSize: "0.82rem", paddingTop: "0.5rem" }}
            formatter={(value) => {
              if (value === "trust") return "Trust";
              if (value === "arrK") return "ARR ($K)";
              if (value === "queueDepth") return "Queue depth";
              return value;
            }}
          />

          <Line yAxisId="trust" type="monotone" dataKey="trust" stroke="#00d9ff" strokeWidth={2.6} dot={false} name="trust" />
          <Line yAxisId="volume" type="monotone" dataKey="queueDepth" stroke="#ff8a4c" strokeWidth={2.2} dot={false} name="queueDepth" />
          <Line yAxisId="volume" type="monotone" dataKey="arrK" stroke="#10f2a0" strokeWidth={2.2} dot={false} name="arrK" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
