"use client";

import { useMemo, useState } from "react";
import {
  alonsoFloorplan,
  circuitColor,
  defaultLayerVisibility,
  doorGapOnWall,
  type Door,
  type Floorplan,
  type FloorplanLayer,
  type FloorplanLayerId,
  type LayerSymbol,
  type WindowOpening,
} from "@/lib/floorplan";

const PAD = 0.55;

/** Sweep SVG (1 = CW con y↓) del cuarto de círculo convexo del abanico de la puerta. */
function doorArcSweep(
  hx: number,
  hy: number,
  cx: number,
  cy: number,
  ox: number,
  oy: number,
): 0 | 1 {
  const vsx = cx - hx;
  const vsy = cy - hy;
  const vex = ox - hx;
  const vey = oy - hy;
  // Punto a 45° del abanico (mitad del swing)
  let mx = vsx + vex;
  let my = vsy + vey;
  const len = Math.hypot(mx, my) || 1;
  const r = Math.hypot(vsx, vsy) || 1;
  mx = hx + (mx / len) * r;
  my = hy + (my / len) * r;
  // En coords SVG (y↓), cross > 0 ⇒ sentido horario ⇒ sweep 1
  const cross = vsx * (my - hy) - vsy * (mx - hx);
  return cross > 0 ? 1 : 0;
}

/** Símbolo de puerta: hoja abierta + arco convexo de 90°. Abre hacia adentro respecto del muro. */
function doorPath(door: Door): string {
  const r = door.width;
  const half = r / 2;
  const inward = door.inward !== false;
  const { x, y, wall, hinge } = door;

  let hx: number;
  let hy: number;
  let cx: number;
  let cy: number;
  let ox: number;
  let oy: number;

  if (wall === "s") {
    hx = hinge === "left" ? x - half : x + half;
    hy = y;
    cx = hinge === "left" ? x + half : x - half;
    cy = y;
    ox = hx;
    oy = inward ? y - r : y + r;
  } else if (wall === "n") {
    hx = hinge === "left" ? x - half : x + half;
    hy = y;
    cx = hinge === "left" ? x + half : x - half;
    cy = y;
    ox = hx;
    oy = inward ? y + r : y - r;
  } else if (wall === "e") {
    hx = x;
    hy = hinge === "left" ? y - half : y + half;
    cx = x;
    cy = hinge === "left" ? y + half : y - half;
    ox = inward ? x - r : x + r;
    oy = hy;
  } else {
    hx = x;
    hy = hinge === "left" ? y - half : y + half;
    cx = x;
    cy = hinge === "left" ? y + half : y - half;
    ox = inward ? x + r : x - r;
    oy = hy;
  }

  const sweep = doorArcSweep(hx, hy, cx, cy, ox, oy);
  return `M ${hx} ${hy} L ${ox} ${oy} M ${cx} ${cy} A ${r} ${r} 0 0 ${sweep} ${ox} ${oy}`;
}

function wallPieces(
  plan: Floorplan,
  seg: Floorplan["walls"][number],
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const horizontal = seg.y1 === seg.y2;
  const doors = (seg.doorIds ?? [])
    .map((id) => plan.doors.find((d) => d.id === id))
    .filter((d): d is Door => Boolean(d))
    .map(doorGapOnWall)
    .sort((a, b) => a.a - b.a);

  if (doors.length === 0) {
    return [{ x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 }];
  }

  const pieces: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  if (horizontal) {
    const y = seg.y1;
    let cursor = Math.min(seg.x1, seg.x2);
    const end = Math.max(seg.x1, seg.x2);
    for (const gap of doors) {
      if (gap.a > cursor) pieces.push({ x1: cursor, y1: y, x2: gap.a, y2: y });
      cursor = Math.max(cursor, gap.b);
    }
    if (cursor < end) pieces.push({ x1: cursor, y1: y, x2: end, y2: y });
  } else {
    const x = seg.x1;
    let cursor = Math.min(seg.y1, seg.y2);
    const end = Math.max(seg.y1, seg.y2);
    for (const gap of doors) {
      if (gap.a > cursor) pieces.push({ x1: x, y1: cursor, x2: x, y2: gap.a });
      cursor = Math.max(cursor, gap.b);
    }
    if (cursor < end) pieces.push({ x1: x, y1: cursor, x2: x, y2: end });
  }
  return pieces;
}

function windowSegment(win: WindowOpening): { x1: number; y1: number; x2: number; y2: number } {
  if (win.wall === "n" || win.wall === "s") {
    return { x1: win.x - win.width / 2, y1: win.y, x2: win.x + win.width / 2, y2: win.y };
  }
  return { x1: win.x, y1: win.y - win.width / 2, x2: win.x, y2: win.y + win.width / 2 };
}

function SymbolMark({ symbol, color }: { symbol: LayerSymbol; color: string }) {
  const r = symbol.rotate ?? 0;
  // Octágono como en el croquis
  const oct = "0.12,0 0.085,-0.085 0,-0.12 -0.085,-0.085 -0.12,0 -0.085,0.085 0,0.12 0.085,0.085";
  return (
    <g transform={`translate(${symbol.x} ${symbol.y}) rotate(${r})`}>
      {symbol.kind === "light" && (
        <>
          <polygon points={oct} fill="none" stroke={color} strokeWidth={0.035} />
          <circle r={0.035} fill={color} />
        </>
      )}
      {symbol.kind === "light-out" && (
        <>
          <circle r={0.1} fill="none" stroke={color} strokeWidth={0.035} />
          <line x1={0} y1={-0.16} x2={0} y2={-0.1} stroke={color} strokeWidth={0.03} />
          <line x1={-0.1} y1={-0.12} x2={-0.06} y2={-0.08} stroke={color} strokeWidth={0.025} />
          <line x1={0.1} y1={-0.12} x2={0.06} y2={-0.08} stroke={color} strokeWidth={0.025} />
        </>
      )}
      {symbol.kind === "outlet" && (
        <rect x={-0.1} y={-0.08} width={0.2} height={0.16} rx={0.02} fill="none" stroke={color} strokeWidth={0.035} />
      )}
      {symbol.kind === "switch" && (
        <rect x={-0.07} y={-0.1} width={0.14} height={0.2} rx={0.02} fill={`${color}22`} stroke={color} strokeWidth={0.035} />
      )}
      {symbol.kind === "panel" && (
        <rect x={-0.2} y={-0.16} width={0.4} height={0.32} rx={0.02} fill={`${color}33`} stroke={color} strokeWidth={0.04} />
      )}
      {symbol.kind === "device" && (
        <rect x={-0.16} y={-0.1} width={0.32} height={0.2} rx={0.03} fill={`${color}44`} stroke={color} strokeWidth={0.035} />
      )}
      {symbol.kind === "camera" && (
        <>
          <circle r={0.1} fill={`${color}55`} stroke={color} strokeWidth={0.035} />
          <path d="M 0 0.1 L -0.12 0.28 L 0.12 0.28 Z" fill={color} opacity={0.85} />
        </>
      )}
      {symbol.kind === "water" && <circle r={0.1} fill="none" stroke={color} strokeWidth={0.04} />}
      {symbol.kind === "drain" && (
        <>
          <circle r={0.08} fill="none" stroke={color} strokeWidth={0.03} />
          <line x1={-0.06} y1={-0.06} x2={0.06} y2={0.06} stroke={color} strokeWidth={0.03} />
          <line x1={0.06} y1={-0.06} x2={-0.06} y2={0.06} stroke={color} strokeWidth={0.03} />
        </>
      )}
      {symbol.kind === "gas" && (
        <polygon points="0,-0.12 0.12,0.1 -0.12,0.1" fill="none" stroke={color} strokeWidth={0.04} />
      )}
      {symbol.kind === "note" && <circle r={0.08} fill={color} />}
      {symbol.label ? (
        <text
          x={0.22}
          y={0.05}
          fill={color}
          fontSize={0.2}
          style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          {symbol.label}
        </text>
      ) : null}
    </g>
  );
}

function LayerDrawing({ layer }: { layer: FloorplanLayer }) {
  const circuitMap = Object.fromEntries((layer.circuits ?? []).map((c) => [c.id, c.color]));
  return (
    <g>
      {(layer.wires ?? []).map((wire) => {
        const color = circuitMap[wire.circuit] ?? layer.color;
        const d = wire.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
        return (
          <path
            key={wire.id}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={0.04}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        );
      })}
      {layer.symbols.map((symbol) => (
        <SymbolMark
          key={symbol.id}
          symbol={symbol}
          color={circuitColor(layer, symbol.circuit, layer.color)}
        />
      ))}
    </g>
  );
}

type Gap = { a: number; b: number };

function openingsOnWall(plan: Floorplan, wall: Door["wall"]): Gap[] {
  const gaps: Gap[] = [
    ...plan.doors.filter((d) => d.exterior && d.wall === wall).map((d) => {
      const g = doorGapOnWall(d);
      return { a: g.a, b: g.b };
    }),
    ...plan.windows.filter((w) => w.wall === wall).map((w) => ({
      a: (wall === "n" || wall === "s" ? w.x : w.y) - w.width / 2,
      b: (wall === "n" || wall === "s" ? w.x : w.y) + w.width / 2,
    })),
  ];
  return gaps.sort((x, y) => x.a - y.a);
}

function perimeterPieces(
  gaps: Gap[],
  length: number,
  map: (from: number, to: number) => { x1: number; y1: number; x2: number; y2: number },
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const pieces: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.a > cursor) pieces.push(map(cursor, gap.a));
    cursor = Math.max(cursor, gap.b);
  }
  if (cursor < length) pieces.push(map(cursor, length));
  return pieces;
}

function StructureLayer({ plan }: { plan: Floorplan }) {
  const { width: W, depth: D, eaves, wall } = plan;
  const stroke = "#d6d3d1";
  const muted = "#78716c";
  const pieces = plan.walls.flatMap((seg, i) =>
    wallPieces(plan, seg).map((p, j) => ({ ...p, key: `${i}-${j}` })),
  );

  const north = perimeterPieces(openingsOnWall(plan, "n"), W, (a, b) => ({
    x1: a,
    y1: 0,
    x2: b,
    y2: 0,
  }));
  const south = perimeterPieces(openingsOnWall(plan, "s"), W, (a, b) => ({
    x1: a,
    y1: D,
    x2: b,
    y2: D,
  }));
  const west = perimeterPieces(openingsOnWall(plan, "w"), D, (a, b) => ({
    x1: 0,
    y1: a,
    x2: 0,
    y2: b,
  }));
  const east = perimeterPieces(openingsOnWall(plan, "e"), D, (a, b) => ({
    x1: W,
    y1: a,
    x2: W,
    y2: b,
  }));

  return (
    <g>
      <rect
        x={-eaves}
        y={-eaves}
        width={W + eaves * 2}
        height={D + eaves * 2}
        fill="none"
        stroke={muted}
        strokeWidth={0.025}
        strokeDasharray="0.12 0.08"
      />
      <rect x={0} y={0} width={W} height={D} fill="#1c1612" stroke="none" />
      {[...north, ...south, ...west, ...east].map((p, i) => (
        <line key={`p-${i}`} {...p} stroke={stroke} strokeWidth={wall} />
      ))}
      {pieces.map((p) => (
        <line key={p.key} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={stroke} strokeWidth={wall * 0.85} />
      ))}
      {plan.doors.map((door) => (
        <path
          key={door.id}
          d={doorPath(door)}
          fill="none"
          stroke={door.exterior ? "#f3c77a" : stroke}
          strokeWidth={0.035}
        />
      ))}
      {plan.windows.map((win) => {
        const seg = windowSegment(win);
        const horizontal = win.wall === "n" || win.wall === "s";
        return (
          <g key={win.id}>
            <line
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke="#38bdf8"
              strokeWidth={0.08}
              strokeLinecap="square"
            />
            <line
              x1={horizontal ? seg.x1 : seg.x1 - 0.04}
              y1={horizontal ? seg.y1 - 0.04 : seg.y1}
              x2={horizontal ? seg.x2 : seg.x2 - 0.04}
              y2={horizontal ? seg.y2 - 0.04 : seg.y2}
              stroke="#38bdf8"
              strokeWidth={0.02}
              opacity={0.7}
            />
            <line
              x1={horizontal ? seg.x1 : seg.x1 + 0.04}
              y1={horizontal ? seg.y1 + 0.04 : seg.y1}
              x2={horizontal ? seg.x2 : seg.x2 + 0.04}
              y2={horizontal ? seg.y2 + 0.04 : seg.y2}
              stroke="#38bdf8"
              strokeWidth={0.02}
              opacity={0.7}
            />
          </g>
        );
      })}
    </g>
  );
}

export function FloorplanViewer({ plan = alonsoFloorplan }: { plan?: Floorplan }) {
  const [visible, setVisible] = useState(() => defaultLayerVisibility(plan));
  const [showArch, setShowArch] = useState(false);
  const [showElectrical, setShowElectrical] = useState(false);

  const electrical = plan.layers.find((l) => l.id === "electrical");

  const viewBox = useMemo(() => {
    const x = -(plan.eaves + PAD);
    const y = -(plan.eaves + PAD);
    const w = plan.width + plan.eaves * 2 + PAD * 2;
    const h = plan.depth + plan.eaves * 2 + PAD * 2;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return `${r(x)} ${r(y)} ${r(w)} ${r(h)}`;
  }, [plan]);

  function toggle(id: FloorplanLayerId) {
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">{plan.source}</p>
          <h2 className="text-lg font-semibold text-stone-50">{plan.name}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowArch((v) => !v)}
            className="rounded-full bg-ink-800 px-3 py-1.5 text-xs text-stone-400"
          >
            {showArch ? "Ocultar arch." : "Scan arquitectónico"}
          </button>
          <button
            type="button"
            onClick={() => setShowElectrical((v) => !v)}
            className="rounded-full bg-ink-800 px-3 py-1.5 text-xs text-stone-400"
          >
            {showElectrical ? "Ocultar croquis" : "Croquis eléctrico"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {plan.layers.map((layer) => {
          const on = visible[layer.id];
          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => toggle(layer.id)}
              aria-pressed={on}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                on ? "text-ink-950" : "bg-ink-800 text-stone-500"
              }`}
              style={on ? { backgroundColor: layer.color } : undefined}
            >
              {layer.name}
            </button>
          );
        })}
      </div>

      {visible.electrical && electrical?.circuits ? (
        <div className="flex flex-wrap gap-3 text-xs text-stone-400">
          {electrical.circuits.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      {showArch ? (
        <div className="overflow-hidden rounded-3xl border border-white/5 bg-ink-900 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/plano-alonso.jpeg"
            alt="Scan arquitectónico original"
            className="mx-auto max-h-[70vh] w-auto rounded-2xl"
          />
        </div>
      ) : null}

      {showElectrical ? (
        <div className="overflow-hidden rounded-3xl border border-white/5 bg-ink-900 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/plano-electrico-original.jpeg"
            alt="Croquis eléctrico original"
            className="mx-auto max-h-[70vh] w-auto rounded-2xl"
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-white/5 bg-ink-900 p-3 sm:p-5">
        <svg
          viewBox={viewBox}
          className="mx-auto h-auto w-full max-w-xl"
          role="img"
          aria-label={`Plano de ${plan.name}`}
        >
          {visible.structure ? <StructureLayer plan={plan} /> : null}
          {plan.layers
            .filter((l) => l.id !== "structure" && visible[l.id])
            .map((layer) => (
              <LayerDrawing key={layer.id} layer={layer} />
            ))}
        </svg>
      </div>

      <p className="text-xs text-stone-500">
        Capa eléctrica adaptada del croquis a la base en{" "}
        <code className="text-stone-400">src/lib/floorplan.ts</code>. Ajustamos posiciones si algo
        no calza con la casa real.
      </p>
    </div>
  );
}
