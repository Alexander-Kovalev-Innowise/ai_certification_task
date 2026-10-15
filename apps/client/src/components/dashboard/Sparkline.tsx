import type { DashboardSeriesPoint } from '../../types/dashboard';

export interface SparklineProps {
  points: readonly DashboardSeriesPoint[];
  /** Accessible description, e.g. "New users per day, last 30 days". */
  label: string;
  className?: string;
}

const WIDTH = 100;
const HEIGHT = 28;
const PAD = 2;

// Tiny dependency-free SVG trend line. Stroke/fill follow `currentColor`, so
// the colour comes from a theme-token text class on the element.
export function Sparkline({ points, label, className = '' }: SparklineProps) {
  if (points.length < 2) {
    return null;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const step = (WIDTH - PAD * 2) / (points.length - 1);

  const coords = points.map((point, index) => {
    const x = PAD + index * step;
    // A flat series draws a centred line rather than dividing by zero.
    const y = range === 0 ? HEIGHT / 2 : HEIGHT - PAD - ((point.value - min) / range) * (HEIGHT - PAD * 2);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
  });

  const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const firstX = coords[0]?.[0] ?? PAD;
  const lastX = coords[coords.length - 1]?.[0] ?? WIDTH - PAD;
  const area = `${line} L${lastX} ${HEIGHT} L${firstX} ${HEIGHT} Z`;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={`h-8 w-full text-brand-primary ${className}`.trim()}
    >
      <path d={area} fill="currentColor" fillOpacity="0.15" stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
