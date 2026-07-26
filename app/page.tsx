"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

type Zone = {
  name: string;
  pump: string;
  pumpCode: string;
  zoneNumber: number;
  id: string;
  coordinates: [number, number][];
};
type MapFeature = { name: string; type: "polygon" | "line" | "point"; coordinates: [number, number][] };
type Farm = {
  name: string;
  code: string;
  wateringMethod?: "Hand Watered";
  zones: Zone[];
  pumps: { name: string; coordinates: [number, number] }[];
  boundary: [number, number][];
  roads: MapFeature[];
  features: MapFeature[];
  infrastructure: MapFeature[];
};
type Group = {
  id: number;
  zoneId: string;
  species: string;
  height: string;
  caliper: string;
  quantity: number;
  priceCents: number;
  availableQuantity: number;
  taggedQuantity: number;
  soldQuantity: number;
  plantedOn: string;
};
type Allocation = {
  id: number;
  groupId: number;
  zoneId: string;
  species: string;
  height: string;
  caliper: string;
  quantity: number;
  priceCents: number;
  status: "Tagged" | "Sold";
  client: string;
  orderNumber: string;
  markingMethod: string;
  createdAt: string;
};
type Activity = {
  id: number;
  groupId: number;
  zoneId: string;
  activityType: string;
  activityDate: string;
  details: string;
  performedBy: string;
  species: string | null;
  height: string | null;
  caliper: string | null;
};
type ConfirmationAction =
  | { kind: "receive"; allocation: Allocation }
  | { kind: "delete"; group: Group };

// A zone belongs to a farm only when its id is that farm's code, or the code
// followed by a separator. Plain `.startsWith(code)` would also match, say,
// zone ids under a future "F1" farm against the existing "F10" farm's zones.
function zoneBelongsToFarm(zoneId: string, code: string) {
  return zoneId === code || zoneId.startsWith(`${code}-`);
}

const LOW_STOCK_THRESHOLD = 10;

const FALLBACK_GROUPS: Group[] = [
  { id: 1, zoneId: "F70-FRONT-01", species: "Live Oak", height: "12–14 ft", caliper: "3.5 in", quantity: 86, priceCents: 0, availableQuantity: 86, taggedQuantity: 0, soldQuantity: 0, plantedOn: "2024-02-12" },
  { id: 2, zoneId: "F70-FRONT-01", species: "Bald Cypress", height: "10–12 ft", caliper: "3 in", quantity: 42, priceCents: 0, availableQuantity: 0, taggedQuantity: 42, soldQuantity: 0, plantedOn: "2023-11-06" },
  { id: 3, zoneId: "F70-NORTH-03", species: "Mahogany", height: "14–16 ft", caliper: "4 in", quantity: 28, priceCents: 0, availableQuantity: 0, taggedQuantity: 0, soldQuantity: 28, plantedOn: "2023-08-18" },
  { id: 4, zoneId: "F40-WEST-05", species: "Gumbo Limbo", height: "8–10 ft", caliper: "2.5 in", quantity: 115, priceCents: 0, availableQuantity: 115, taggedQuantity: 0, soldQuantity: 0, plantedOn: "2025-01-20" },
  { id: 5, zoneId: "F25-NORTH-02", species: "Royal Poinciana", height: "10–12 ft", caliper: "3 in", quantity: 64, priceCents: 0, availableQuantity: 64, taggedQuantity: 0, soldQuantity: 0, plantedOn: "2024-05-14" },
];
const FALLBACK_ALLOCATIONS: Allocation[] = [
  { id: 1, groupId: 2, zoneId: "F70-FRONT-01", species: "Bald Cypress", height: "10–12 ft", caliper: "3 in", quantity: 42, priceCents: 0, status: "Tagged", client: "Palm Beach Gardens", orderNumber: "SO-2408", markingMethod: "Ribbon tag", createdAt: "" },
  { id: 2, groupId: 3, zoneId: "F70-NORTH-03", species: "Mahogany", height: "14–16 ft", caliper: "4 in", quantity: 28, priceCents: 0, status: "Sold", client: "Evergreen Landscape", orderNumber: "SO-2391", markingMethod: "Metal tag", createdAt: "" },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

// Groups migrated before price_cents existed (or created without a price)
// store 0 the same as a deliberately free tree. Since that's indistinguishable
// from the data alone, treat 0 as "not priced yet" so it reads as missing
// information instead of a $0.00 tree.
function formatPrice(cents: number) {
  return cents > 0 ? formatMoney(cents) : "No price set";
}
function priceClass(cents: number) {
  return cents > 0 ? "" : "price-unset";
}

function csvEscape(value: string | number | undefined) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
function toCsv(rows: Record<string, string | number | undefined>[], columns: { key: string; label: string }[]) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(","));
  return [header, ...lines].join("\r\n");
}
// Minimal RFC 4180 parser: handles quoted fields with embedded commas,
// escaped quotes ("") inside them, and CRLF/LF line endings.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field); field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type MapLayers = { roads: boolean; operations: boolean; irrigation: boolean };

function FarmCanvas({ farm, selectedZone, layers, onSelect }: { farm: Farm; selectedZone: string; layers: MapLayers; onSelect: (zone: Zone) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shapesRef = useRef<{ zone: Zone; points: { x: number; y: number }[]; center: { x: number; y: number } }[]>([]);
  const [zoom, setZoom] = useState(farm.code === "F70" ? 1.15 : 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !farm?.zones.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.scale(ratio, ratio);
    const all = farm.zones.flatMap((z) => z.coordinates);
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 64;
    const averageLatitude = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const longitudeCorrection = Math.cos(averageLatitude * Math.PI / 180);
    const geographicWidth = (maxX - minX) * longitudeCorrection;
    const geographicHeight = maxY - minY;
    const scale = Math.min((width - pad * 2) / geographicWidth, (height - pad * 2) / geographicHeight);
    const drawnWidth = geographicWidth * scale;
    const drawnHeight = geographicHeight * scale;
    const offsetX = (width - drawnWidth) / 2;
    const offsetY = (height - drawnHeight) / 2;
    const project = ([x, y]: [number, number]) => {
      const baseX = offsetX + (x - minX) * longitudeCorrection * scale;
      const baseY = offsetY + drawnHeight - (y - minY) * scale;
      return {
        x: width / 2 + (baseX - width / 2) * zoom,
        y: height / 2 + (baseY - height / 2) * zoom,
      };
    };
    const boundaryPoints = farm.boundary?.length ? farm.boundary.map(project) : [];
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ebe7dc";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(104,91,65,.12)";
    ctx.lineWidth = 1;
    for (let x = 20; x < width; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 16; y < height; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

    if (boundaryPoints.length) {
      ctx.beginPath();
      boundaryPoints.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath();
      ctx.fillStyle = "rgba(255,253,248,.2)";
      ctx.strokeStyle = "#7b6a50";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    if (layers.operations) {
      (farm.features || []).forEach((feature) => {
        const points = feature.coordinates.map(project);
        if (feature.type === "point") {
          ctx.fillStyle = "#72583d";
          ctx.fillRect(points[0].x - 3, points[0].y - 3, 6, 6);
          return;
        }
        ctx.beginPath();
        points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        if (feature.type === "polygon") ctx.closePath();
        ctx.fillStyle = "rgba(129,107,75,.28)";
        ctx.strokeStyle = "#7a674e";
        ctx.lineWidth = 1.4;
        if (feature.type === "polygon") ctx.fill();
        ctx.stroke();
      });
    }

    shapesRef.current = farm.zones.map((zone) => {
      const geographicPoints = zone.coordinates.map(project);
      const zoneXs = geographicPoints.map((point) => point.x);
      const zoneYs = geographicPoints.map((point) => point.y);
      const center = {
        x: (Math.min(...zoneXs) + Math.max(...zoneXs)) / 2,
        y: (Math.min(...zoneYs) + Math.max(...zoneYs)) / 2,
      };
      const halfWidth = Math.max(7, (Math.max(...zoneXs) - Math.min(...zoneXs)) / 2 - 4);
      const halfHeight = Math.max(7, (Math.max(...zoneYs) - Math.min(...zoneYs)) / 2 - 4);
      const points = [
        { x: center.x - halfWidth, y: center.y - halfHeight },
        { x: center.x + halfWidth, y: center.y - halfHeight },
        { x: center.x + halfWidth, y: center.y + halfHeight },
        { x: center.x - halfWidth, y: center.y + halfHeight },
      ];
      return { zone, points, center };
    });
    ctx.save();
    if (boundaryPoints.length) {
      ctx.beginPath();
      boundaryPoints.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath();
      ctx.clip();
    }
    shapesRef.current.forEach(({ zone, points }) => {
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath();
      const selected = zone.id === selectedZone;
      const pumpColor =
        zone.pump === "South" ? "#e7b38f" :
        zone.pump === "North" ? "#a9c78e" :
        zone.pump === "West" ? "#b8cf9d" :
        zone.pump === "East" ? "#9fc7bd" :
        "#c8d7a8";
      ctx.fillStyle = selected ? "#de6f39" : pumpColor;
      ctx.strokeStyle = selected ? "#7b321a" : "#607052";
      ctx.lineWidth = selected ? 2.5 : 1;
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();

    if (layers.irrigation) {
      (farm.infrastructure || []).forEach((feature) => {
        const points = feature.coordinates.map(project);
        if (feature.type === "point") {
          ctx.beginPath();
          ctx.arc(points[0].x, points[0].y, feature.name.toLowerCase().includes("valve") ? 2.4 : 1.4, 0, Math.PI * 2);
          ctx.fillStyle = feature.name.toLowerCase().includes("valve") ? "#225f68" : "rgba(47,112,118,.55)";
          ctx.fill();
          return;
        }
        ctx.beginPath();
        points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        ctx.strokeStyle = feature.name.toLowerCase().includes("main") ? "#1f6672" : "rgba(47,112,118,.48)";
        ctx.lineWidth = feature.name.toLowerCase().includes("main") ? 2.3 : .8;
        ctx.stroke();
      });
    }

    if (layers.roads) {
      (farm.roads || []).forEach((road) => {
        const points = road.coordinates.map(project);
        ctx.beginPath();
        points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        if (road.type === "polygon") ctx.closePath();
        ctx.strokeStyle = "#a46b3f";
        ctx.fillStyle = "rgba(201,139,76,.28)";
        ctx.lineWidth = road.type === "line" ? 4 : 1.6;
        ctx.setLineDash(road.type === "line" ? [8, 5] : []);
        if (road.type === "polygon") ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    if (boundaryPoints.length) {
      ctx.beginPath();
      boundaryPoints.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath();
      ctx.strokeStyle = "#6f6049";
      ctx.lineWidth = 2.4;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    const zoneLabelBoxes: { left: number; top: number; right: number; bottom: number }[] = [];
    shapesRef.current.forEach(({ zone, center }) => {
      const selected = zone.id === selectedZone;
      const number = zone.name.match(/\d+/)?.[0];
      const shortLabel = number
        ? `${zone.pump === "Hand Watered" ? "Z" : zone.pump.charAt(0).toUpperCase()}-${number.padStart(2, "0")}`
        : zone.name.replace(`${zone.pump} `, "").slice(0, 8);
      ctx.font = selected ? "700 9px Arial" : "700 7.5px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = selected ? "rgba(74,35,20,.85)" : "rgba(255,253,248,.92)";
      ctx.strokeText(shortLabel, center.x, center.y);
      ctx.fillStyle = selected ? "#fffdf8" : "#304438";
      ctx.fillText(shortLabel, center.x, center.y);
      const labelWidth = ctx.measureText(shortLabel).width + 6;
      zoneLabelBoxes.push({
        left: center.x - labelWidth / 2,
        top: center.y - 7,
        right: center.x + labelWidth / 2,
        bottom: center.y + 7,
      });
    });

    const pumpLabelBoxes: { left: number; top: number; right: number; bottom: number }[] = [];
    const overlaps = (
      box: { left: number; top: number; right: number; bottom: number },
      other: { left: number; top: number; right: number; bottom: number },
    ) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;

    farm.pumps.forEach((pump, index) => {
      const point = project(pump.coordinates);
      ctx.beginPath(); ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#2e6d75"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      const label = pump.name
        .replace(/\s+Station$/i, "")
        .replace(/\bDischarg\b/i, "Discharge");
      ctx.font = "700 8px Arial";
      ctx.textBaseline = "middle";
      const labelWidth = ctx.measureText(label).width + 8;
      const candidates = [
        { left: point.x + 12, top: point.y - 28 },
        { left: point.x - labelWidth - 12, top: point.y - 28 },
        { left: point.x + 12, top: point.y + 10 },
        { left: point.x - labelWidth - 12, top: point.y + 10 },
        { left: point.x - labelWidth / 2, top: point.y - 42 },
        { left: point.x - labelWidth / 2, top: point.y + 24 },
      ];
      const fallback = { left: 12, top: 12 + index * 21 };
      const choice = candidates.find((candidate) => {
        const box = { ...candidate, right: candidate.left + labelWidth, bottom: candidate.top + 18 };
        return box.left >= 6 && box.right <= width - 6 && box.top >= 6 && box.bottom <= height - 6
          && !zoneLabelBoxes.some((zoneBox) => overlaps(box, zoneBox))
          && !pumpLabelBoxes.some((pumpBox) => overlaps(box, pumpBox));
      }) || fallback;
      const labelBox = { ...choice, right: choice.left + labelWidth, bottom: choice.top + 18 };
      pumpLabelBoxes.push(labelBox);
      const labelX = choice.left + 4;
      const labelY = choice.top + 9;
      const targetX = Math.max(choice.left, Math.min(point.x, choice.left + labelWidth));
      const targetY = Math.max(choice.top, Math.min(point.y, choice.top + 18));
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(targetX, targetY);
      ctx.strokeStyle = "rgba(33,77,83,.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,253,248,.9)";
      ctx.fillRect(choice.left, choice.top, labelWidth, 18);
      ctx.strokeStyle = "rgba(33,77,83,.35)";
      ctx.strokeRect(choice.left, choice.top, labelWidth, 18);
      ctx.fillStyle = "#214d53";
      ctx.fillText(label, labelX, labelY);
    });
  }, [farm, selectedZone, layers, zoom]);

  function click(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const hit = [...shapesRef.current].reverse().find(({ points }) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        if (((points[i].y > y) !== (points[j].y > y)) && (x < (points[j].x - points[i].x) * (y - points[i].y) / (points[j].y - points[i].y) + points[i].x)) inside = !inside;
      }
      return inside;
    });
    if (hit) onSelect(hit.zone);
  }

  function changeZoom(next: number) {
    setZoom(Math.max(.8, Math.min(3, Number(next.toFixed(2)))));
  }

  return (
    <div className={`map-viewport ${farm.code === "F70" ? "map-viewport-large" : ""}`}>
      <canvas
        ref={canvasRef}
        className="farm-canvas"
        onClick={click}
        onWheel={(event) => {
          event.preventDefault();
          changeZoom(zoom + (event.deltaY < 0 ? .15 : -.15));
        }}
        aria-label={`${farm.name} schematic farm zone map. Zoom ${Math.round(zoom * 100)} percent.`}
      />
      <div className="zoom-controls" aria-label="Map zoom controls">
        <button type="button" onClick={() => changeZoom(zoom - .2)} aria-label="Zoom out">−</button>
        <button type="button" className="zoom-level" onClick={() => changeZoom(farm.code === "F70" ? 1.15 : 1)} aria-label="Reset map zoom">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => changeZoom(zoom + .2)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}

export default function Home() {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmCode, setFarmCode] = useState("F70");
  const [selectedZone, setSelectedZone] = useState("F70-FRONT-01");
  const [groups, setGroups] = useState<Group[]>(FALLBACK_GROUPS);
  const [allocations, setAllocations] = useState<Allocation[]>(FALLBACK_ALLOCATIONS);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [view, setView] = useState<"overview" | "inventory" | "work" | "orders">("overview");
  const [inventoryFarmCodes, setInventoryFarmCodes] = useState<string[]>(["F70"]);
  const [modal, setModal] = useState<"inventory" | "edit-group" | "activity" | "status" | null>(null);
  const [search, setSearch] = useState("");
  const [speciesSearch, setSpeciesSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeGroup, setActiveGroup] = useState<number>(1);
  const [activeAllocation, setActiveAllocation] = useState<number | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ roads: true, operations: true, irrigation: true });
  const importInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoMissing, setPhotoMissing] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [confirmation, setConfirmation] = useState<ConfirmationAction | null>(null);

  const loadInventory = async () => {
    try {
      const response = await fetch("/api/inventory");
      if (!response.ok) throw new Error();
      const data = await response.json();
      setGroups(data.groups);
      setAllocations(data.allocations || []);
      setActivities(data.activities);
    } catch {
      setNotice("Prototype data is active; hosted records will sync when the database is available.");
    }
  };

  useEffect(() => {
    Promise.all([
      fetch("/farm-map.json").then((response) => response.json()),
      fetch("/hand-watered-farms.json").then((response) => response.json()),
    ]).then(([irrigated, handWatered]) => setFarms([...irrigated.farms, ...handWatered.farms]));
    fetch("/api/inventory")
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data) => {
        setGroups(data.groups);
        setAllocations(data.allocations || []);
        setActivities(data.activities);
      })
      .catch(() => setNotice("Prototype data is active; hosted records will sync when the database is available."));
  }, []);

  useEffect(() => {
    if (!confirmation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setConfirmation(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [confirmation, busy]);

  const farm = farms.find((item) => item.code === farmCode) || farms[0];
  const isHandWatered = farm?.wateringMethod === "Hand Watered";
  const zone = farm?.zones.find((item) => item.id === selectedZone) || farm?.zones[0];
  const inventoryScopeGroups = groups.filter((group) => inventoryFarmCodes.some((code) => zoneBelongsToFarm(group.zoneId, code)));
  const inventoryScopeTotal = inventoryScopeGroups.reduce((sum, group) => sum + group.quantity, 0);
  const soldOutGroups = inventoryScopeGroups.filter((group) => group.availableQuantity === 0);
  const lowStockGroups = inventoryScopeGroups.filter((group) => group.availableQuantity > 0 && group.availableQuantity <= LOW_STOCK_THRESHOLD);
  const filteredGroups = groups.filter((group) =>
    (view === "overview"
      ? group.zoneId === zone?.id
      : view === "inventory"
        ? inventoryFarmCodes.some((code) => zoneBelongsToFarm(group.zoneId, code))
        : true) &&
    `${group.zoneId} ${group.species} ${group.height} ${group.caliper}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredAllocations = allocations.filter((allocation) =>
    `${allocation.zoneId} ${allocation.species} ${allocation.height} ${allocation.caliper} ${allocation.client} ${allocation.orderNumber} ${allocation.markingMethod}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredActivities = activities.filter((activity) =>
    `${activity.activityDate} ${activity.activityType} ${activity.zoneId} ${activity.species || ""} ${activity.height || ""} ${activity.caliper || ""} ${activity.details} ${activity.performedBy}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const searchPlaceholder = view === "work"
    ? "Search activity, tree, zone, notes, or crew…"
    : view === "orders"
      ? "Search client, order, tree, or zone…"
      : "Search tree ID, species, size, or zone…";
  const farmGroups = groups.filter((group) => zoneBelongsToFarm(group.zoneId, farmCode));
  const totalTrees = farmGroups.reduce((sum, group) => sum + group.quantity, 0);
  const available = farmGroups.reduce((sum, group) => sum + group.availableQuantity, 0);
  const tagged = farmGroups.reduce((sum, group) => sum + group.taggedQuantity, 0);
  const sold = farmGroups.reduce((sum, group) => sum + group.soldQuantity, 0);
  const inventoryValue = farmGroups.reduce((sum, group) => sum + group.quantity * group.priceCents, 0);
  const pumps = useMemo(() => [...new Set(farm?.zones.map((z) => z.pump) || [])], [farm]);
  const inventoryScopeLabel = inventoryFarmCodes.length === farms.length
    ? "All farms"
    : inventoryFarmCodes.length === 1
      ? farms.find((item) => item.code === inventoryFarmCodes[0])?.name || "1 farm"
      : `${inventoryFarmCodes.length} farms`;
  const speciesBreakdown = useMemo(() => {
    type SizeSummary = { height: string; caliper: string; minPriceCents: number; maxPriceCents: number; total: number; available: number; tagged: number; sold: number };
    type SpeciesSummary = { species: string; sizes: Map<string, SizeSummary> };
    const summary = new Map<string, SpeciesSummary>();
    const scopeCodes = view === "inventory" ? inventoryFarmCodes : [farmCode];
    groups.filter((group) => scopeCodes.some((code) => zoneBelongsToFarm(group.zoneId, code))).forEach((group) => {
      const speciesKey = group.species.trim().toLocaleLowerCase();
      const sizeKey = `${group.height.trim().toLocaleLowerCase()}|${group.caliper.trim().toLocaleLowerCase()}`;
      const species = summary.get(speciesKey) || { species: group.species.trim(), sizes: new Map<string, SizeSummary>() };
      const size = species.sizes.get(sizeKey) || { height: group.height.trim(), caliper: group.caliper.trim(), minPriceCents: group.priceCents, maxPriceCents: group.priceCents, total: 0, available: 0, tagged: 0, sold: 0 };
      size.minPriceCents = Math.min(size.minPriceCents, group.priceCents);
      size.maxPriceCents = Math.max(size.maxPriceCents, group.priceCents);
      size.total += group.quantity;
      size.available += group.availableQuantity;
      size.tagged += group.taggedQuantity;
      size.sold += group.soldQuantity;
      species.sizes.set(sizeKey, size);
      summary.set(speciesKey, species);
    });
    return [...summary.values()]
      .map((item) => {
        const sizes = [...item.sizes.values()].sort((a, b) => `${a.height} ${a.caliper}`.localeCompare(`${b.height} ${b.caliper}`, undefined, { numeric: true }));
        return {
          species: item.species,
          sizes,
          total: sizes.reduce((sum, size) => sum + size.total, 0),
          available: sizes.reduce((sum, size) => sum + size.available, 0),
          tagged: sizes.reduce((sum, size) => sum + size.tagged, 0),
          sold: sizes.reduce((sum, size) => sum + size.sold, 0),
        };
      })
      .sort((a, b) => a.species.localeCompare(b.species));
  }, [groups, farmCode, inventoryFarmCodes, view]);
  const speciesSizeGroupCount = speciesBreakdown.reduce((sum, item) => sum + item.sizes.length, 0);
  const filteredSpeciesBreakdown = speciesBreakdown.filter((item) =>
    item.species.toLocaleLowerCase().includes(speciesSearch.trim().toLocaleLowerCase())
  );
  const selectedGroup = groups.find((group) => group.id === activeGroup);
  const selectedAllocation = allocations.find((allocation) => allocation.id === activeAllocation);
  const selectedGroupCommitted = (selectedGroup?.taggedQuantity || 0) + (selectedGroup?.soldQuantity || 0);

  function changeFarm(code: string) {
    setFarmCode(code);
    const next = farms.find((item) => item.code === code);
    if (next?.zones[0]) setSelectedZone(next.zones[0].id);
  }

  function toggleInventoryFarm(code: string) {
    setInventoryFarmCodes((current) => {
      if (current.includes(code)) return current.length === 1 ? current : current.filter((item) => item !== code);
      return [...current, code];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries(form.entries());
    if (modal === "inventory" || modal === "edit-group" || modal === "status") payload.quantity = Number(payload.quantity);
    if (modal === "inventory" || modal === "edit-group") {
      payload.priceCents = Math.round(Number(payload.price) * 100);
      delete payload.price;
    }
    if (modal === "edit-group" || modal === "activity" || modal === "status") payload.groupId = Number(payload.groupId);
    if (modal === "status" && payload.allocationId) payload.allocationId = Number(payload.allocationId);
    try {
      const response = await fetch("/api/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error((await response.json()).error);
      await loadInventory();
      setNotice(modal === "inventory" ? "Tree group added to inventory." : modal === "edit-group" ? "Inventory group updated." : modal === "activity" ? "Milestone recorded." : "Client allocation saved.");
      setModal(null);
      setActiveAllocation(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save the change.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDestructiveAction() {
    if (!confirmation) return;
    const action = confirmation;
    setBusy(true);
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action.kind === "receive"
          ? { action: "receive-allocation", allocationId: action.allocation.id }
          : { action: "delete-group", groupId: action.group.id, confirmGroupId: action.group.id }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      await loadInventory();
      setNotice(action.kind === "receive"
        ? `${action.allocation.quantity} ${action.allocation.species} trees were marked received and removed from on-property inventory.`
        : `${action.group.quantity} ${action.group.species} trees and their group record were deleted.`);
      setConfirmation(null);
      setModal(null);
      setActiveAllocation(null);
    } catch (error) {
      setNotice(error instanceof Error
        ? error.message
        : action.kind === "receive"
          ? "Unable to complete the delivery."
          : "Unable to delete the inventory group.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(groupId: number, file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("groupId", String(groupId));
      form.append("file", file);
      const response = await fetch("/api/inventory/photo", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setPhotoMissing(false);
      setPhotoVersion((v) => v + 1);
      setNotice("Photo updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to upload the photo.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(groupId: number) {
    setBusy(true);
    try {
      const response = await fetch(`/api/inventory/photo?groupId=${groupId}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error);
      setPhotoMissing(true);
      setPhotoVersion((v) => v + 1);
      setNotice("Photo removed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to remove the photo.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10);
    if (view === "inventory") {
      const rows = filteredGroups.map((group) => ({
        zoneId: group.zoneId,
        species: group.species,
        height: group.height,
        caliper: group.caliper,
        quantity: group.quantity,
        priceEach: (group.priceCents / 100).toFixed(2),
        available: group.availableQuantity,
        tagged: group.taggedQuantity,
        sold: group.soldQuantity,
        plantedOn: group.plantedOn,
      }));
      downloadCsv(`inventory-${today}.csv`, toCsv(rows, [
        { key: "zoneId", label: "Zone" }, { key: "species", label: "Species" }, { key: "height", label: "Height" },
        { key: "caliper", label: "Caliper" }, { key: "quantity", label: "Quantity" }, { key: "priceEach", label: "Price Each" },
        { key: "available", label: "Available" }, { key: "tagged", label: "Tagged" }, { key: "sold", label: "Sold" },
        { key: "plantedOn", label: "Planted On" },
      ]));
    } else if (view === "orders") {
      const rows = filteredAllocations.map((allocation) => ({
        id: allocation.id,
        zoneId: allocation.zoneId,
        species: allocation.species,
        height: allocation.height,
        caliper: allocation.caliper,
        quantity: allocation.quantity,
        priceEach: (allocation.priceCents / 100).toFixed(2),
        status: allocation.status,
        client: allocation.client,
        orderNumber: allocation.orderNumber,
        markingMethod: allocation.markingMethod,
        createdAt: allocation.createdAt,
      }));
      downloadCsv(`orders-${today}.csv`, toCsv(rows, [
        { key: "id", label: "Allocation ID" }, { key: "zoneId", label: "Zone" }, { key: "species", label: "Species" },
        { key: "height", label: "Height" }, { key: "caliper", label: "Caliper" }, { key: "quantity", label: "Quantity" },
        { key: "priceEach", label: "Price Each" }, { key: "status", label: "Status" }, { key: "client", label: "Client" },
        { key: "orderNumber", label: "Order Number" }, { key: "markingMethod", label: "Marked With" }, { key: "createdAt", label: "Created At" },
      ]));
    } else if (view === "work") {
      const rows = filteredActivities.map((activity) => ({
        id: activity.id,
        activityDate: activity.activityDate,
        activityType: activity.activityType,
        zoneId: activity.zoneId,
        species: activity.species ?? "",
        height: activity.height ?? "",
        caliper: activity.caliper ?? "",
        details: activity.details,
        performedBy: activity.performedBy,
      }));
      downloadCsv(`work-log-${today}.csv`, toCsv(rows, [
        { key: "id", label: "ID" }, { key: "activityDate", label: "Date" }, { key: "activityType", label: "Activity" },
        { key: "zoneId", label: "Zone" }, { key: "species", label: "Species" }, { key: "height", label: "Height" },
        { key: "caliper", label: "Caliper" }, { key: "details", label: "Details" }, { key: "performedBy", label: "Performed By" },
      ]));
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const table = parseCsv(await file.text());
    if (table.length < 2) {
      setNotice("The CSV file has no data rows.");
      return;
    }
    const header = table[0].map((cell) => cell.trim().toLowerCase());
    const columnIndex = (name: string) => header.indexOf(name);
    const columns = {
      zoneId: columnIndex("zone"), species: columnIndex("species"), height: columnIndex("height"),
      caliper: columnIndex("caliper"), quantity: columnIndex("quantity"), price: columnIndex("price each"),
      plantedOn: columnIndex("planted on"),
    };
    if (Object.values(columns).some((index) => index === -1)) {
      setNotice("CSV must include Zone, Species, Height, Caliper, Quantity, Price Each, and Planted On columns.");
      return;
    }
    const rows = table.slice(1).map((cells) => ({
      zoneId: cells[columns.zoneId]?.trim(),
      species: cells[columns.species]?.trim(),
      height: cells[columns.height]?.trim(),
      caliper: cells[columns.caliper]?.trim(),
      quantity: Number(cells[columns.quantity]),
      priceCents: Math.round(Number(cells[columns.price]) * 100),
      plantedOn: cells[columns.plantedOn]?.trim(),
    }));
    setBusy(true);
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bulk-add-groups", rows }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await loadInventory();
      const parts = [`${result.created} new group${result.created === 1 ? "" : "s"} added`];
      if (result.merged) parts.push(`${result.merged} merged into existing groups`);
      if (result.errors.length) parts.push(`${result.errors.length} row${result.errors.length === 1 ? "" : "s"} failed (row ${result.errors[0].row}: ${result.errors[0].error})`);
      setNotice(`Import finished: ${parts.join(", ")}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to import the CSV file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark">JT</div>
        <div><p className="eyebrow">JD Thornton Nurseries</p><h1>Field Ledger</h1></div>
        <nav aria-label="Primary navigation">
          {([["overview", "Farm map"], ["inventory", "Inventory"], ["work", "Work log"], ["orders", "Clients & orders"]] as const).map(([id, label]) =>
            <button key={id} className={view === id ? "active" : ""} onClick={() => {
              if (id === "inventory" && view !== "inventory") setInventoryFarmCodes([farmCode]);
              setView(id);
            }}>{label}</button>
          )}
        </nav>
        <div className="header-actions"><button className="icon-button" aria-label="Notifications">3</button><div className="avatar">JD</div></div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="side-heading"><span>Farms</span><span className="muted">{farms.length || 4} locations</span></div>
          <div className="farm-list">
            {farms.length ? farms.map((item) => (
              <button key={item.code} className={farmCode === item.code ? "farm-button selected" : "farm-button"} onClick={() => changeFarm(item.code)}>
                <span className="farm-icon">{item.name.split(" ")[0]}</span>
                <span><strong>{item.name}</strong><small>{item.zones.length} zones · {item.wateringMethod || `${item.pumps.length} pumps`}</small></span>
              </button>
            )) : <Skeleton count={4} height={54} />}
          </div>
          <div className="side-heading pump-heading"><span>{isHandWatered ? "Watering" : "Irrigation"}</span></div>
          {pumps.map((pump) => <div className="pump-row" key={pump}><span className="pump-dot" /><span>{pump}{pump === "Hand Watered" ? "" : " Pump"}</span><b>{farm?.zones.filter((z) => z.pump === pump).length}</b></div>)}
          <div className="sync-card"><span className="sync-icon">↻</span><div><strong>Detailed map linked</strong><small>{farm ? isHandWatered ? `${farm.zones.length} hand-watered zones` : `${farm.roads.length} roads · ${farm.features.length} sites · ${farm.infrastructure.length} irrigation features` : "Loading farm layers"}</small></div></div>
        </aside>

        <div className="content">
          <div className="title-row">
            <div><p className="breadcrumb">FARMS / {farm?.name.toUpperCase() || "LOADING"}</p><h2>{view === "overview" ? farm?.name : view === "inventory" ? "Tree Inventory" : view === "work" ? "Work & Milestones" : "Clients & Orders"}</h2><p>{view === "overview" ? isHandWatered ? "Hand-watered growing zones and live inventory" : "Irrigation map and live inventory by growing zone" : view === "inventory" ? "Grouped by species, height, and caliper" : view === "work" ? "Planting, pruning, fertilization, treatments, and maintenance" : "Reserved, sold, pickup, and delivery commitments"}</p></div>
            <div className="title-actions"><button className="secondary" onClick={() => setModal("activity")}>Record work</button><button className="primary" onClick={() => setModal("inventory")}>+ Add trees</button></div>
          </div>

          <div className="metrics">
            <article><span>Total trees</span><strong>{totalTrees.toLocaleString()}</strong><small>Across {farmGroups.length} groups at {farm?.name || "this farm"}</small></article>
            <article><span>Available</span><strong>{available.toLocaleString()}</strong><small>{totalTrees ? Math.round(available / totalTrees * 100) : 0}% ready for allocation</small></article>
            <article><span>Tagged</span><strong>{tagged.toLocaleString()}</strong><small>Marked for clients</small></article>
            <article><span>Sold</span><strong>{sold.toLocaleString()}</strong><small>Awaiting customer receipt</small></article>
            <article><span>Inventory value</span><strong>{formatMoney(inventoryValue)}</strong><small>{farm?.name || "Current farm"} · On-property value</small></article>
          </div>
          {view === "inventory" && (soldOutGroups.length > 0 || lowStockGroups.length > 0) && (
            <div className="stock-alerts">
              {soldOutGroups.length > 0 && (
                <div className="stock-alert sold-out">
                  <span className="stock-alert-icon">●</span>
                  <span><strong>{soldOutGroups.length} group{soldOutGroups.length === 1 ? "" : "s"} sold out</strong> — {soldOutGroups.map((group) => `${group.species} (${group.height}, ${group.zoneId})`).join(", ")}</span>
                </div>
              )}
              {lowStockGroups.length > 0 && (
                <div className="stock-alert low-stock">
                  <span className="stock-alert-icon">●</span>
                  <span><strong>{lowStockGroups.length} group{lowStockGroups.length === 1 ? "" : "s"} low on stock</strong> (≤{LOW_STOCK_THRESHOLD} available) — {lowStockGroups.map((group) => `${group.species} (${group.availableQuantity} left, ${group.zoneId})`).join(", ")}</span>
                </div>
              )}
            </div>
          )}
          {view === "inventory" && (
            <section className="species-breakdown" aria-label="Inventory totals by species and size">
              <header className="species-breakdown-head">
                <div><strong>Inventory by species &amp; size</strong><small>{inventoryScopeLabel} · {speciesBreakdown.length} species · {speciesSizeGroupCount} size groups</small></div>
                <label className="species-search">Find a species
                  <input
                    type="search"
                    value={speciesSearch}
                    onChange={(event) => setSpeciesSearch(event.target.value)}
                    placeholder="e.g. Live Oak"
                  />
                </label>
              </header>
              <div className="species-table-scroll">
                <div className="species-table">
                  <div className="species-summary-head"><span>Species</span><span>Sizes</span><span>Total</span><span>Available</span><span>Tagged</span><span>Sold</span></div>
                  <div className="species-list">
                    {filteredSpeciesBreakdown.map((item) => (
                      <details className="species-row" key={item.species}>
                        <summary>
                          <span className="species-name"><strong>{item.species}</strong><small>View size breakdown</small></span>
                          <span data-label="Sizes">{item.sizes.length}</span>
                          <b data-label="Total">{item.total.toLocaleString()}</b>
                          <span className="available" data-label="Available">{item.available.toLocaleString()}</span>
                          <span className="tagged" data-label="Tagged">{item.tagged.toLocaleString()}</span>
                          <span className="sold" data-label="Sold">{item.sold.toLocaleString()}</span>
                        </summary>
                        <div className="species-size-detail">
                          <div className="species-size-head"><span>Size</span><span>Price</span><span>Total</span><span>Available</span><span>Tagged</span><span>Sold</span></div>
                          {item.sizes.map((size) => (
                            <div className="species-size-row" key={`${item.species}-${size.height}-${size.caliper}`}>
                              <div><strong>{size.height}</strong><small>{size.caliper}</small></div>
                              <span className={`size-price ${size.minPriceCents === size.maxPriceCents ? priceClass(size.minPriceCents) : ""}`} data-label="Price">{size.minPriceCents === size.maxPriceCents ? formatPrice(size.minPriceCents) : `${formatMoney(size.minPriceCents)}–${formatMoney(size.maxPriceCents)}`}</span>
                              <b data-label="Total">{size.total.toLocaleString()}</b>
                              <span className="available" data-label="Available">{size.available.toLocaleString()}</span>
                              <span className="tagged" data-label="Tagged">{size.tagged.toLocaleString()}</span>
                              <span className="sold" data-label="Sold">{size.sold.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                    {!filteredSpeciesBreakdown.length && <div className="species-empty">{speciesBreakdown.length ? `No species match “${speciesSearch}”.` : "No inventory in the selected farm scope."}</div>}
                  </div>
                </div>
              </div>
            </section>
          )}

          {view === "overview" && farm && zone && (
            <div className="overview-grid">
              <section className="map-card">
                <div className="card-head"><div><span className="live-dot" />LIVE FARM MAP</div><div className="legend"><span><i className="legend-zone" />Zone</span>{!isHandWatered && <><span><i className="legend-pump" />Pump</span><span><i className="legend-road" />Road</span><span><i className="legend-line" />Irrigation</span></>}</div></div>
                {!isHandWatered && <div className="layer-controls" aria-label="Map layers">
                  {([["roads", "Roads"], ["operations", "Operations"], ["irrigation", "Irrigation detail"]] as const).map(([key, label]) =>
                    <button key={key} className={layers[key] ? "enabled" : ""} onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}><span />{label}</button>
                  )}
                </div>}
                <FarmCanvas key={farm.code} farm={farm} selectedZone={zone.id} layers={layers} onSelect={(next) => setSelectedZone(next.id)} />
                <div className="map-footer"><span>Click a zone to inspect its trees</span><strong>{zone.id}</strong></div>
              </section>
              <section className="zone-panel">
                <div className="zone-label">SELECTED ZONE</div>
                <h3>{zone.name}</h3>
                <p>{zone.pump}{zone.pump === "Hand Watered" ? "" : " Pump"} · {zone.id}</p>
                <label className="zone-jump">Jump to any mapped zone
                  <select value={zone.id} onChange={(event) => setSelectedZone(event.target.value)}>
                    {pumps.map((pump) => <optgroup key={pump} label={pump === "Hand Watered" ? pump : `${pump} Pump`}>
                      {farm.zones.filter((item) => item.pump === pump).sort((a, b) => a.zoneNumber - b.zoneNumber).map((item) =>
                        <option key={item.id} value={item.id}>{item.name} · {item.id}</option>
                      )}
                    </optgroup>)}
                  </select>
                </label>
                <div className="zone-total"><span>Current inventory</span><strong>{filteredGroups.reduce((s, g) => s + g.quantity, 0)}</strong><small>trees in {filteredGroups.length} groups</small></div>
                <div className="zone-list">
                  {filteredGroups.length ? filteredGroups.map((group) => (
                    <button key={group.id} onClick={() => { setActiveGroup(group.id); setActiveAllocation(null); setModal("status"); }}>
                      <span className={`status-dot ${group.soldQuantity ? "sold" : group.taggedQuantity ? "tagged" : "available"}`} />
                      <span><strong>{group.species}</strong><small>{group.height} · {group.caliper} · <span className={priceClass(group.priceCents)}>{formatPrice(group.priceCents)}</span>{group.priceCents > 0 ? " each" : ""}</small><small className="quantity-split">A {group.availableQuantity} · T {group.taggedQuantity} · S {group.soldQuantity}</small></span>
                      <b>{group.quantity}</b>
                    </button>
                  )) : <div className="empty">No inventory recorded in this zone yet.</div>}
                </div>
                <button className="panel-action" onClick={() => setModal("inventory")}>Add inventory to {zone.name}</button>
              </section>
            </div>
          )}

          {view !== "overview" && (
            <section className="data-card">
              <div className="table-tools">
                <div className="search">
                  <span aria-hidden="true">⌕</span>
                  <input aria-label={`Search ${view}`} placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
                  {search && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch("")}>×</button>}
                </div>
                {view === "inventory" && <div className="status-key"><span className="available">● Available</span><span className="tagged">● Tagged</span><span className="sold">● Sold</span></div>}
                {view === "orders" && <div className="status-key"><span className="tagged">● Tagged</span><span className="sold">● Sold</span></div>}
                {view === "inventory" && <>
                  <input ref={importInputRef} type="file" accept=".csv,text/csv" onChange={importCsv} style={{ display: "none" }} />
                  <button type="button" className="secondary" disabled={busy} onClick={() => importInputRef.current?.click()}>Import CSV</button>
                </>}
                <button type="button" className="secondary" onClick={exportCsv}>Export CSV</button>
              </div>
              {view === "inventory" && (
                <div className="farm-filter" aria-label="Select farms included in inventory">
                  <div><strong>Inventory scope</strong><small>{inventoryScopeTotal.toLocaleString()} trees · {inventoryScopeLabel}</small></div>
                  <button
                    type="button"
                    className={inventoryFarmCodes.length === farms.length ? "active" : ""}
                    aria-pressed={inventoryFarmCodes.length === farms.length}
                    onClick={() => setInventoryFarmCodes(farms.map((item) => item.code))}
                  >All farms</button>
                  {farms.map((item) => (
                    <button
                      type="button"
                      key={item.code}
                      className={inventoryFarmCodes.includes(item.code) ? "active" : ""}
                      aria-pressed={inventoryFarmCodes.includes(item.code)}
                      onClick={() => toggleInventoryFarm(item.code)}
                    ><span className="filter-check">{inventoryFarmCodes.includes(item.code) ? "✓" : ""}</span>{item.name}</button>
                  ))}
                </div>
              )}
              {view === "work" ? (
                <div className="activity-list">
                  {filteredActivities.length ? filteredActivities.map((activity) => (
                    <article key={activity.id}><div className="date-block"><b>{new Date(`${activity.activityDate}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</b><strong>{activity.activityDate.slice(-2)}</strong></div><div><span className="activity-type">{activity.activityType}</span><h3>{activity.species || "Tree group"} · {activity.zoneId}</h3><p>{activity.details || "Field work completed."}</p><small>Recorded by {activity.performedBy || "Farm team"}</small></div></article>
                  )) : <div className="empty-state"><strong>{search ? "No work records match this search" : "No field work recorded yet"}</strong><span>{search ? `Try a different activity, tree, zone, note, or crew name.` : "Use “Record work” to add a milestone for any inventory group."}</span></div>}
                </div>
              ) : view === "orders" ? (
                <div className="table-wrap"><table className="record-table"><thead><tr><th>Allocation</th><th>Species / size</th><th>Qty</th><th>Price</th><th>Status</th><th>Client / order</th><th>Marked With</th><th /></tr></thead><tbody>
                  {filteredAllocations.map((allocation) => <tr key={allocation.id}>
                    <td data-label="Allocation"><strong>{allocation.zoneId}-{String(allocation.groupId).padStart(3, "0")}</strong><small>Allocation #{allocation.id}</small></td>
                    <td data-label="Species / size"><strong>{allocation.species}</strong><small>{allocation.height} · {allocation.caliper}</small></td>
                    <td className="qty" data-label="Quantity">{allocation.quantity}</td>
                    <td className="price-cell" data-label="Price"><strong className={priceClass(allocation.priceCents)}>{formatPrice(allocation.priceCents)}</strong>{allocation.priceCents > 0 && <small>{formatMoney(allocation.priceCents * allocation.quantity)} total</small>}</td>
                    <td data-label="Status"><span className={`badge ${allocation.status.toLowerCase()}`}>{allocation.status}</span></td>
                    <td data-label="Client / order"><strong>{allocation.client}</strong><small>{allocation.orderNumber || "No order assigned"}</small></td>
                    <td data-label="Marked With">{allocation.markingMethod || "Not specified"}</td>
                    <td data-label="Actions"><button className="more" aria-label={`Edit ${allocation.species} allocation`} onClick={() => { setActiveGroup(allocation.groupId); setActiveAllocation(allocation.id); setModal("status"); }}>•••</button></td>
                  </tr>)}
                  {!filteredAllocations.length && <tr><td className="table-empty-cell" colSpan={8}><div className="empty">No client allocations match this search.</div></td></tr>}
                </tbody></table></div>
              ) : (
                <div className="table-wrap"><table className="record-table"><thead><tr><th>Tree group ID</th><th>Species / size</th><th>Price</th><th>On property</th><th>Availability</th><th>Planted</th><th>Actions</th></tr></thead><tbody>
                  {filteredGroups.map((group) => <tr key={group.id}>
                    <td data-label="Tree group"><strong>{group.zoneId}-{String(group.id).padStart(3, "0")}</strong><small>{farms.find((item) => zoneBelongsToFarm(group.zoneId, item.code))?.name || group.zoneId} · {group.zoneId}</small></td>
                    <td data-label="Species / size"><strong>{group.species}</strong><small>{group.height} · {group.caliper}</small></td>
                    <td className="price-cell" data-label="Price"><strong className={priceClass(group.priceCents)}>{formatPrice(group.priceCents)}</strong>{group.priceCents > 0 && <small>per tree</small>}</td>
                    <td className="qty" data-label="On property">{group.quantity}</td>
                    <td data-label="Availability"><div className="inventory-split"><span className="available">A {group.availableQuantity}</span><span className="tagged">T {group.taggedQuantity}</span><span className="sold">S {group.soldQuantity}</span></div></td>
                    <td data-label="Planted">{/^\d{4}-\d{2}-\d{2}$/.test(group.plantedOn) ? new Date(`${group.plantedOn}T12:00:00`).toLocaleDateString() : "Not recorded"}</td>
                    <td data-label="Actions"><div className="record-actions"><button className="table-action" onClick={() => { setActiveGroup(group.id); setActiveAllocation(null); setPhotoMissing(false); setModal("edit-group"); }}>Edit</button><button className="table-action" onClick={() => { setActiveGroup(group.id); setActiveAllocation(null); setModal("status"); }}>Allocate</button></div></td>
                  </tr>)}
                </tbody></table></div>
              )}
            </section>
          )}
          {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
        </div>
      </section>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) { setModal(null); setActiveAllocation(null); } }}><div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head"><div><span>{modal === "inventory" ? "NEW INVENTORY GROUP" : modal === "edit-group" ? "EDIT INVENTORY GROUP" : modal === "activity" ? "FIELD ACTIVITY" : "CLIENT & ORDER"}</span><h3>{modal === "inventory" ? "Add trees to a zone" : modal === "edit-group" ? "Update trees and zone" : modal === "activity" ? "Record a milestone" : selectedAllocation ? "Edit client allocation" : "Allocate trees"}</h3></div><button onClick={() => { setModal(null); setActiveAllocation(null); }} aria-label="Close">×</button></div>
        <form onSubmit={submit}>
          {modal === "inventory" && <>
            <input type="hidden" name="action" value="add-group" />
            <label className="full">Farm / Watering / Zone<select name="zoneId" defaultValue={zone?.id}>{farms.flatMap((f) => f.zones).map((z) => <option key={z.id} value={z.id}>{z.id} · {z.name}</option>)}</select></label>
            <label className="full">Species<input name="species" required placeholder="e.g. Live Oak" /></label>
            <label>Height<input name="height" required placeholder="12–14 ft" /></label><label>Caliper<input name="caliper" required placeholder="3.5 in" /></label>
            <label>Quantity<input name="quantity" type="number" min="1" required placeholder="50" /></label><label>Price per tree<input name="price" type="number" min="0" step="0.01" required placeholder="0.00" /></label>
            <label className="full">Planting date<input name="plantedOn" type="date" required /></label>
            <input type="hidden" name="status" value="Available" />
          </>}
          {modal === "edit-group" && selectedGroup && <>
            <input type="hidden" name="action" value="update-group" />
            <input type="hidden" name="groupId" value={selectedGroup.id} />
            <label className="full">Farm / Watering / Zone<select name="zoneId" required defaultValue={selectedGroup.zoneId}>{farms.flatMap((f) => f.zones).map((z) => <option key={z.id} value={z.id}>{z.id} · {z.name}</option>)}</select></label>
            <label className="full">Species<input name="species" required maxLength={120} defaultValue={selectedGroup.species} /></label>
            <label>Height<input name="height" required maxLength={40} defaultValue={selectedGroup.height} /></label><label>Caliper<input name="caliper" required maxLength={40} defaultValue={selectedGroup.caliper} /></label>
            <label>Quantity<input name="quantity" type="number" min={selectedGroup.taggedQuantity + selectedGroup.soldQuantity || 1} required defaultValue={selectedGroup.quantity} /><small>Cannot be lower than {selectedGroup.taggedQuantity + selectedGroup.soldQuantity} tagged or sold.</small></label><label>Price per tree<input name="price" type="number" min="0" step="0.01" required defaultValue={(selectedGroup.priceCents / 100).toFixed(2)} /></label>
            <label>Planting date (optional)<input name="plantedOn" type="date" defaultValue={/^\d{4}-\d{2}-\d{2}$/.test(selectedGroup.plantedOn) ? selectedGroup.plantedOn : ""} /></label>
            <div className="photo-panel full">
              <div className="photo-preview">
                {photoMissing
                  ? <span className="photo-empty">No photo yet</span>
                  : <img
                      key={`${selectedGroup.id}-${photoVersion}`}
                      src={`/api/inventory/photo?groupId=${selectedGroup.id}&v=${photoVersion}`}
                      alt={`${selectedGroup.species} field photo`}
                      onError={() => setPhotoMissing(true)}
                    />}
              </div>
              <div className="photo-actions">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) uploadPhoto(selectedGroup.id, file);
                  }}
                />
                <button type="button" className="table-action" disabled={busy} onClick={() => photoInputRef.current?.click()}>{photoMissing ? "Add photo" : "Replace photo"}</button>
                {!photoMissing && <button type="button" className="table-action" disabled={busy} onClick={() => removePhoto(selectedGroup.id)}>Remove</button>}
              </div>
            </div>
            <div className="delete-group-panel full">
              {selectedGroupCommitted > 0
                ? <div><strong>Delete entire group</strong><span>{selectedGroupCommitted} tree{selectedGroupCommitted === 1 ? "" : "s"} in this group are tagged or sold. Resolve those allocations, or mark sold trees received, before deleting.</span></div>
                : <div><strong>Delete entire group</strong><span>Also removes its work history.</span></div>}
              <button type="button" className="danger" disabled={busy || selectedGroupCommitted > 0} onClick={() => setConfirmation({ kind: "delete", group: selectedGroup })}>Delete group</button>
            </div>
          </>}
          {modal === "activity" && <>
            <input type="hidden" name="action" value="add-activity" />
            <label className="full">Tree group<select name="groupId" defaultValue={activeGroup} onChange={(e) => setActiveGroup(Number(e.target.value))}>{groups.map((g) => <option key={g.id} value={g.id}>{g.zoneId}-{String(g.id).padStart(3, "0")} · {g.species}</option>)}</select></label>
            <input type="hidden" name="zoneId" value={groups.find((g) => g.id === activeGroup)?.zoneId || zone?.id} />
            <label>Activity<select name="activityType"><option>Root pruning</option><option>Fertilization</option><option>Treatment</option><option>Maintenance</option><option>Planting</option></select></label>
            <label>Date<input name="activityDate" type="date" required /></label>
            <label className="full">Work details<textarea name="details" placeholder="Materials, rate, observations, next steps…" /></label>
            <label className="full">Performed by<input name="performedBy" placeholder="Crew or team member" /></label>
          </>}
          {modal === "status" && <>
            <input type="hidden" name="action" value={selectedAllocation ? "update-allocation" : "add-allocation"} />
            <input type="hidden" name="groupId" value={activeGroup} />
            {selectedAllocation && <input type="hidden" name="allocationId" value={selectedAllocation.id} />}
            <div className="selected-record full">
              <span>{selectedGroup?.zoneId}-{String(activeGroup).padStart(3, "0")}</span>
              <strong>{selectedGroup?.species}</strong>
              <small>{selectedGroup?.height} · {selectedGroup?.caliper} · <span className={priceClass(selectedGroup?.priceCents || 0)}>{formatPrice(selectedGroup?.priceCents || 0)}</span>{(selectedGroup?.priceCents || 0) > 0 ? " each" : ""} · {selectedGroup?.availableQuantity || 0} currently available</small>
            </div>
            <label>Availability status<select name="status" defaultValue={selectedAllocation?.status || "Tagged"}><option>Tagged</option><option>Sold</option></select></label>
            <label>Quantity<input name="quantity" type="number" min="1" max={(selectedGroup?.availableQuantity || 0) + (selectedAllocation?.quantity || 0)} required defaultValue={selectedAllocation?.quantity || 1} /></label>
            <label className="full">Client<input name="client" required defaultValue={selectedAllocation?.client || ""} placeholder="Client or project name" /></label>
            <label>Sales order<input name="orderNumber" defaultValue={selectedAllocation?.orderNumber || ""} placeholder="SO-0000" /></label>
            <label>Marked With<input name="markingMethod" defaultValue={selectedAllocation?.markingMethod || ""} placeholder="Orange tape around the trunk" /></label>
            {selectedAllocation?.status === "Sold" && <div className="receive-panel full"><span>Remove these trees after delivery or pickup is complete.</span><button type="button" className="danger" disabled={busy} onClick={() => setConfirmation({ kind: "receive", allocation: selectedAllocation })}>Received by Customer</button></div>}
          </>}
          <div className="form-actions full"><button type="button" className="secondary" onClick={() => { setModal(null); setActiveAllocation(null); }}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save record"}</button></div>
        </form>
      </div></div>}

      {confirmation && (
        <div
          className="confirmation-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setConfirmation(null);
          }}
        >
          <section
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            aria-describedby="confirmation-warning"
          >
            <header>
              <span>{confirmation.kind === "receive" ? "CONFIRM CUSTOMER RECEIPT" : "DELETE INVENTORY GROUP"}</span>
              <h3 id="confirmation-title">{confirmation.kind === "receive" ? "Remove these trees from the property?" : "Permanently delete this tree group?"}</h3>
            </header>
            {confirmation.kind === "receive" ? (
              <div className="confirmation-context">
                <strong>{confirmation.allocation.quantity} {confirmation.allocation.species}</strong>
                <small>{confirmation.allocation.height} · {confirmation.allocation.caliper} · {confirmation.allocation.zoneId}</small>
                <dl>
                  <div><dt>Customer</dt><dd>{confirmation.allocation.client}</dd></div>
                  <div><dt>Order</dt><dd>{confirmation.allocation.orderNumber || "No order assigned"}</dd></div>
                  <div><dt>Inventory removed</dt><dd>{confirmation.allocation.quantity} trees</dd></div>
                </dl>
              </div>
            ) : (
              <div className="confirmation-context">
                <strong>{confirmation.group.quantity} {confirmation.group.species}</strong>
                <small>{confirmation.group.height} · {confirmation.group.caliper}</small>
                <dl>
                  <div><dt>Zone</dt><dd>{confirmation.group.zoneId}</dd></div>
                  <div><dt>Group ID</dt><dd>{confirmation.group.zoneId}-{String(confirmation.group.id).padStart(3, "0")}</dd></div>
                  <div><dt>Inventory removed</dt><dd>{confirmation.group.quantity} trees</dd></div>
                </dl>
              </div>
            )}
            <p className="confirmation-warning" id="confirmation-warning">
              {confirmation.kind === "receive"
                ? "This confirms delivery or pickup and permanently removes these sold trees from on-property inventory."
                : "This permanently removes the group, its photo, and its work history. This action cannot be undone."}
            </p>
            <div className="confirmation-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
              <button type="button" className="danger" disabled={busy} onClick={confirmDestructiveAction}>
                {busy ? "Working…" : confirmation.kind === "receive" ? "Confirm receipt" : "Delete group"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
