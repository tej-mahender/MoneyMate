/**
 * The app's one shared "progress against a cap" motif — a gradient-stroked
 * ring, used wherever a spent-vs-target percentage needs a strong visual
 * answer (Dashboard's "Budget health" card, BracketDetail's hero). Kept as
 * a single component rather than letting each screen grow its own version,
 * so the ring always means the same thing wherever it appears.
 */
export default function Ring({
  pct,
  color,
  size = 80,
}: {
  pct: number;
  color: "good" | "warn" | "over";
  size?: number;
}) {
  const r = (size / 80) * 32;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  const gradId = "ring-grad-" + color + "-" + size;
  const strokeWidth = (size / 80) * 8;
  const center = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop
            offset="0%"
            stopColor={
              color === "over"
                ? "var(--rose)"
                : color === "warn"
                  ? "var(--warn)"
                  : "var(--good)"
            }
          />
          <stop
            offset="100%"
            stopColor={
              color === "over"
                ? "var(--over)"
                : color === "warn"
                  ? "var(--gold)"
                  : "var(--good)"
            }
          />
        </linearGradient>
      </defs>
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="var(--surface-border-strong)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: "stroke-dashoffset .6s cubic-bezier(.16,1,.3,1)" }}
      />
    </svg>
  );
}
