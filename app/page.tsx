"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
};

const FALLBACK_GROUPS: Group[] = [
  { id: 1, zoneId: "F70-FRONT-01", species: "Live Oak", height: "12–14 ft", caliper: "3.5 in", quantity: 86, availableQuantity: 86, taggedQuantity: 0, soldQuantity: 0, plantedOn: "2024-02-12" },
  { id: 2, zoneId: "F70-FRONT-01", species: "Bald Cypress", height: "10–12 ft", caliper: "3 in", quantity: 42, availableQuantity: 0, taggedQuantity: 42, soldQuantity: 0, plantedOn: "2023-11-06" },
  { id: 3, zoneId: "F70-NORTH-03", species: "Mahogany", height: "14–16 ft", caliper: "4 in", quantity: 28, availableQuantity: 0, taggedQuantity: 0, soldQuantity: 28, plantedOn: "2023-08-18" },
  { id: 4, zoneId: "F40-WEST-05", species: "Gumbo Limbo", height: "8–10 ft", caliper: "2.5 in", quantity: 115, availableQuantity: 115, taggedQuantity: 0, soldQuantity: 0, plantedOn: "2025-01-20" },
  { id: 5, zoneId: "F25-NORTH-02", species: "Royal Poinciana", height: "10–12 ft", caliper: "3 in", quantity: 64, availableQuantity: 64, taggedQuantity: 0, soldQuantity: 0, plantedOn: "2024-05-14" },
];
const FALLBACK_ALLOCATIONS: Allocation[] = [
  { id: 1, groupId: 2, zoneId: "F70-FRONT-01", species: "Bald Cypress", height: "10–12 ft", caliper: "3 in", quantity: 42, status: "Tagged", client: "Palm Beach Gardens", orderNumber: "SO-2408", markingMethod: "Ribbon tag", createdAt: "" },
  { id: 2, groupId: 3, zoneId: "F70-NORTH-03", species: "Mahogany", height: "14–16 ft", caliper: "4 in", quantity: 28, status: "Sold", client: "Evergreen Landscape", orderNumber: "SO-2391", markingMethod: "Metal tag", createdAt: "" },
];

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
  const [modal, setModal] = useState<"inventory" | "activity" | "status" | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeGroup, setActiveGroup] = useState<number>(1);
  const [activeAllocation, setActiveAllocation] = useState<number | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ roads: true, operations: true, irrigation: true });

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

  const farm = farms.find((item) => item.code === farmCode) || farms[0];
  const isHandWatered = farm?.wateringMethod === "Hand Watered";
  const zone = farm?.zones.find((item) => item.id === selectedZone) || farm?.zones[0];
  const inventoryScopeGroups = groups.filter((group) => inventoryFarmCodes.some((code) => group.zoneId.startsWith(code)));
  const inventoryScopeTotal = inventoryScopeGroups.reduce((sum, group) => sum + group.quantity, 0);
  const filteredGroups = groups.filter((group) =>
    (view === "overview"
      ? group.zoneId === zone?.id
      : view === "inventory"
        ? inventoryFarmCodes.some((code) => group.zoneId.startsWith(code))
        : true) &&
    `${group.zoneId} ${group.species} ${group.height} ${group.caliper}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredAllocations = allocations.filter((allocation) =>
    `${allocation.zoneId} ${allocation.species} ${allocation.height} ${allocation.caliper} ${allocation.client} ${allocation.orderNumber} ${allocation.markingMethod}`.toLowerCase().includes(search.toLowerCase())
  );
  const farmGroups = groups.filter((group) => group.zoneId.startsWith(farmCode));
  const totalTrees = farmGroups.reduce((sum, group) => sum + group.quantity, 0);
  const available = farmGroups.reduce((sum, group) => sum + group.availableQuantity, 0);
  const tagged = farmGroups.reduce((sum, group) => sum + group.taggedQuantity, 0);
  const sold = farmGroups.reduce((sum, group) => sum + group.soldQuantity, 0);
  const pumps = useMemo(() => [...new Set(farm?.zones.map((z) => z.pump) || [])], [farm]);
  const inventoryScopeLabel = inventoryFarmCodes.length === farms.length
    ? "All farms"
    : inventoryFarmCodes.length === 1
      ? farms.find((item) => item.code === inventoryFarmCodes[0])?.name || "1 farm"
      : `${inventoryFarmCodes.length} farms`;
  const speciesBreakdown = useMemo(() => {
    const summary = new Map<string, { species: string; height: string; caliper: string; total: number; available: number; tagged: number; sold: number }>();
    const scopeCodes = view === "inventory" ? inventoryFarmCodes : [farmCode];
    groups.filter((group) => scopeCodes.some((code) => group.zoneId.startsWith(code))).forEach((group) => {
      const key = `${group.species}|${group.height}|${group.caliper}`;
      const row = summary.get(key) || { species: group.species, height: group.height, caliper: group.caliper, total: 0, available: 0, tagged: 0, sold: 0 };
      row.total += group.quantity;
      row.available += group.availableQuantity;
      row.tagged += group.taggedQuantity;
      row.sold += group.soldQuantity;
      summary.set(key, row);
    });
    return [...summary.values()].sort((a, b) => `${a.species} ${a.height} ${a.caliper}`.localeCompare(`${b.species} ${b.height} ${b.caliper}`, undefined, { numeric: true }));
  }, [groups, farmCode, inventoryFarmCodes, view]);
  const selectedGroup = groups.find((group) => group.id === activeGroup);
  const selectedAllocation = allocations.find((allocation) => allocation.id === activeAllocation);

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
    if (modal === "inventory" || modal === "status") payload.quantity = Number(payload.quantity);
    if (modal === "activity" || modal === "status") payload.groupId = Number(payload.groupId);
    if (modal === "status" && payload.allocationId) payload.allocationId = Number(payload.allocationId);
    try {
      const response = await fetch("/api/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error((await response.json()).error);
      await loadInventory();
      setNotice(modal === "inventory" ? "Tree group added to inventory." : modal === "activity" ? "Milestone recorded." : "Client allocation saved.");
      setModal(null);
      setActiveAllocation(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save the change.");
    } finally {
      setBusy(false);
    }
  }

  async function receiveAllocation(allocation: Allocation) {
    const confirmed = window.confirm(
      `Are you sure ${allocation.quantity} ${allocation.species} trees were received by ${allocation.client}? This will permanently remove them from on-property inventory.`
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "receive-allocation", allocationId: allocation.id }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      await loadInventory();
      setNotice(`${allocation.quantity} ${allocation.species} trees were marked received and removed from on-property inventory.`);
      setModal(null);
      setActiveAllocation(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to complete the delivery.");
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
            <article><span>{farm?.name || "Current farm"}</span><strong>{totalTrees.toLocaleString()}</strong><small>{farm?.zones.length || 0} mapped {isHandWatered ? "hand-watered" : "irrigation"} zones</small></article>
          </div>
          <details className="species-breakdown" open>
            <summary><span>Inventory by species &amp; size</span><small>{view === "inventory" ? inventoryScopeLabel : farm?.name || "Current farm"} · {speciesBreakdown.length} species / size groups</small></summary>
            <div className="species-grid">
              {speciesBreakdown.map((item) => (
                <article key={`${item.species}-${item.height}-${item.caliper}`}>
                  <div><strong>{item.species}</strong><small>{item.height} · {item.caliper}</small></div>
                  <b>{item.total}</b>
                  <span className="available">A {item.available}</span>
                  <span className="tagged">T {item.tagged}</span>
                  <span className="sold">S {item.sold}</span>
                </article>
              ))}
            </div>
          </details>

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
                      <span><strong>{group.species}</strong><small>{group.height} · {group.caliper}</small><small className="quantity-split">A {group.availableQuantity} · T {group.taggedQuantity} · S {group.soldQuantity}</small></span>
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
                <div className="search"><span>⌕</span><input aria-label="Search records" placeholder="Search tree ID, species, client, or order…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                <div className="status-key"><span className="available">● Available</span><span className="tagged">● Tagged</span><span className="sold">● Sold</span></div>
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
                  {activities.length ? activities.map((activity) => {
                    const group = groups.find((g) => g.id === activity.groupId);
                    return <article key={activity.id}><div className="date-block"><b>{new Date(`${activity.activityDate}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</b><strong>{activity.activityDate.slice(-2)}</strong></div><div><span className="activity-type">{activity.activityType}</span><h3>{group?.species || "Tree group"} · {activity.zoneId}</h3><p>{activity.details || "Field work completed."}</p><small>Recorded by {activity.performedBy || "Farm team"}</small></div></article>;
                  }) : <div className="empty-state"><strong>No field work recorded yet</strong><span>Use “Record work” to add a milestone for any inventory group.</span></div>}
                </div>
              ) : view === "orders" ? (
                <div className="table-wrap"><table><thead><tr><th>Allocation</th><th>Species / size</th><th>Qty</th><th>Status</th><th>Client / order</th><th>Marked With</th><th /></tr></thead><tbody>
                  {filteredAllocations.map((allocation) => <tr key={allocation.id}>
                    <td><strong>{allocation.zoneId}-{String(allocation.groupId).padStart(3, "0")}</strong><small>Allocation #{allocation.id}</small></td>
                    <td><strong>{allocation.species}</strong><small>{allocation.height} · {allocation.caliper}</small></td>
                    <td className="qty">{allocation.quantity}</td>
                    <td><span className={`badge ${allocation.status.toLowerCase()}`}>{allocation.status}</span></td>
                    <td><strong>{allocation.client}</strong><small>{allocation.orderNumber || "No order assigned"}</small></td>
                    <td>{allocation.markingMethod || "Not specified"}</td>
                    <td><button className="more" aria-label={`Edit ${allocation.species} allocation`} onClick={() => { setActiveGroup(allocation.groupId); setActiveAllocation(allocation.id); setModal("status"); }}>•••</button></td>
                  </tr>)}
                  {!filteredAllocations.length && <tr><td colSpan={7}><div className="empty">No client allocations match this search.</div></td></tr>}
                </tbody></table></div>
              ) : (
                <div className="table-wrap"><table><thead><tr><th>Tree group ID</th><th>Species / size</th><th>On property</th><th>Availability</th><th>Planted</th><th /></tr></thead><tbody>
                  {filteredGroups.map((group) => <tr key={group.id}>
                    <td><strong>{group.zoneId}-{String(group.id).padStart(3, "0")}</strong><small>{farms.find((item) => group.zoneId.startsWith(item.code))?.name || group.zoneId} · {group.zoneId}</small></td>
                    <td><strong>{group.species}</strong><small>{group.height} · {group.caliper}</small></td>
                    <td className="qty">{group.quantity}</td>
                    <td><div className="inventory-split"><span className="available">A {group.availableQuantity}</span><span className="tagged">T {group.taggedQuantity}</span><span className="sold">S {group.soldQuantity}</span></div></td>
                    <td>{new Date(`${group.plantedOn}T12:00:00`).toLocaleDateString()}</td>
                    <td><button className="more" aria-label={`Allocate ${group.species}`} onClick={() => { setActiveGroup(group.id); setActiveAllocation(null); setModal("status"); }}>•••</button></td>
                  </tr>)}
                </tbody></table></div>
              )}
            </section>
          )}
          {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
        </div>
      </section>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) { setModal(null); setActiveAllocation(null); } }}><div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head"><div><span>{modal === "inventory" ? "NEW INVENTORY GROUP" : modal === "activity" ? "FIELD ACTIVITY" : "CLIENT & ORDER"}</span><h3>{modal === "inventory" ? "Add trees to a zone" : modal === "activity" ? "Record a milestone" : selectedAllocation ? "Edit client allocation" : "Allocate trees"}</h3></div><button onClick={() => { setModal(null); setActiveAllocation(null); }} aria-label="Close">×</button></div>
        <form onSubmit={submit}>
          {modal === "inventory" && <>
            <input type="hidden" name="action" value="add-group" />
            <label className="full">Farm / Watering / Zone<select name="zoneId" defaultValue={zone?.id}>{farms.flatMap((f) => f.zones).map((z) => <option key={z.id} value={z.id}>{z.id} · {z.name}</option>)}</select></label>
            <label className="full">Species<input name="species" required placeholder="e.g. Live Oak" /></label>
            <label>Height<input name="height" required placeholder="12–14 ft" /></label><label>Caliper<input name="caliper" required placeholder="3.5 in" /></label>
            <label>Quantity<input name="quantity" type="number" min="1" required placeholder="50" /></label><label>Planting date<input name="plantedOn" type="date" required /></label>
            <input type="hidden" name="status" value="Available" />
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
              <small>{selectedGroup?.height} · {selectedGroup?.caliper} · {selectedGroup?.availableQuantity || 0} currently available</small>
            </div>
            <label>Availability status<select name="status" defaultValue={selectedAllocation?.status || "Tagged"}><option>Tagged</option><option>Sold</option></select></label>
            <label>Quantity<input name="quantity" type="number" min="1" max={(selectedGroup?.availableQuantity || 0) + (selectedAllocation?.quantity || 0)} required defaultValue={selectedAllocation?.quantity || 1} /></label>
            <label className="full">Client<input name="client" required defaultValue={selectedAllocation?.client || ""} placeholder="Client or project name" /></label>
            <label>Sales order<input name="orderNumber" defaultValue={selectedAllocation?.orderNumber || ""} placeholder="SO-0000" /></label>
            <label>Marked With<input name="markingMethod" defaultValue={selectedAllocation?.markingMethod || ""} placeholder="Orange tape around the trunk" /></label>
            {selectedAllocation?.status === "Sold" && <div className="receive-panel full"><span>Remove these trees after delivery or pickup is complete.</span><button type="button" className="danger" disabled={busy} onClick={() => receiveAllocation(selectedAllocation)}>Received by Customer</button></div>}
          </>}
          <div className="form-actions full"><button type="button" className="secondary" onClick={() => { setModal(null); setActiveAllocation(null); }}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save record"}</button></div>
        </form>
      </div></div>}
    </main>
  );
}
