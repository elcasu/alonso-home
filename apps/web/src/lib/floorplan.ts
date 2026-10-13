/** Plano digital de la casa prefabricada Alonso (Tecnohouse / Pons Federico). Unidades: metros. Origen: esquina interior NO (arriba-izquierda), Y hacia abajo. */

export type FloorplanLayerId =
  | "structure"
  | "electrical"
  | "domotics"
  | "water"
  | "gas"
  | "network";

export type Room = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Texto de cota opcional (si el ambiente no es un rectángulo simple) */
  sizeLabel?: string;
  zoneId?: string;
};

export type Door = {
  id: string;
  wall: "n" | "s" | "e" | "w";
  x: number;
  y: number;
  width: number;
  hinge: "left" | "right";
  inward?: boolean;
  exterior?: boolean;
};

export type WindowOpening = {
  id: string;
  wall: "n" | "s" | "e" | "w";
  x: number;
  y: number;
  width: number;
  label?: string;
};

export type LayerSymbolKind =
  | "outlet"
  | "switch"
  | "light"
  | "light-out"
  | "panel"
  | "device"
  | "camera"
  | "water"
  | "drain"
  | "gas"
  | "note";

/** Circuitos del croquis: azul / rojo / negro */
export type CircuitId = "blue" | "red" | "black";

export type LayerSymbol = {
  id: string;
  kind: LayerSymbolKind;
  x: number;
  y: number;
  label?: string;
  rotate?: number;
  /** Color de circuito (capa eléctrica) */
  circuit?: CircuitId;
};

export type Wire = {
  id: string;
  circuit: CircuitId;
  points: { x: number; y: number }[];
};

export type CircuitStyle = {
  id: CircuitId;
  name: string;
  color: string;
};

export type FloorplanLayer = {
  id: FloorplanLayerId;
  name: string;
  color: string;
  defaultOn: boolean;
  symbols: LayerSymbol[];
  wires?: Wire[];
  circuits?: CircuitStyle[];
};

export type WallSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  doorIds?: string[];
};

export type Floorplan = {
  id: string;
  name: string;
  source: string;
  width: number;
  depth: number;
  eaves: number;
  wall: number;
  rooms: Room[];
  doors: Door[];
  windows: WindowOpening[];
  walls: WallSegment[];
  layers: FloorplanLayer[];
};

/** Entradita del dormitorio medio (pasillo se mete hacia el oeste). Cota de muro 2.05 m. */
export const DORM_MW_ALCOVE_W = 0.75;
export const DORM_MW_ALCOVE_H = 0.85; // 2.90 − 2.05
export const DORM_MW_WALL = 2.05;

/**
 * Geometría según cotas del plano:
 * - Arriba: dos dormitorios 3.00 + 3.00 (sin pasillo entremedio)
 * - Baño superior en suite al dormitorio NE
 * - Dormitorio medio con entradita (pasillo entra ~0.75 m; muro 2.05 m)
 * - Pasillo 1.00 solo desde y=3.00 hasta el living
 * - Living-Comedor y Cocina: un solo ambiente abierto al pasillo
 */
export const alonsoFloorplan: Floorplan = {
  id: "alonso",
  name: "Casa Alonso",
  source: "Pons Federico / Viviendas Tecnohouse",
  width: 6.0,
  depth: 8.7,
  eaves: 0.3,
  wall: 0.1,
  rooms: [
    { id: "dorm-nl", name: "Dormitorio", x: 0, y: 0, w: 3.0, h: 3.0, zoneId: "bedroom" },
    { id: "dorm-nr", name: "Dormitorio", x: 3.0, y: 0, w: 3.0, h: 3.0 },
    {
      id: "dorm-mw",
      name: "Dormitorio",
      x: 0,
      y: 3.0,
      w: 3.0,
      h: 2.9,
      sizeLabel: "3.00 × 2.90 m · entrada",
      zoneId: "bedroom",
    },
    { id: "pasillo", name: "Pasillo", x: 3.0, y: 3.0, w: 1.0, h: 2.9, zoneId: "hallway" },
    { id: "bano-1", name: "Baño", x: 4.0, y: 3.0, w: 2.0, h: 1.4, zoneId: "bathroom" },
    { id: "bano-2", name: "Baño", x: 4.0, y: 4.4, w: 2.0, h: 1.5 },
    {
      id: "living",
      name: "Living-Comedor / Cocina",
      x: 0,
      y: 5.9,
      w: 6.0,
      h: 2.8,
      sizeLabel: "6.00 × 2.80 m",
      zoneId: "living",
    },
  ],
  doors: [
    // Living: muro sur, abajo a la izquierda; bisagra al oeste → abre al living (no contra la pared)
    { id: "door-main", wall: "s", x: 0.5, y: 8.7, width: 0.8, hinge: "left", exterior: true },
    // Cocina (mismo ambiente): sale al este
    { id: "door-cocina", wall: "e", x: 6.0, y: 8.25, width: 0.8, hinge: "right", exterior: true },
    // Dormitorios de arriba: puertas al sur, hacia el pasillo
    { id: "door-dorm-nl", wall: "s", x: 2.55, y: 3.0, width: 0.7, hinge: "right" },
    { id: "door-dorm-nr", wall: "s", x: 3.45, y: 3.0, width: 0.7, hinge: "left" },
    // Dormitorio 3: puerta en el muro oeste de la entradita, abre hacia la izquierda (oeste)
    {
      id: "door-dorm-mw",
      wall: "e",
      x: 3.0 - DORM_MW_ALCOVE_W,
      y: 3.0 + DORM_MW_ALCOVE_H / 2,
      width: 0.7,
      hinge: "left",
    },
    // Baño de arriba: en suite al dormitorio NE
    { id: "door-bano-1", wall: "n", x: 5.0, y: 3.0, width: 0.7, hinge: "left" },
    { id: "door-bano-2", wall: "w", x: 4.0, y: 5.15, width: 0.7, hinge: "left" },
  ],
  windows: [
    { id: "win-n-l", wall: "n", x: 1.5, y: 0, width: 1.0, label: "100×100" },
    { id: "win-n-r", wall: "n", x: 4.5, y: 0, width: 1.0, label: "100×100" },
    { id: "win-w-dorm-nl", wall: "w", x: 0, y: 1.5, width: 1.0, label: "100×100" },
    { id: "win-w-dorm-mw", wall: "w", x: 0, y: 4.45, width: 1.0, label: "100×100" },
    { id: "win-w-living", wall: "w", x: 0, y: 7.0, width: 1.0, label: "100×100" },
    { id: "win-s-living", wall: "s", x: 2.0, y: 8.7, width: 1.2, label: "120×120" },
    { id: "win-e-bano-1", wall: "e", x: 6.0, y: 3.7, width: 0.4, label: "40×26" },
    { id: "win-e-bano-2", wall: "e", x: 6.0, y: 5.15, width: 0.4, label: "40×26" },
    { id: "win-e-cocina", wall: "e", x: 6.0, y: 7.0, width: 1.2, label: "120×60" },
  ],
  walls: [
    // Separación dormitorios de arriba
    { x1: 3.0, y1: 0, x2: 3.0, y2: 3.0 },
    // Frente sur de dormitorios + acceso en suite al baño superior
    { x1: 0, y1: 3.0, x2: 6.0, y2: 3.0, doorIds: ["door-dorm-nl", "door-dorm-nr", "door-bano-1"] },
    // Entradita del dormitorio 3: puerta abre al oeste (izquierda)
    {
      x1: 3.0 - DORM_MW_ALCOVE_W,
      y1: 3.0,
      x2: 3.0 - DORM_MW_ALCOVE_W,
      y2: 3.0 + DORM_MW_ALCOVE_H,
      doorIds: ["door-dorm-mw"],
    },
    {
      x1: 3.0 - DORM_MW_ALCOVE_W,
      y1: 3.0 + DORM_MW_ALCOVE_H,
      x2: 3.0,
      y2: 3.0 + DORM_MW_ALCOVE_H,
    },
    // Muro 2.05 m del dormitorio medio al pasillo (debajo de la entradita)
    {
      x1: 3.0,
      y1: 3.0 + DORM_MW_ALCOVE_H,
      x2: 3.0,
      y2: 3.0 + DORM_MW_ALCOVE_H + DORM_MW_WALL,
    },
    // Lado este del pasillo (baños)
    { x1: 4.0, y1: 3.0, x2: 4.0, y2: 5.9, doorIds: ["door-bano-2"] },
    // Entre baños
    { x1: 4.0, y1: 4.4, x2: 6.0, y2: 4.4 },
    // Living abierto al pasillo (sin puerta) y sin división con cocina
    { x1: 0, y1: 5.9, x2: 3.0, y2: 5.9 },
    { x1: 4.0, y1: 5.9, x2: 6.0, y2: 5.9 },
  ],
  layers: [
    {
      id: "structure",
      name: "Estructura",
      color: "#e7e5e4",
      defaultOn: true,
      symbols: [],
    },
    {
      id: "electrical",
      name: "Eléctrico",
      color: "#f3c77a",
      defaultOn: true,
      circuits: [
        { id: "blue", name: "Living / cocina", color: "#60a5fa" },
        { id: "red", name: "Dorm.3 / pasillo", color: "#f87171" },
        { id: "black", name: "Dorm. N / baños", color: "#d6d3d1" },
      ],
      /**
       * Croquis eléctrico girado 180° para alinear con el plano arquitectónico
       * (en el cuaderno el living quedaba arriba). Tablero: lado este del living
       * (izquierda del croquis → derecha del plano).
       */
      symbols: [
        { id: "el-panel", kind: "panel", x: 5.82, y: 6.5, label: "Tablero", circuit: "blue" },

        // Azul — living / cocina (sur)
        { id: "el-l-living", kind: "light", x: 2.1, y: 7.25, circuit: "blue" },
        { id: "el-l-cocina", kind: "light", x: 5.05, y: 7.25, circuit: "blue" },
        { id: "el-sw-living-door", kind: "switch", x: 0.55, y: 8.45, circuit: "blue" },
        { id: "el-sw-living-hall", kind: "switch", x: 3.15, y: 6.15, circuit: "blue" },
        { id: "el-sw-cocina", kind: "switch", x: 5.7, y: 8.35, circuit: "blue" },
        { id: "el-out-s", kind: "light-out", x: 1.5, y: 8.92, circuit: "blue", rotate: 180 },
        { id: "el-out-living-w1", kind: "outlet", x: 0.12, y: 6.7, circuit: "blue", rotate: 90 },
        { id: "el-out-living-w2", kind: "outlet", x: 0.12, y: 7.8, circuit: "blue", rotate: 90 },
        { id: "el-out-cocina-e1", kind: "outlet", x: 5.88, y: 6.9, circuit: "blue", rotate: 90 },
        { id: "el-out-cocina-e2", kind: "outlet", x: 5.88, y: 7.7, circuit: "blue", rotate: 90 },

        // Rojo — dormitorio 3 + pasillo
        { id: "el-l-dorm3", kind: "light", x: 1.35, y: 4.55, circuit: "red" },
        { id: "el-l-hall-n", kind: "light", x: 3.5, y: 3.55, circuit: "red" },
        { id: "el-l-hall-s", kind: "light", x: 3.5, y: 5.25, circuit: "red" },
        { id: "el-sw-dorm3", kind: "switch", x: 2.35, y: 3.4, circuit: "red" },
        { id: "el-sw-hall", kind: "switch", x: 3.78, y: 3.25, circuit: "red" },
        { id: "el-out-dorm3-w", kind: "outlet", x: 0.12, y: 4.9, circuit: "red", rotate: 90 },

        // Negro — dormitorios norte + baños
        { id: "el-l-dorm1", kind: "light", x: 1.5, y: 1.5, circuit: "black" },
        { id: "el-l-dorm2", kind: "light", x: 4.5, y: 1.5, circuit: "black" },
        { id: "el-sw-dorm1", kind: "switch", x: 2.75, y: 2.85, circuit: "black" },
        { id: "el-sw-dorm2", kind: "switch", x: 3.25, y: 2.85, circuit: "black" },
        { id: "el-l-bano1", kind: "light", x: 5.0, y: 3.7, circuit: "black" },
        { id: "el-l-bano2", kind: "light", x: 5.0, y: 5.15, circuit: "black" },
        { id: "el-sw-bano1", kind: "switch", x: 4.2, y: 3.35, circuit: "black" },
        { id: "el-sw-bano2", kind: "switch", x: 4.2, y: 5.0, circuit: "black" },
        { id: "el-out-bano1", kind: "outlet", x: 5.88, y: 3.45, circuit: "black", rotate: 90 },
        { id: "el-out-bano2", kind: "outlet", x: 5.88, y: 5.4, circuit: "black", rotate: 90 },
      ],
      wires: [
        // Azul: tablero (este living) → luces living/cocina → exterior sur
        {
          id: "w-blue-feed",
          circuit: "blue",
          points: [
            { x: 5.82, y: 6.5 },
            { x: 5.05, y: 6.5 },
            { x: 5.05, y: 7.25 },
          ],
        },
        {
          id: "w-blue-span",
          circuit: "blue",
          points: [
            { x: 5.05, y: 7.25 },
            { x: 2.1, y: 7.25 },
            { x: 1.5, y: 7.25 },
            { x: 1.5, y: 8.92 },
          ],
        },
        {
          id: "w-blue-sw-door",
          circuit: "blue",
          points: [
            { x: 2.1, y: 7.25 },
            { x: 0.55, y: 7.25 },
            { x: 0.55, y: 8.45 },
          ],
        },
        {
          id: "w-blue-sw-hall",
          circuit: "blue",
          points: [
            { x: 2.1, y: 7.25 },
            { x: 2.1, y: 6.15 },
            { x: 3.15, y: 6.15 },
          ],
        },
        {
          id: "w-blue-sw-cocina",
          circuit: "blue",
          points: [
            { x: 5.05, y: 7.25 },
            { x: 5.7, y: 7.25 },
            { x: 5.7, y: 8.35 },
          ],
        },
        // Rojo: desde tablero por este → pasillo / dorm3
        {
          id: "w-red-feed",
          circuit: "red",
          points: [
            { x: 5.82, y: 6.5 },
            { x: 5.82, y: 5.25 },
            { x: 3.5, y: 5.25 },
          ],
        },
        {
          id: "w-red-hall",
          circuit: "red",
          points: [
            { x: 3.5, y: 5.25 },
            { x: 3.5, y: 3.55 },
          ],
        },
        {
          id: "w-red-dorm3",
          circuit: "red",
          points: [
            { x: 3.5, y: 4.55 },
            { x: 1.35, y: 4.55 },
          ],
        },
        {
          id: "w-red-sw-dorm3",
          circuit: "red",
          points: [
            { x: 1.35, y: 4.55 },
            { x: 1.35, y: 3.4 },
            { x: 2.35, y: 3.4 },
          ],
        },
        {
          id: "w-red-sw-hall",
          circuit: "red",
          points: [
            { x: 3.5, y: 3.55 },
            { x: 3.78, y: 3.55 },
            { x: 3.78, y: 3.25 },
          ],
        },
        // Negro: tablero → baños → dormitorios norte
        {
          id: "w-black-baths",
          circuit: "black",
          points: [
            { x: 5.82, y: 6.5 },
            { x: 5.82, y: 5.15 },
            { x: 5.0, y: 5.15 },
            { x: 5.0, y: 3.7 },
          ],
        },
        {
          id: "w-black-dorms",
          circuit: "black",
          points: [
            { x: 5.0, y: 3.7 },
            { x: 5.0, y: 1.5 },
            { x: 4.5, y: 1.5 },
            { x: 1.5, y: 1.5 },
          ],
        },
        {
          id: "w-black-sw1",
          circuit: "black",
          points: [
            { x: 1.5, y: 1.5 },
            { x: 2.75, y: 1.5 },
            { x: 2.75, y: 2.85 },
          ],
        },
        {
          id: "w-black-sw2",
          circuit: "black",
          points: [
            { x: 4.5, y: 1.5 },
            { x: 3.25, y: 1.5 },
            { x: 3.25, y: 2.85 },
          ],
        },
      ],
    },
    { id: "domotics", name: "Domótica", color: "#7dd3fc", defaultOn: false, symbols: [] },
    { id: "water", name: "Agua", color: "#67e8f9", defaultOn: false, symbols: [] },
    { id: "gas", name: "Gas", color: "#fca5a5", defaultOn: false, symbols: [] },
    { id: "network", name: "Red / cámaras", color: "#c4b5fd", defaultOn: false, symbols: [] },
  ],
};

export function circuitColor(
  layer: FloorplanLayer,
  circuit: CircuitId | undefined,
  fallback: string,
): string {
  if (!circuit || !layer.circuits) return fallback;
  return layer.circuits.find((c) => c.id === circuit)?.color ?? fallback;
}

export function defaultLayerVisibility(plan: Floorplan): Record<FloorplanLayerId, boolean> {
  return Object.fromEntries(plan.layers.map((l) => [l.id, l.defaultOn])) as Record<
    FloorplanLayerId,
    boolean
  >;
}

export function doorGapOnWall(
  door: Door,
): { axis: "x" | "y"; fixed: number; a: number; b: number } {
  const half = door.width / 2;
  if (door.wall === "n" || door.wall === "s") {
    return { axis: "x", fixed: door.y, a: door.x - half, b: door.x + half };
  }
  return { axis: "y", fixed: door.x, a: door.y - half, b: door.y + half };
}
