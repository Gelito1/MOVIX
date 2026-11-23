import { useState } from 'react';

export interface ChartPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

interface AreaChartProps {
  title: string;
  subtitle?: string;
  data: ChartPoint[];
  color?: string;
  secondaryColor?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  emptyText?: string;
}

export function AdmAreaChart({
  title,
  subtitle,
  data,
  color = '#E5B85A',
  secondaryColor = '#38BDF8',
  primaryLabel = 'Total',
  secondaryLabel,
  emptyText = 'Sem dados registados neste período.',
}: AreaChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 640;
  const h = 210;
  const padX = 28;
  const padY = 20;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(d.value, d.secondaryValue || 0))
  );

  const getCoords = (val: number, idx: number) => {
    const x = data.length <= 1 ? padX + plotW / 2 : padX + (idx / (data.length - 1)) * plotW;
    const y = padY + plotH - (val / maxVal) * plotH;
    return { x, y };
  };

  const primaryPoints = data.map((d, i) => getCoords(d.value, i));
  const secondaryPoints = secondaryLabel
    ? data.map((d, i) => getCoords(d.secondaryValue || 0, i))
    : [];

  const linePath = primaryPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    primaryPoints.length > 0
      ? `${linePath} L ${primaryPoints[primaryPoints.length - 1].x.toFixed(1)} ${(padY + plotH).toFixed(1)} L ${primaryPoints[0].x.toFixed(1)} ${(padY + plotH).toFixed(1)} Z`
      : '';

  const secondaryPath = secondaryPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const gradId = `grad-${title.replace(/[^a-z0-9]/gi, '').slice(0, 14)}`;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-[#8D97AF] mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#A0A6B8]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            {primaryLabel}
          </span>
          {secondaryLabel && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: secondaryColor }} />
              {secondaryLabel}
            </span>
          )}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-[190px] flex items-center justify-center text-xs text-[#6E778E] border border-dashed border-white/[0.06] rounded-lg">
          {emptyText}
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[195px] overflow-visible">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.34" />
                <stop offset="100%" stopColor={color} stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {[0, 0.25, 0.5, 0.75, 1].map((step) => {
              const y = padY + plotH * (1 - step);
              return (
                <g key={step}>
                  <line x1={padX} y1={y} x2={w - padX} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <text x={padX - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#6E778E">
                    {Math.round(maxVal * step)}
                  </text>
                </g>
              );
            })}

            {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
            {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
            {secondaryPath && (
              <path d={secondaryPath} fill="none" stroke={secondaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}

            {primaryPoints.map((pt, i) => (
              <g key={data[i].label}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={hoverIdx === i ? 5 : 3}
                  fill={color}
                  stroke="#0B0E17"
                  strokeWidth="1.5"
                />
                {secondaryPoints[i] && (
                  <circle
                    cx={secondaryPoints[i].x}
                    cy={secondaryPoints[i].y}
                    r={hoverIdx === i ? 4.5 : 2.5}
                    fill={secondaryColor}
                    stroke="#0B0E17"
                    strokeWidth="1.5"
                  />
                )}
                <rect
                  x={pt.x - Math.max(10, plotW / Math.max(1, data.length) / 2)}
                  y={padY}
                  width={Math.max(20, plotW / Math.max(1, data.length))}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              </g>
            ))}
          </svg>

          <div className="flex items-center justify-between text-[10px] text-[#6E778E] px-4 -mt-1">
            <span>{data[0]?.label}</span>
            {data.length > 2 && <span>{data[Math.floor(data.length / 2)]?.label}</span>}
            <span>{data[data.length - 1]?.label}</span>
          </div>

          {hovered && (
            <div className="mt-2 px-3 py-1.5 rounded-lg bg-[#131826] border border-white/10 text-xs flex flex-wrap items-center justify-between gap-2">
              <span className="text-[#A0A6B8] font-medium">{hovered.label}</span>
              <div className="flex items-center gap-3">
                <span className="font-semibold" style={{ color }}>
                  {primaryLabel}: {hovered.value.toLocaleString('pt-PT')}
                </span>
                {secondaryLabel && (
                  <span className="font-semibold" style={{ color: secondaryColor }}>
                    {secondaryLabel}: {(hovered.secondaryValue || 0).toLocaleString('pt-PT')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface BarChartProps {
  title: string;
  subtitle?: string;
  items: Array<{ label: string; value: number; hint?: string }>;
  color?: string;
  emptyText?: string;
}

export function AdmBarListChart({
  title,
  subtitle,
  items,
  color = '#E5B85A',
  emptyText = 'Sem registos para exibir.',
}: BarChartProps) {
  const maxVal = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-[#8D97AF] mt-0.5">{subtitle}</p>}
      </div>

      {items.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#6E778E] border border-dashed border-white/[0.06] rounded-lg">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const pct = Math.max(3, Math.round((item.value / maxVal) * 100));
            return (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#E5E8F0] truncate font-medium">{item.label}</span>
                  <span className="text-[#A0A6B8] shrink-0">
                    <strong className="text-white">{item.value.toLocaleString('pt-PT')}</strong>
                    {item.hint ? ` · ${item.hint}` : ''}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function AdmDonutChart({
  title,
  subtitle,
  segments,
}: {
  title: string;
  subtitle?: string;
  segments: DonutSegment[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = 46;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-[#8D97AF] mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="relative w-32 h-32 shrink-0">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="14" />
            {total > 0 &&
              segments.map((seg) => {
                const len = (seg.value / total) * circ;
                const el = (
                  <circle
                    key={seg.label}
                    cx="60"
                    cy="60"
                    r={r}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="14"
                    strokeDasharray={`${len} ${circ - len}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += len;
                return el;
              })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-base font-bold text-white">{total.toLocaleString('pt-PT')}</span>
            <span className="text-[10px] text-[#8D97AF]">Total</span>
          </div>
        </div>

        <div className="flex-1 w-full space-y-2">
          {segments.map((seg) => {
            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
            return (
              <div key={seg.label} className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-2 text-[#D4D9E6]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                  {seg.label}
                </span>
                <span className="text-[#8D97AF]">
                  <strong className="text-white">{seg.value.toLocaleString('pt-PT')}</strong> ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
