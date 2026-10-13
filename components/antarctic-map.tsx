/**
 * POLARIS Antarctic operations map — OpenLayers on EPSG:3031
 * (Antarctic Polar Stereographic).
 *
 * REAL geographic base: NASA GIBS WMS, Antarctic Polar Stereographic grid
 * (Blue Marble shaded relief + bathymetry; optional MODIS true-color mosaic).
 * Coastline, ice shelves and ocean are genuine imagery, not an illustration.
 *
 * SIMULATED demo data: NCPOR stations, camps, cargo, vehicles, personnel,
 * routes, hazards and SOS events — drawn at real geographic coordinates.
 */
import { useEffect, useRef, useState } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import { get as getProjection, fromLonLat } from "ol/proj";
import { register } from "ol/proj/proj4";
import proj4 from "proj4";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import ImageWMS from "ol/source/ImageWMS";
import { Vector as VectorSource } from "ol/source";
import { Feature } from "ol";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Circle from "ol/geom/Circle";
import Polygon from "ol/geom/Polygon";
import {
  Fill,
  Stroke,
  Style,
  Circle as CircleStyle,
  Text as TextStyle,
} from "ol/style";
import Overlay from "ol/Overlay";
import type { EventsKey } from "ol/events";
import {
  DragPan,
  MouseWheelZoom,
  defaults as defaultInteractions,
} from "ol/interaction";
import { ScaleLine } from "ol/control";
import { cn } from "@/lib/utils";
import type { MapAsset } from "@/lib/polar-data";
import { ROUTES, pointAlongRoute } from "@/lib/polar-data";

/* ------------------------------------------------------------------ */
/* Projection: EPSG:3031 Antarctic Polar Stereographic                 */
/* ------------------------------------------------------------------ */

proj4.defs(
  "EPSG:3031",
  "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
);
register(proj4);

const P3031 = getProjection("EPSG:3031");

/* ------------------------------------------------------------------ */
/* GIBS WMS source builders                                            */
/* ------------------------------------------------------------------ */

/** NASA GIBS WMS service, Antarctic Polar Stereographic endpoint. */
const GIBS_WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg3031/best/wms.cgi";

interface GibsLayerCfg {
  id: string;
  label: string;
  /** GIBS WMS layer identifier. */
  layer: string;
  attribution: string;
  /** Temporal layers accept a TIME value; static layers ignore it. */
  date?: string;
}

const GIBS_LAYERS: GibsLayerCfg[] = [
  {
    id: "modis-aqua",
    label: "MODIS Aqua True Color",
    layer: "MODIS_Aqua_CorrectedReflectance_TrueColor",
    attribution: "Imagery courtesy NASA EOSDIS GIBS — MODIS Aqua true color (EPSG:3031)",
    date: "2024-12-01",
  },
  {
    id: "modis-terra",
    label: "MODIS Terra True Color",
    layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
    attribution: "Imagery courtesy NASA EOSDIS GIBS — MODIS Terra true color (EPSG:3031)",
    date: "2024-12-01",
  },
  {
    id: "bluemarble",
    label: "Blue Marble Relief",
    layer: "BlueMarble_ShadedRelief_Bathymetry",
    attribution: "Imagery courtesy NASA EOSDIS GIBS — Blue Marble shaded relief & bathymetry",
  },
];

/** EPSG:3031 extent (meters) — full disc, center South Pole. */
const EXTENT_3031 = [-4_194_303, -4_194_303, 4_194_303, 4_194_303];

/** NASA GIBS WMS in EPSG:3031 — the map engine requests one real image per view. */
function makeGibsSource(cfg: GibsLayerCfg): ImageWMS {
  const params: Record<string, string> = {
    LAYERS: cfg.layer,
    FORMAT: "image/jpeg",
    VERSION: "1.3.0",
    STYLES: "",
  };
  if (cfg.date) params.TIME = cfg.date;

  return new ImageWMS({
    url: GIBS_WMS_URL,
    params,
    projection: P3031!,
    ratio: 1,
    crossOrigin: "anonymous",
    attributions: cfg.attribution,
    serverType: "mapserver",
  });
}

/* ------------------------------------------------------------------ */
/* Simulated operational geography (REAL coordinates)                  */
/* ------------------------------------------------------------------ */

interface OpPoint {
  id: string;
  label: string;
  kind: "station" | "camp";
  lat: number;
  lon: number;
  detail: string;
}

const OP_POINTS: OpPoint[] = [
  {
    id: "bharati",
    label: "Bharati",
    kind: "station",
    lat: -69.4067,
    lon: 76.1868,
    detail: "Larsemann Hills · research station",
  },
  {
    id: "maitri",
    label: "Maitri",
    kind: "station",
    lat: -70.7586,
    lon: 11.7286,
    detail: "Schirmacher Oasis · primary logistics hub",
  },
  {
    id: "dg-depot",
    label: "Dakshin Gangotri",
    kind: "station",
    lat: -70.7522,
    lon: 12.0,
    detail: "Ice-shelf depot · strategic reserve",
  },
  {
    id: "camp-suhrid",
    label: "Camp Suhrid",
    kind: "camp",
    lat: -71.1,
    lon: 14.8,
    detail: "Glaciology field camp",
  },
  {
    id: "camp-priya",
    label: "Camp Priyadarshini",
    kind: "camp",
    lat: -70.6,
    lon: 10.2,
    detail: "Lake-sediment coring team",
  },
  {
    id: "camp-larsemann",
    label: "Camp Larsemann N",
    kind: "camp",
    lat: -68.9,
    lon: 77.5,
    detail: "Atmospheric monitoring detachment",
  },
];

interface HazardZone {
  id: string;
  label: string;
  kind: string;
  lat: number;
  lon: number;
  radiusKm: number;
  color: string;
  dash?: boolean;
}

const HAZARD_ZONES: HazardZone[] = [
  {
    id: "hz-01",
    label: "Crevasse Field — Sector C",
    kind: "CREVASSE FIELD",
    lat: -71.45,
    lon: 13.2,
    radiusKm: 22,
    color: "#ef4444",
  },
  {
    id: "hz-02",
    label: "Blizzard system",
    kind: "BLIZZARD ZONE",
    lat: -69.0,
    lon: 5.0,
    radiusKm: 110,
    color: "#f97316",
  },
  {
    id: "hz-04",
    label: "ASPA 135 boundary",
    kind: "RESTRICTED AREA",
    lat: -69.15,
    lon: 77.0,
    radiusKm: 35,
    color: "#64748b",
    dash: true,
  },
];

interface WeatherCell {
  id: string;
  label: string;
  lat: number;
  lon: number;
  radiusKm: number;
  color: string;
}

const WEATHER_CELLS: WeatherCell[] = [
  {
    id: "wx-1",
    label: "Snow band",
    lat: -66.5,
    lon: 35,
    radiusKm: 300,
    color: "rgba(255,255,255,0.5)",
  },
  {
    id: "wx-2",
    label: "Katabatic wind corridor",
    lat: -71.8,
    lon: 24,
    radiusKm: 230,
    color: "rgba(34,211,238,0.45)",
  },
];

/* ------------------------------------------------------------------ */
/* Layer visibility model                                              */
/* ------------------------------------------------------------------ */

export interface MapLayers {
  stations: boolean;
  personnel: boolean;
  cargo: boolean;
  vehicles: boolean;
  routes: boolean;
  weather: boolean;
  hazards: boolean;
  emergency: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  stations: true,
  personnel: true,
  cargo: true,
  vehicles: true,
  routes: true,
  weather: true,
  hazards: true,
  emergency: true,
};

/* ------------------------------------------------------------------ */
/* Popup payload types                                                 */
/* ------------------------------------------------------------------ */

export type MapFilter =
  | "all"
  | "stations"
  | "people"
  | "cargo"
  | "vehicles"
  | "transport"
  | "hazards"
  | "emergency";

export interface SelectedInfo {
  kind: "station" | "camp" | "asset" | "hazard" | "weather" | "route" | "sos";
  id: string;
  label: string;
  lines: string[];
  lat: number;
  lon: number;
}

interface MapEvent {
  id: string;
  kind: "SOS" | "CONFLICT";
  lat: number;
  lon: number;
  title: string;
  detail: string;
  ts: string;
}

interface Props {
  layers?: Partial<MapLayers>;
  onLayersChange?: (layers: MapLayers) => void;
  focusStationId?: string | null;
  focusTarget?: { lat: number; lon: number; label: string; zoom?: number } | null;
  assets: MapAsset[];
  events?: MapEvent[];
  compactLayers?: boolean;
  filter?: MapFilter;
  onSelection?: (info: SelectedInfo | null) => void;
  className?: string;
  /**
   * Wheel zoom is on by default, which is correct for the Command Center.
   * On a scrolling marketing page it is a liability: hovering the hero map
   * would zoom the map and swallow the page scroll, so the landing hero
   * turns it off.
   */
  wheelZoom?: boolean;
}

const assetKindInFilter = (kind: MapAsset["kind"], filter: MapFilter): boolean => {
  if (filter === "all") return true;
  if (filter === "people") return kind === "person";
  if (filter === "cargo") return kind === "cargo";
  if (filter === "vehicles") return kind === "vehicle";
  if (filter === "transport") return kind === "ship" || kind === "aircraft" || kind === "helicopter";
  return false;
};

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const stationStyle = (sel: boolean) =>
  new Style({
    image: new CircleStyle({
      radius: sel ? 8 : 6,
      fill: new Fill({ color: "#0284c7" }),
      stroke: new Stroke({ color: "#ffffff", width: 3 }),
    }),
    text: new TextStyle({
      text: "",
      font: "600 10px ui-sans-serif, system-ui",
      offsetY: 16,
      fill: new Fill({ color: "#0f172a" }),
      stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 3 }),
    }),
  });

const campStyle = (sel: boolean) =>
  new Style({
    image: new CircleStyle({
      radius: sel ? 7 : 5,
      fill: new Fill({ color: "#f59e0b" }),
      stroke: new Stroke({ color: "#ffffff", width: 2.5 }),
    }),
  });

const assetStyle = (kind: MapAsset["kind"], sel: boolean) => {
  const color =
    kind === "ship"
      ? "#1d4ed8"
      : kind === "aircraft"
        ? "#0e7490"
        : kind === "helicopter"
          ? "#7c3aed"
          : kind === "person"
            ? "#0f766e"
            : "#334155";
  const glyph =
    kind === "ship" ? "⛴" : kind === "aircraft" ? "✈" : kind === "helicopter" ? "🚁" : kind === "person" ? "◇" : kind === "cargo" ? "▣" : "🛻";
  return new Style({
    image: new CircleStyle({
      radius: sel ? 11 : 9,
      fill: new Fill({ color: "rgba(255,255,255,0.95)" }),
      stroke: new Stroke({ color, width: 2.5 }),
    }),
    text: new TextStyle({
      text: glyph,
      font: "10px ui-sans-serif, system-ui",
      fill: new Fill({ color }),
      offsetY: 0.5,
    }),
  });
};

const hazardStyle = (h: HazardZone, sel: boolean) =>
  new Style({
    stroke: new Stroke({ color: h.color, width: sel ? 2.4 : 1.4, lineDash: h.dash ? [7, 5] : undefined }),
    fill: new Fill({ color: h.color.replace(")", ", 0.12)").replace("rgb", "rgba") }),
  });

const weatherStyle = (w: WeatherCell) =>
  new Style({
    stroke: new Stroke({ color: "rgba(255,255,255,0.65)", width: 1, lineDash: [2, 4] }),
    fill: new Fill({ color: w.color }),
  });

const routeStyle = (kind: string, planned: boolean) =>
  new Style({
    stroke: new Stroke({
      color: kind === "sea" ? "#2563eb" : kind === "air" ? "#0891b2" : "#0f766e",
      width: planned ? 1.8 : 2.4,
      lineDash: planned ? [7, 6] : undefined,
    }),
  });

const trailStyle = new Style({
  stroke: new Stroke({ color: "#f97316", width: 2.6, lineCap: "round" }),
});

const sosStyle = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: "rgba(255,255,255,0.95)" }),
    stroke: new Stroke({ color: "#dc2626", width: 3 }),
  }),
  text: new TextStyle({ text: "!", font: "bold 12px ui-sans-serif", fill: new Fill({ color: "#dc2626" }), offsetY: 0.5 }),
});

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AntarcticMap({
  layers: layerOverrides,
  onLayersChange,
  focusStationId,
  focusTarget,
  assets,
  events = [],
  compactLayers = false,
  wheelZoom = true,
  filter = "all",
  onSelection,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OLMap | null>(null);
  const popupHostRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<Overlay | null>(null);

  const [internalLayers, setInternalLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const layers = { ...internalLayers, ...layerOverrides };
  const setLayers = onLayersChange ?? setInternalLayers;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const focusTargetRef = useRef(focusTarget);
  focusTargetRef.current = focusTarget;
  const [baseId, setBaseId] = useState("modis-aqua");
  const [selected, setSelected] = useState<SelectedInfo | null>(null);
  const [ready, setReady] = useState(false);

  const baseLayerRef = useRef<ImageLayer<ImageWMS> | null>(null);
  const pointsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const assetsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const routesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const hazardsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const weatherLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const eventsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

  /* -------- create the OL map once -------- */
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    const map = new OLMap({
      target: hostRef.current,
      view: new View({
        projection: P3031!,
        center: fromLonLat([40, -75], P3031!), // Weddell–Queen Maud sector view
        zoom: 2,
        minZoom: 1,
        maxZoom: 9,
        extent: EXTENT_3031,
        constrainResolution: false,
      }),
      interactions: defaultInteractions({
        dragPan: true,
        mouseWheelZoom: wheelZoom,
        altShiftDragRotate: false,
        pinchRotate: false,
      }).extend([new DragPan(), ...(wheelZoom ? [new MouseWheelZoom()] : [])]),
      controls: [],
    });
    map.addControl(new ScaleLine({ units: "metric", text: true }));
    mapRef.current = map;

    // Fit the view to the Antarctic coastline (~66°S) so the continent and the
    // surrounding Southern Ocean fill the viewport on load.
    const fitPts: number[][] = [];
    for (let lon = 0; lon <= 360; lon += 5) fitPts.push(fromLonLat([lon, -66], P3031!));
    map.getView().fit(new Polygon([fitPts]), { padding: [30, 30, 30, 30] });

    // Popup overlay anchored to the map
    const popup = new Overlay({
      element: popupHostRef.current!,
      positioning: "top-center",
      offset: [0, -14],
      stopEvent: true,
    });
    map.addOverlay(popup);
    popupRef.current = popup;

    setReady(true);
    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  /* -------- basemap swap (NASA GIBS WMS · EPSG:3031) -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const cfg = GIBS_LAYERS.find((g) => g.id === baseId) ?? GIBS_LAYERS[0];
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current.dispose();
    }
    const layer = new ImageLayer<ImageWMS>({
      source: makeGibsSource(cfg),
      zIndex: 0,
    });
    baseLayerRef.current = layer;
    map.getLayers().insertAt(0, layer);
  }, [baseId, ready]);

  /* -------- click selection -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onClick = (evt: MapBrowserEvent) => {
      const hits: SelectedInfo[] = [];
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature): boolean => {
          const f = feature as Feature & { get: (k: string) => unknown };
          const info = f.get("polarisInfo") as SelectedInfo | undefined;
          if (info) hits.push(info);
          return hits.length > 0;
        },
        { hitTolerance: 6 },
      );
      const hit = hits.length > 0 ? hits[0] : null;
      if (hit) {
        setSelected(hit);
        popupRef.current?.setPosition(fromLonLat([hit.lon, hit.lat], P3031!));
        onSelectionRef.current?.(hit);
      } else {
        setSelected(null);
        popupRef.current?.setPosition(undefined);
        onSelectionRef.current?.(null);
      }
    };
    const key: EventsKey = map.on("singleclick", onClick);
    return () => {
      map.un("singleclick", onClick);
      void key;
    };
  }, [ready]);

  /* -------- keep view synced with map data -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (focusTarget) {
      map.getView().animate({
        center: fromLonLat([focusTarget.lon, focusTarget.lat], P3031!),
        zoom: focusTarget.zoom ?? 5,
        duration: 700,
      });
      return;
    }
    if (focusStationId) {
      const p = OP_POINTS.find((o) => o.id === focusStationId);
      if (p) map.getView().animate({ center: fromLonLat([p.lon, p.lat], P3031!), zoom: 5, duration: 700 });
    }
  }, [focusTarget, focusStationId, ready]);

  /* -------- stations & camps layer -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (pointsLayerRef.current) map.removeLayer(pointsLayerRef.current);

    const src = new VectorSource();
    for (const p of OP_POINTS) {
      const f = new Feature({ geometry: new Point(fromLonLat([p.lon, p.lat], P3031!)) });
      f.setStyle(p.kind === "station" ? stationStyle(false) : campStyle(false));
      f.set("polarisInfo", {
        kind: p.kind,
        id: p.id,
        label: p.label,
        lines: [p.detail, "Coordinates: real geography", "Status: SIMULATED demo data"],
        lat: p.lat,
        lon: p.lon,
      } satisfies SelectedInfo);
      src.addFeature(f);
    }
    const layer = new VectorLayer({
      source: src,
      zIndex: 20,
      visible: layers.stations && (filter === "all" || filter === "stations" || filter === "emergency"),
    });
    pointsLayerRef.current = layer;
    map.addLayer(layer);
  }, [ready, layers.stations, filter]);

  /* -------- assets layer (rebuilds on telemetry tick) -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (assetsLayerRef.current) map.removeLayer(assetsLayerRef.current);

    const src = new VectorSource();
    for (const a of assets) {
      if (a.kind === "person" && !layers.personnel) continue;
      if (a.kind === "cargo" && !layers.cargo) continue;
      if (
        (a.kind === "vehicle" || a.kind === "ship" || a.kind === "aircraft" || a.kind === "helicopter") &&
        !layers.vehicles
      )
        continue;
      if (!assetKindInFilter(a.kind, filter)) continue;
      const f = new Feature({ geometry: new Point(fromLonLat([a.lon, a.lat], P3031!)) });
      f.setStyle(assetStyle(a.kind, false));
      f.set("polarisInfo", {
        kind: "asset" as const,
        id: a.id,
        label: a.label,
        lines: [a.detail, "Position: SIMULATED telemetry"],
        lat: a.lat,
        lon: a.lon,
      } satisfies SelectedInfo);
      src.addFeature(f);
    }
    const layer = new VectorLayer({ source: src, zIndex: 30, visible: layers.personnel || layers.cargo || layers.vehicles });
    assetsLayerRef.current = layer;
    map.addLayer(layer);
  }, [assets, ready, layers.personnel, layers.cargo, layers.vehicles, filter]);

  /* -------- routes + trails -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (routesLayerRef.current) map.removeLayer(routesLayerRef.current);

    const src = new VectorSource();
    for (const r of ROUTES) {
      const coords = r.waypoints.map(([lon, lat]) => fromLonLat([lon, lat], P3031!));
      const f = new Feature({ geometry: new LineString(coords) });
      f.setStyle(routeStyle(r.kind, r.status === "planned"));
      f.set("polarisInfo", {
        kind: "route",
        id: r.id,
        label: r.label,
        lines: [
          `${r.status === "active" ? "Active" : "Planned"} ${r.kind} route`,
          "Alignment: SIMULATED over real geography",
        ],
        lat: r.waypoints[0][1],
        lon: r.waypoints[0][0],
      } satisfies SelectedInfo);
      src.addFeature(f);

      // movement trails
      if (r.status === "active") {
        for (const a of assets.filter((x) => x.routeId === r.id && x.progress !== undefined)) {
          const pts: [number, number][] = [];
          for (let i = 0; i <= 12; i++) {
            const t = Math.max(0, (a.progress ?? 0) - (i / 12) * 0.16);
            const pos = pointAlongRoute(r.id, t);
            pts.push([pos.lat, pos.lon]);
          }
          const trail = new Feature({
            geometry: new LineString(
              pts.map(([lat, lon]) => fromLonLat([lon, lat], P3031!)),
            ),
          });
          trail.setStyle(trailStyle);
          trail.set("polarisInfo", {
            kind: "asset",
            id: `${a.id}-trail`,
            label: `Active trail — ${a.label}`,
            lines: ["Recent path of a SIMULATED moving asset"],
            lat: pts[0][0],
            lon: pts[0][1],
          } satisfies SelectedInfo);
          src.addFeature(trail);
        }
      }
    }
    const layer = new VectorLayer({ source: src, zIndex: 15, visible: layers.routes });
    routesLayerRef.current = layer;
    map.addLayer(layer);
  }, [assets, ready, layers.routes]);

  /* -------- hazards -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (hazardsLayerRef.current) map.removeLayer(hazardsLayerRef.current);

    const src = new VectorSource();
    for (const h of HAZARD_ZONES) {
      const center = fromLonLat([h.lon, h.lat], P3031!);
      // meter radius: convert km with a cos-correction for stereographic planar space
      const radiusM = h.radiusKm * 1000;
      const f = new Feature({ geometry: new Circle(center, radiusM) });
      f.setStyle(hazardStyle(h, false));
      f.set("polarisInfo", {
        kind: "hazard",
        id: h.id,
        label: `${h.kind}`,
        lines: [h.label, "Zone: SIMULATED position", "Geography: real"],
        lat: h.lat,
        lon: h.lon,
      } satisfies SelectedInfo);
      src.addFeature(f);
    }
    const layer = new VectorLayer({
      source: src,
      zIndex: 10,
      visible: layers.hazards && (filter === "all" || filter === "hazards" || filter === "emergency"),
    });
    hazardsLayerRef.current = layer;
    map.addLayer(layer);
  }, [ready, layers.hazards, filter]);

  /* -------- weather cells -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (weatherLayerRef.current) map.removeLayer(weatherLayerRef.current);

    const src = new VectorSource();
    for (const w of WEATHER_CELLS) {
      const center = fromLonLat([w.lon, w.lat], P3031!);
      const f = new Feature({ geometry: new Circle(center, w.radiusKm * 1000) });
      f.setStyle(weatherStyle(w));
      f.set("polarisInfo", {
        kind: "weather",
        id: w.id,
        label: w.label,
        lines: ["Weather cell: SIMULATED overlay"],
        lat: w.lat,
        lon: w.lon,
      } satisfies SelectedInfo);
      src.addFeature(f);
    }
    const layer = new VectorLayer({ source: src, zIndex: 8, visible: layers.weather });
    weatherLayerRef.current = layer;
    map.addLayer(layer);
  }, [ready, layers.weather]);

  /* -------- SOS events -------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (eventsLayerRef.current) map.removeLayer(eventsLayerRef.current);

    const src = new VectorSource();
    for (const ev of events) {
      const f = new Feature({ geometry: new Point(fromLonLat([ev.lon, ev.lat], P3031!)) });
      f.setStyle(sosStyle);
      f.set("polarisInfo", {
        kind: "sos",
        id: ev.id,
        label: ev.kind === "SOS" ? "ACTIVE SOS" : "SYNC CONFLICT",
        lines: [ev.title, ev.detail, `Time ${ev.ts}`],
        lat: ev.lat,
        lon: ev.lon,
      } satisfies SelectedInfo);
      src.addFeature(f);
    }
    const layer = new VectorLayer({
      source: src,
      zIndex: 40,
      visible: layers.emergency && (filter === "all" || filter === "emergency"),
    });
    eventsLayerRef.current = layer;
    map.addLayer(layer);
  }, [events, ready, layers.emergency, filter]);

  /* -------- selection highlight -------- */
  useEffect(() => {
    if (!ready) return;
    // Only iterate the known vector layers — the GIBS WMS layer has no getFeatures().
    const vectorLayers = [
      pointsLayerRef.current,
      assetsLayerRef.current,
      routesLayerRef.current,
      hazardsLayerRef.current,
      weatherLayerRef.current,
      eventsLayerRef.current,
    ];
    for (const layer of vectorLayers) {
      if (!layer) continue;
      const src = layer.getSource();
      if (!src || typeof src.getFeatures !== "function") continue;
      for (const f of src.getFeatures()) {
        const info = (f as Feature & { get: (k: string) => unknown }).get("polarisInfo") as SelectedInfo | undefined;
        if (!info) continue;
        if (info.kind === "station") f.setStyle(stationStyle(selected?.id === info.id));
        else if (info.kind === "camp") f.setStyle(campStyle(selected?.id === info.id));
        else if (info.kind === "asset") {
          const a = assets.find((x) => x.id === info.id);
          f.setStyle(assetStyle(a?.kind ?? "vehicle", selected?.id === info.id));
        } else if (info.kind === "hazard") {
          const h = HAZARD_ZONES.find((x) => x.id === info.id);
          if (h) f.setStyle(hazardStyle(h, selected?.id === info.id));
        }
      }
    }
  }, [selected, ready, assets]);

  const activeBase = GIBS_LAYERS.find((g) => g.id === baseId)!;

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-[#a8cfe8]", className)}>
      {/* OpenLayers host */}
      <div ref={hostRef} className="absolute inset-0 z-0" />

      {/* -------- Popup (glass) — visibility managed by the OL Overlay -------- */}
      <div ref={popupHostRef} className="pointer-events-auto absolute z-[600]">
        {selected && (
          <div className="glass-strong w-60 rounded-2xl p-3.5 shadow-xl">
            <p className="text-[8.5px] font-extrabold tracking-widest text-sky-700 uppercase">{selected.kind}</p>
            <p className="mt-0.5 text-[13px] leading-tight font-extrabold text-slate-900">{selected.label}</p>
            <div className="mt-1.5 space-y-0.5">
              {selected.lines.map((l, i) => (
                <p key={i} className="text-[10px] leading-snug font-semibold text-slate-600">
                  {l}
                </p>
              ))}
            </div>
            <p className="mt-2 border-t border-white/60 pt-1.5 text-[8.5px] font-bold text-slate-400">
              {selected.lat.toFixed(4)}° S · {selected.lon.toFixed(4)}° E
            </p>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                popupRef.current?.setPosition(undefined);
              }}
              className="mt-1.5 w-full rounded-lg bg-sky-600 py-1 text-[10px] font-extrabold text-white hover:bg-sky-700"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* -------- Left controls: basemap, layers, legend, provenance -------- */}
      {!compactLayers && (
        <div className="absolute top-16 left-3 z-[500] hidden w-40 flex-col gap-2 md:flex">
          <div className="glass-strong rounded-xl px-2 py-2">
            <p className="mb-1 px-1 text-[8.5px] font-extrabold tracking-widest text-slate-500 uppercase">
              Base · GIBS EPSG:3031
            </p>
            <div className="flex flex-col gap-0.5">
              {GIBS_LAYERS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setBaseId(g.id)}
                  className={cn(
                    "rounded-lg px-2 py-1 text-left text-[10px] font-bold transition-colors",
                    baseId === g.id ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:bg-white/60",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="glass-strong rounded-xl px-2.5 py-2">
            <p className="mb-1 text-[8.5px] font-extrabold tracking-widest text-slate-500 uppercase">Layers</p>
            <div className="flex flex-col gap-0.5">
              {(Object.keys(DEFAULT_LAYERS) as (keyof MapLayers)[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLayers({ ...layers, [k]: !layers[k] })}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-0.5 text-left text-[10px] font-bold capitalize transition-colors",
                    layers[k] ? "bg-sky-600/90 text-white" : "text-slate-600 hover:bg-white/60",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", layers[k] ? "bg-white" : "bg-slate-300")} />
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div className="glass-strong rounded-xl p-2.5">
            <p className="mb-1.5 text-[8.5px] font-extrabold tracking-widest text-slate-500 uppercase">Legend</p>
            <LegendRow color="#0284c7" label="Station" />
            <LegendRow color="#f59e0b" label="Camp" />
            <LegendRow color="#ef4444" label="Crevasse / hazard" />
            <LegendRow color="#f97316" label="Active trail" />
            <div className="mt-1.5 space-y-0.5 border-t border-white/60 pt-1.5">
              <p className="flex items-center gap-1.5 text-[8.5px] font-bold text-slate-600">
                <span className="inline-block h-px w-5 border-t-2 border-dashed border-cyan-600" /> Planned route
              </p>
              <p className="flex items-center gap-1.5 text-[8.5px] font-bold text-slate-600">
                <span className="inline-block h-px w-5 border-t-2 border-blue-600" /> Active route
              </p>
            </div>
          </div>

          <div className="glass-strong rounded-xl px-2.5 py-1.5">
            <p className="text-[8px] leading-snug font-bold text-slate-500">
              <span className="text-emerald-700">REAL:</span> {activeBase.label} · NASA GIBS · Antarctic Polar Stereographic
              (EPSG:3031)
              <br />
              <span className="text-amber-600">SIMULATED:</span> stations, vehicles, routes, hazards, weather, SOS
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <p className="flex items-center gap-1.5 py-0.5 text-[9px] font-bold text-slate-600">
      <span className="inline-block h-2.5 w-2.5 rounded-full border border-white shadow-sm" style={{ background: color }} />
      {label}
    </p>
  );
}

export type { MapEvent };
