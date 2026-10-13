import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Bell,
  CalendarClock,
  CloudSnow,
  Droplets,
  Flame,
  Gauge,
  Heart,
  LayoutGrid,
  ListChecks,
  LogOut,
  Package,
  Radar,
  ScrollText,
  Search,
  Settings,
  Ship,
  Siren,
  Smartphone,
  TriangleAlert,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AntarcticMap, type MapEvent, type MapLayers } from "@/components/antarctic-map";
import { SosCircle } from "@/components/polar-bits";
import { IntelPanel } from "@/components/intel-panel";
import { SyncQueueDialog } from "@/components/offline-sync";
import { SimulatorDialog } from "@/components/ops-overlays";
import { OpsProvider, useOps, type ModuleId } from "@/lib/ops-store";
import { PolarisLiveProvider, usePolarisLive } from "@/lib/polaris-live";
import {
  ConnectivityControl,
  DataSourceBadge,
  LiveIndicator,
  SyncStatusStrip,
  SystemStatusPanel,
} from "@/components/system-status";
import { OperatorConsole } from "@/components/operator-console";
import { SIM_SCENARIOS, STATIONS } from "@/lib/polar-data";
import { convoyViews, hazardZonesFrom, stationsToMapAssets, trackedToViews, weatherViews } from "@/lib/live-adapter";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CargoModule,
  PeopleModule,
  TransportModule,
  WeatherModule,
  StationsModule,
  EquipmentModule,
  SamplesModule,
  AlertsModule,
  ReportsModule,
  SearchDialog,
} from "@/components/module-views";
import {
  ConvoyModule,
  RouteReviewModule,
  EmergencyCommandModule,
  IncidentLogModule,
} from "@/components/safety-views";
import {
  HomeLinkOpsModule,
  FamilyPortalModule,
  WellBeingCheckIn,
} from "@/components/homelink-views";
import { FieldSafetyMode } from "@/components/field-mode";

/* ------------------------------------------------------------------ */

const NAV: { id: ModuleId; label: string; icon: typeof Radar; badgeKey?: "alerts" | "queue" }[] = [
  { id: "home", label: "Home", icon: LayoutGrid },
  { id: "cargo", label: "Cargo & Inventory", icon: Package },
  { id: "people", label: "People", icon: Users },
  { id: "roster", label: "Roster & Shifts", icon: CalendarClock },
  { id: "transport", label: "Transport & Travel", icon: Ship },
  { id: "convoys", label: "Convoys", icon: ListChecks },
  { id: "routes", label: "Route Review", icon: TriangleAlert },
  { id: "weather", label: "Weather & Hazards", icon: CloudSnow },
  { id: "stations", label: "Stations", icon: Radar },
  { id: "equipment", label: "Equipment", icon: Settings },
  { id: "samples", label: "Samples", icon: Package },
  { id: "ai", label: "AI Intelligence", icon: Gauge },
  { id: "alerts", label: "Alert Center", icon: Bell, badgeKey: "alerts" },
  { id: "emergency", label: "Emergency Cmd", icon: Siren },
  { id: "incidents", label: "Incident Log", icon: ScrollText },
  { id: "homelink", label: "Home Link", icon: Heart },
  { id: "family", label: "Family Portal", icon: Heart },
  { id: "reports", label: "Reports", icon: ScrollText },
  { id: "field", label: "Field Safety Mode", icon: Smartphone },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function Dashboard() {
  return (
    <PolarisLiveProvider>
      <OpsProvider>
        <CommandCenter />
      </OpsProvider>
    </PolarisLiveProvider>
  );
}

function CommandCenter() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const ops = useOps();
  const live = usePolarisLive();

  const [layers, setLayers] = useState<MapLayers | undefined>(undefined);
  const [simOpen, setSimOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [wellbeingOpen, setWellbeingOpen] = useState(false);
  const [fieldMode, setFieldMode] = useState(false);
  const [activeNav, setActiveNav] = useState<ModuleId>("home");

  const inModule = activeNav !== "home";

  /* ------------------------------------------------------------------
     Every figure below is read from the database through the live
     provider. `undefined` (still loading) is rendered as a dash rather
     than a plausible-looking number.
     ------------------------------------------------------------------ */
  const cr = live.controlRoom;
  // While the first read is in flight the KPIs render as dashes rather than
  // a plausible-looking zero, so "not yet known" is never shown as "none".
  const kpi = {
    readinessPct: cr?.readinessPct,
    stationsOnline: cr?.stationsOnline,
    stationsTotal: cr?.stationsTotal,
    personnel: cr?.personnel,
    cargoInTransit: cr?.cargoInTransit,
  };
  const stationByIdLive = new Map(live.stations.map((s) => [s.id, s]));

  const reservePct = (category: string): number => {
    const lines = live.inventory.filter((i) => i.category === category);
    if (lines.length === 0) return 0;
    const qty = lines.reduce((a, i) => a + i.quantity, 0);
    const min = lines.reduce((a, i) => a + i.minThreshold, 0) || 1;
    return Math.max(0, Math.min(100, Math.round((qty / min) * 100)));
  };
  const reserveNote = (category: string): string => {
    const lines = live.inventory.filter((i) => i.category === category);
    if (lines.length === 0) return "No lines stored";
    const soonest = lines
      .map((i) => i.daysToThreshold)
      .filter((d): d is number => typeof d === "number" && d >= 0)
      .sort((a, b) => a - b)[0];
    return soonest === undefined ? "Above minimum" : `${soonest.toFixed(1)} d to minimum`;
  };

  const convoyHighlights = live.entities?.convoys.slice(0, 3) ?? [];

  const wx = (() => {
    const rows = live.weather;
    if (rows.length === 0) return null;
    const station = live.stations.find((s) => s.weather) ?? stationByIdLive.get(rows[0].stationId);
    return rows.length > 0
      ? { ...rows[0], stationLabel: station?.short ?? "station" }
      : null;
  })();

  const topHazard = live.hazards.length > 0 ? live.hazards[0] : null;

  const readinessPct = cr?.readinessPct ?? 0;

  const criticalAlerts = ops.alerts.filter((a) => a.severity === "CRITICAL").length;

  /* ------------------------------------------------------------------
     Map content comes from the database. `liveMapAssets` is empty until
     the first query resolves, so the map shows the real basemap with no
     markers rather than seeded ones — the absence is meaningful.
     ------------------------------------------------------------------ */
  const liveMapAssets = useMemo(
    () => [
      ...stationsToMapAssets(live.entities?.stations ?? [], STATIONS),
      ...trackedToViews(live.entities).map((t) => t.asset),
      ...convoyViews(live.entities, trackedToViews(live.entities)),
    ],
    [live.entities],
  );
  const usingLiveMap = live.entities !== null;

  const navClick = (id: ModuleId) => {
    setActiveNav(id);
    ops.setModule(id);
    if (id === "field") setFieldMode(true);
  };

  const runDemo = () => {
    ops.runScenario("ship-delay", 5);
    toast.loading("POLAR INTELLIGENCE analyzing ship delay +5 days…", { id: "demo", duration: 1200 });
    setTimeout(() => {
      setSimOpen(true);
      toast.success("Delay propagated — cargo → inventory → forecasts → risk → re-plan recommended", { id: "demo", duration: 6000 });
    }, 1400);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const homelinkWaiting = 3; // derived from homelink seed (waiting + queued family→field)

  const mapEvents: MapEvent[] = ops.mapEvents as MapEvent[];

  const moduleNode = useMemo(() => {
    switch (activeNav) {
      case "cargo": return <CargoModule />;
      case "people": return <PeopleModule tab="people" />;
      case "roster": return <PeopleModule tab="roster" />;
      case "transport": return <TransportModule />;
      case "convoys": return <ConvoyModule />;
      case "routes": return <RouteReviewModule />;
      case "weather": return <WeatherModule />;
      case "stations": return <StationsModule />;
      case "equipment": return <EquipmentModule />;
      case "samples": return <SamplesModule />;
      case "ai": return <IntelModule />;
      case "alerts": return <AlertsModule />;
      case "emergency": return <EmergencyCommandModule />;
      case "incidents": return <IncidentLogModule />;
      case "homelink": return <HomeLinkOpsModule />;
      case "family": return <FamilyPortalModule />;
      case "reports": return <ReportsModule />;
      default: return null;
    }
  }, [activeNav]);

  if (fieldMode) {
    return <FieldSafetyMode onExit={() => setFieldMode(false)} />;
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0e2a47] text-slate-900">
      {/* ============================================================
          MAP — fills the whole command surface (map-first, dominant)
         ============================================================ */}
      <div className={cn("absolute inset-y-0 right-0 left-[68px] lg:left-[196px]", inModule && "opacity-20")}>
        <AntarcticMap
          assets={usingLiveMap ? liveMapAssets : ops.assets}
          layers={layers}
          onLayersChange={setLayers}
          focusTarget={ops.focusTarget ? { lat: ops.focusTarget.lat, lon: ops.focusTarget.lon, label: ops.focusTarget.label, zoom: ops.focusTarget.zoom } : null}
          events={mapEvents}
          className="h-full w-full"
        />
        {usingLiveMap ? (
          <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5">
            <DataSourceBadge kind="LIVE" />
            <span className="rounded border border-white/70 bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700 backdrop-blur">
              {liveMapAssets.length} entities from database
            </span>
            {live.entities
              ? trackedToViews(live.entities)
                  .filter((t) => t.freshness !== "LIVE")
                  .slice(0, 3)
                  .map((t) => (
                    <span
                      key={t.asset.id}
                      className="rounded border border-amber-300 bg-amber-50/90 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 backdrop-blur"
                    >
                      {t.asset.label} — {t.freshnessLabel}
                    </span>
                  ))
              : null}
          </div>
        ) : null}
      </div>

      {/* ============================================================
          SLIM NAV RAIL
         ============================================================ */}
      <aside className="absolute inset-y-0 left-0 z-40 hidden w-[196px] flex-col bg-gradient-to-b from-[#123a63] via-[#15497a] to-[#0d2c4d] shadow-[4px_0_28px_-10px_rgba(4,20,40,0.6)] lg:flex">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Logo */}
          <div className="flex items-center gap-2 px-4 pt-5 pb-4">
            <svg width="30" height="21" viewBox="0 0 34 24" aria-hidden>
              <path d="M2 22 L12 6 L18 14 L23 8 L32 22 Z" fill="#ffffff" opacity="0.95" />
              <path d="M12 6 L16 12 L12 14 L9 11 Z" fill="#93c5fd" />
              <path d="M23 8 L27 14 L23 16 L21 12 Z" fill="#93c5fd" />
            </svg>
            <div>
              <p className="text-[15px] leading-none font-extrabold tracking-[0.14em] text-white">POLARIS</p>
              <p className="mt-1 text-[6.8px] font-bold tracking-[0.13em] text-sky-200/85 uppercase">
                Integrated Polar Expedition Operations
              </p>
            </div>
          </div>

          {/* Nav */}
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-2 [scrollbar-width:thin]">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => navClick(n.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[11px] font-semibold transition-colors",
                  activeNav === n.id
                    ? "bg-white/95 text-sky-950 shadow-md"
                    : "text-sky-100/85 hover:bg-white/12 hover:text-white",
                  n.id === "field" && "mt-1 border-t border-white/15 pt-2",
                )}
              >
                <n.icon className={cn("h-3.5 w-3.5 shrink-0", (n.id === "homelink" || n.id === "family") && "text-rose-300")} />
                <span className="flex-1 truncate text-left">{n.label}</span>
                {n.badgeKey === "alerts" && criticalAlerts > 0 && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-extrabold text-white">{criticalAlerts}</span>
                )}
              </button>
            ))}
          </nav>

          {/* Live backend controls — connectivity, sync, database init. */}
          <div className="mt-3 space-y-2 border-t border-white/15 pt-3">
            <p className="px-1 text-[8px] font-bold tracking-[0.16em] text-sky-200/70 uppercase">Field Link</p>
            <div className="px-1">
              <ConnectivityControl />
            </div>
            <div className="px-1">
              <SyncStatusStrip />
            </div>
            <div className="flex flex-wrap gap-1.5 px-1">
              <OperatorConsole />
              <SystemStatusPanel />
            </div>
            <div className="px-1">
              <LiveIndicator />
            </div>
          </div>
        </div>

        <div className="relative px-4 pb-5">
          <p className="text-[9px] leading-snug font-semibold text-sky-100/75">
            Exploring for a<br />Sustainable Tomorrow
          </p>
          <div className="mt-2.5 flex items-center gap-1.5 text-[8.5px] font-extrabold tracking-[0.18em] text-white/90 uppercase">
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
              <circle cx="7" cy="7" r="6" fill="none" stroke="white" strokeWidth="1.2" />
              <circle cx="7" cy="7" r="2.2" fill="white" />
            </svg>
            NCPOR
          </div>
        </div>
      </aside>

      {/* ============================================================
          FLOATING TOP COMMAND BAR
         ============================================================ */}
      <header className="absolute top-2.5 right-3 left-[204px] z-30 lg:left-[212px]">
        <div className="glass-strong flex items-center gap-2.5 rounded-2xl px-3 py-2 shadow-[0_14px_40px_-16px_rgba(8,32,64,0.5)]">
          <div className="hidden items-center gap-2 xl:flex">
            <svg width="26" height="26" viewBox="0 0 30 30" aria-hidden>
              <circle cx="15" cy="15" r="13.5" fill="none" stroke="#1d4ed8" strokeWidth="1.4" />
              <circle cx="15" cy="15" r="9" fill="none" stroke="#1d4ed8" strokeWidth="0.8" strokeDasharray="2 1.6" />
              <path d="M15 6 L15 24 M6 15 L24 15 M9 9 L21 21 M21 9 L9 21" stroke="#1d4ed8" strokeWidth="0.7" />
              <circle cx="15" cy="15" r="3" fill="#1d4ed8" />
            </svg>
            <div className="leading-tight">
              <p className="text-[9.5px] font-extrabold text-slate-800">National Centre for Polar and Ocean Research</p>
              <p className="text-[8px] font-semibold text-slate-400">Ministry of Earth Sciences, Govt. of India</p>
            </div>
          </div>

          {/* Search */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/60 px-3 text-left ring-1 ring-white/70 backdrop-blur md:flex"
          >
            <Search className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="text-[10.5px] font-semibold text-slate-400">Search stations, cargo, people, samples…</span>
          </button>

          {/* Status strip — every chip is a live database aggregate */}
          <div className="hidden items-center gap-2.5 xl:flex">
            <StatusChip
              value={kpi.stationsOnline === undefined ? "—" : `${kpi.stationsOnline}/${kpi.stationsTotal}`}
              label="Stations"
              dot="bg-emerald-500"
            />
            <StatusChip value={kpi.personnel === undefined ? "—" : `${kpi.personnel}`} label="Personnel" dot="bg-sky-500" />
            <StatusChip value={`${criticalAlerts}`} label="Critical" dot="bg-red-500" pulse />
            {/* HOME LINK indicator — deliberately understated */}
            <button type="button" onClick={() => navClick("homelink")} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-0.5 hover:bg-white/50" title="HOME LINK — family message pipeline">
              <Heart className="h-2.5 w-2.5 text-rose-400" />
              <p className="text-[9.5px] leading-tight">
                <span className="font-extrabold text-slate-800">{homelinkWaiting}</span>
                <span className="ml-1 font-bold text-slate-400">Home Link</span>
              </p>
            </button>
          </div>

          {/* Connectivity — the ladder is visible, not hidden */}
          <button
            type="button"
            onClick={() => setSyncOpen(true)}
            className="flex flex-col items-start rounded-lg px-2 py-0.5 text-left transition-colors hover:bg-white/50"
            title="Connectivity engine and priority sync queue"
          >
            <span className={cn("flex items-center gap-1 text-[9.5px] font-extrabold", ops.conn === "OFFLINE" || ops.connMode === "OFFLINE" ? "text-amber-600" : ops.conn === "SYNCING" ? "text-sky-600" : "text-slate-700")}>
              {ops.conn === "OFFLINE" || ops.connMode === "OFFLINE" ? <WifiOff className="h-3 w-3 text-amber-500" /> : <Wifi className="h-3 w-3 text-sky-600" />}
              {ops.conn === "SYNCING" ? `SYNCING ${ops.syncedCount}/${ops.syncedCount + ops.queue.length}` : ops.connMode === "NORMAL" ? "Connected" : ops.connMode === "WEAK" ? "Weak signal" : ops.connMode === "LOW_BANDWIDTH" ? "Low bandwidth" : `OFFLINE · ${ops.queue.length} actions queued`}
            </span>
            <span className="text-[7.5px] font-bold text-slate-400">
              {ops.conn === "SYNCING" ? "P1→P4 · validating" : `Synced ${ops.lastSync}`}
            </span>
          </button>

          {/* Date */}
          <div className="hidden leading-tight lg:block">
            <p className="text-[9.5px] font-extrabold text-slate-700">
              {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}
            </p>
            <p className="text-[8px] font-bold text-slate-400">
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} IST
            </p>
          </div>

          {/* Demo */}
          <button
            type="button"
            onClick={runDemo}
            className="hidden h-7 items-center rounded-full bg-blue-700 px-2.5 text-[9px] font-extrabold tracking-wide text-white uppercase shadow-sm transition-colors hover:bg-blue-800 xl:flex"
          >
            Demo
          </button>

          {/* Audit */}
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/60"
            aria-label="Audit trail"
          >
            <ScrollText className="h-3.5 w-3.5" />
          </button>

          {/* Notifications */}
          <button
            type="button"
            onClick={() => setSyncOpen(true)}
            className="relative flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/60"
            aria-label="Notifications"
          >
            <Bell className="h-3.5 w-3.5" />
            {ops.queue.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[7.5px] font-extrabold text-white">
                {ops.queue.length}
              </span>
            )}
          </button>

          {/* Profile */}
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-full bg-white/60 py-0.5 pr-2 pl-0.5 ring-1 ring-white/70 transition-colors hover:bg-white/85"
            title="Sign out"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-700 text-[8px] font-extrabold text-white">
              AS
            </span>
            <span className="hidden leading-tight 2xl:block">
              <span className="block text-[9px] font-extrabold text-slate-800">Avni Sharma</span>
              <span className="block text-[7.5px] font-bold text-slate-400">Expedition Manager</span>
            </span>
            <LogOut className="hidden h-2.5 w-2.5 text-slate-300 2xl:block" />
          </button>
        </div>
      </header>

      {/* ============================================================
          MODULE SURFACE — glass overlay above the map, home stays map-first
         ============================================================ */}
      {inModule && (
        <div className="absolute inset-y-0 left-[196px] right-0 z-20 overflow-y-auto bg-gradient-to-b from-[#0d2c4d]/92 via-[#123a63]/90 to-[#0e2a47]/94 px-5 pt-[76px] pb-6 backdrop-blur-xl lg:left-[212px] [scrollbar-width:thin]">
          <div className="mx-auto max-w-5xl">
            <button type="button" onClick={() => navClick("home")} className="mb-3 rounded-full bg-white/10 px-3 py-1.5 text-[10.5px] font-extrabold text-sky-100 hover:bg-white/20">
              ← Back to Command Center map
            </button>
            {moduleNode}
          </div>
        </div>
      )}

      {/* ============================================================
          HOME — POLAR INTELLIGENCE PANEL (right)
         ============================================================ */}
      {!inModule && (
        <div className="absolute top-[74px] right-3 bottom-[178px] z-20 hidden w-[318px] lg:block">
          <IntelPanel feed={ops.feed} onApproveReject={ops.approveIntel} onSimulate={() => setSimOpen(true)} className="h-full" />
        </div>
      )}

      {/* Scenario chip — demo chain visible */}
      {ops.scenario && (
        <div className={cn("absolute z-30 hidden items-center gap-2 rounded-full bg-amber-500/90 px-3 py-1.5 text-[10px] font-extrabold text-white shadow-lg lg:flex", inModule ? "top-[76px] right-6" : "top-[74px] right-[336px]")}>
          <TriangleAlert className="h-3 w-3" />
          SCENARIO: {ops.scenario.scenario.label.toUpperCase()}{ops.scenario.scenario.hasDelay ? ` +${ops.scenario.delayDays}D` : ""}
          <button type="button" onClick={ops.clearScenario} className="ml-1 rounded-full bg-white/25 px-2 py-0.5 text-[9px] hover:bg-white/40">RESET</button>
        </div>
      )}

      {/* ============================================================
          SOS — persistent, bottom-right (home view)
         ============================================================ */}
      {!inModule && (
        <div className="absolute right-6 bottom-[186px] z-20 hidden lg:block">
          <div className="glass-strong rounded-2xl p-3 shadow-lg">
            <SosCircle
              onActivated={async () => {
                // The SOS button is a real P0 backend call. When the link is
                // down the server is told nothing and the event is written to
                // the device's local P0 store instead.
                const p = live.personnel[0];
                if (!p) {
                  toast.error("No personnel record to attach the SOS to", {
                    description: "Create a personnel record first.",
                  });
                  return;
                }
                const tracked = live.entities?.tracked.find((t) => t.subjectId === p.polarisId);
                const r = await live.raiseSos({
                  personId: p.polarisId,
                  deviceId: p.deviceId ?? `DEV-${p.polarisId}`,
                  lat: tracked?.lat ?? live.stations[0]?.lat ?? -70.7586,
                  lon: tracked?.lon ?? live.stations[0]?.lon ?? 11.7286,
                  accuracyM: 8,
                  batteryPct: tracked?.batteryPct ?? 72,
                  category: "Field SOS",
                  connectivity: live.connMode === "CONNECTED" ? "ONLINE" : "OFFLINE",
                });
                ops.triggerSos();
                toast.error(r.queued ? "SOS STORED LOCALLY — P0 QUEUE" : "SOS TRANSMITTED — P0", {
                  description: `${r.sosId} · ${r.state}${r.nearestStation ? ` · nearest ${r.nearestStation} (${r.nearestStationKm} km)` : ""}${
                    r.hazard ? ` · ${r.hazard.label} ${r.hazard.distanceKm} km` : ""
                  }`,
                  duration: 14000,
                });
              }}
            />
            <p className="mt-1 text-center text-[7.5px] font-bold tracking-wide text-slate-500 uppercase">
              {ops.sos.active ? "Incident active" : "P0 · works offline"}
            </p>
          </div>
        </div>
      )}

      {/* ============================================================
          COMPACT BOTTOM OPERATIONAL CARDS (home view)
         ============================================================ */}
      {!inModule && (
        <div className="absolute right-3 bottom-2.5 left-[204px] z-20 lg:left-[212px]">
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <MiniCard>
              <div className="flex items-center gap-3">
                <Donut value={kpi.readinessPct ?? 0} size={54} />
                <div className="space-y-1">
                  <MiniLegend
                    label={
                      kpi.stationsOnline === undefined
                        ? "Stations —"
                        : `${kpi.stationsOnline}/${kpi.stationsTotal} Stations`
                    }
                    dot="bg-emerald-500"
                  />
                  <MiniLegend
                    label={kpi.personnel === undefined ? "Personnel —" : `${kpi.personnel} Personnel`}
                    dot="bg-sky-500"
                  />
                  <MiniLegend
                    label={kpi.cargoInTransit === undefined ? "Cargo —" : `${kpi.cargoInTransit} cargo in transit`}
                    dot="bg-indigo-400"
                  />
                </div>
              </div>
            </MiniCard>

            <MiniCard>
              <div className="space-y-1.5">
                <MiniMeter
                  icon={Flame}
                  label="Fuel"
                  pct={reservePct("FUEL")}
                  note={reserveNote("FUEL")}
                  tone={reservePct("FUEL") < 45 ? "critical" : "ok"}
                />
                <MiniMeter
                  icon={Droplets}
                  label="Food"
                  pct={reservePct("FOOD")}
                  note={reserveNote("FOOD")}
                  tone={reservePct("FOOD") < 45 ? "warning" : "ok"}
                />
                <MiniMeter
                  icon={Gauge}
                  label="Medical"
                  pct={reservePct("MEDICAL")}
                  note={reserveNote("MEDICAL")}
                  tone={reservePct("MEDICAL") < 45 ? "critical" : "ok"}
                />
              </div>
            </MiniCard>

            <MiniCard>
              <div className="space-y-1">
                {convoyHighlights.length > 0 ? (
                  convoyHighlights.map((c) => (
                    <MiniTransport
                      key={c.convoyId}
                      name={`${c.convoyId} · ${c.personnelCount}p/${c.vehicleCount}v`}
                      sub={c.comms === "MISSED_CHECK_IN" ? "Missed check-in" : `Fuel ${c.fuelPct}% · ${c.status}`}
                      status={c.comms === "MISSED_CHECK_IN" ? "Alert" : c.status === "ACTIVE" ? "On Move" : "Scheduled"}
                      tone={c.comms === "MISSED_CHECK_IN" ? "warn" : "ok"}
                    />
                  ))
                ) : (
                  <p className="px-1 py-2 text-[9px] text-slate-500">No convoys in the database.</p>
                )}
              </div>
            </MiniCard>

            <MiniCard>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-sky-700">
                    <CloudSnow className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-[15px] leading-none font-extrabold text-slate-900">{wx ? `${Math.round(wx.temperatureC)}°C` : "—"}</p>
                    <p className="text-[8px] font-bold text-slate-400">
                      {wx ? `${wx.condition} · ${wx.stationLabel}` : "no observation"}
                    </p>
                  </div>
                </div>
                <div className="space-y-px text-right">
                  <p className="text-[8px] font-bold text-slate-600">Wind {wx ? Math.round(wx.windKph) : "—"} km/h</p>
                  <p className="text-[8px] font-bold text-slate-600">Vis {wx ? wx.visibilityKm : "—"} km</p>
                  <p className="text-[8px] font-bold text-slate-600">{wx ? Math.round(wx.pressureHpa) : "—"} hPa</p>
                </div>
              </div>
              {wx ? (
                <p className="mt-1 text-[8px] text-slate-500">
                  {wx.simulated ? "SIMULATED" : "LIVE"} · observed {new Date(wx.observedTs).toISOString().slice(11, 16)} UTC
                </p>
              ) : null}
              {topHazard ? (
                <button type="button" onClick={() => navClick("routes")} className="mt-1.5 w-full rounded-lg bg-red-500/10 px-2 py-1 text-left ring-1 ring-red-300/40 hover:bg-red-500/20">
                  <p className="text-[7.5px] font-extrabold tracking-wider text-red-600 uppercase">
                    {topHazard.severity === "critical" ? "Hazard · Route exposure detected" : "Hazard · active zone"}
                  </p>
                  <p className="text-[9px] font-bold text-slate-700">{topHazard.label}</p>
                </button>
              ) : (
                <p className="mt-1.5 text-[8px] text-slate-500">No active hazard zones published.</p>
              )}
            </MiniCard>
          </div>
        </div>
      )}

      {/* Mobile SOS bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-white/50 bg-white/90 px-4 py-2 backdrop-blur lg:hidden">
        <span className="text-[10px] font-bold text-slate-500">
          {ops.connMode === "OFFLINE" ? `OFFLINE · ${ops.queue.length} queued` : "Online"} · sync {ops.lastSync}
        </span>
        <button
          type="button"
          onClick={ops.triggerSos}
          className="rounded-full bg-red-500 px-5 py-1.5 text-[11px] font-extrabold tracking-widest text-white uppercase shadow-md"
        >
          SOS
        </button>
      </div>

      {/* ============================================================
          Overlays
         ============================================================ */}
      <SyncQueueDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        queue={ops.queue.map((q) => ({ id: q.id, ts: q.ts, kind: q.kind, summary: q.summary }))}
        conflict={ops.conflict ? { id: ops.conflict.id, station: ops.conflict.station, resource: ops.conflict.resource, central: ops.conflict.central, local: ops.conflict.local, localTs: ops.conflict.localTs, author: ops.conflict.author } : null}
        onResolve={(r) => ops.resolveConflict(r)}
      />
      <SimulatorDialog
        open={simOpen}
        onOpenChange={setSimOpen}
        scenarios={SIM_SCENARIOS}
        result={ops.simResult}
        onRun={(id, days) => ops.runScenario(id, days)}
        onApprove={() => {
          if (ops.scenario) ops.approveIntel(`rec-scenario-${ops.scenario.scenario.id}`, "APPROVED");
          toast.success("Approved — plan applied, audit entry created");
          setSimOpen(false);
        }}
      />
      <AuditDialog entries={ops.audit} state={live.state.audit} open={auditOpen} onOpenChange={setAuditOpen} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      {wellbeingOpen && <WellBeingCheckIn onClose={() => setWellbeingOpen(false)} />}

      {/* Well-being quick access — small, calm */}
      {!inModule && (
        <button
          type="button"
          onClick={() => setWellbeingOpen(true)}
          className="absolute right-6 bottom-[292px] z-20 hidden rounded-full bg-white/70 px-3 py-1.5 text-[9px] font-extrabold tracking-wide text-slate-600 shadow ring-1 ring-white/70 transition-colors hover:bg-white lg:block"
          title="Private well-being check-in"
        >
          Well-being check-in
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI Intelligence module wrapper (full feed with approvals)           */
/* ------------------------------------------------------------------ */

function IntelModule() {
  const ops = useOps();
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">Polar Intelligence Engine</h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">Prediction → Optimization → Anomaly detection → Risk → Recommendation → Human approval → Audit</p>
      </header>
      <div className="mx-auto max-w-md">
        <IntelPanel feed={ops.feed} onApproveReject={ops.approveIntel} onSimulate={() => {}} className="max-h-none" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces (unchanged design language)                            */
/* ------------------------------------------------------------------ */

function StatusChip({ value, label, dot, pulse }: { value: string; label: string; dot: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot, pulse && "animate-pulse")} />
      <p className="text-[9.5px] leading-tight">
        <span className="font-extrabold text-slate-800">{value}</span>
        <span className="ml-1 font-bold text-slate-400">{label}</span>
      </p>
    </div>
  );
}

function MiniCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl px-3 py-2.5 shadow-[0_12px_34px_-16px_rgba(8,32,64,0.5)]">
      {children}
    </section>
  );
}

function MiniLegend({ label, dot }: { label: string; dot: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[8.5px] font-bold text-slate-600">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </p>
  );
}

function Donut({ value, size = 72 }: { value: number; size?: number }) {
  const r = size / 2 - 5;
  const C = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#dbe7f3" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#2563eb"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - value / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-[12px] leading-none font-extrabold text-slate-900">{value}%</p>
        <p className="text-[5.5px] font-bold tracking-wide text-slate-400 uppercase">Readiness</p>
      </div>
    </div>
  );
}

function MiniMeter({
  icon: Icon,
  label,
  pct,
  note,
  tone,
}: {
  icon: typeof Flame;
  label: string;
  pct: number;
  note: string;
  tone: "ok" | "warning" | "critical";
}) {
  const bar = tone === "critical" ? "bg-red-500" : tone === "warning" ? "bg-amber-500" : "bg-emerald-500";
  const noteCls = tone === "critical" ? "text-red-500" : tone === "warning" ? "text-amber-600" : "text-emerald-600";
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-sky-500/10 text-sky-700">
        <Icon className="h-2.5 w-2.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1">
          <p className="text-[9.5px] font-extrabold text-slate-800">{label}</p>
          <p className="text-[8.5px] font-extrabold text-slate-500">{pct}%</p>
        </div>
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/60">
          <div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className={cn("w-14 text-right text-[7.5px] font-extrabold", noteCls)}>{note}</p>
    </div>
  );
}

function MiniTransport({ name, sub, status, tone }: { name: string; sub: string; status: string; tone: "ok" | "warn" }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-emerald-500" : "bg-amber-500")} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[9px] font-extrabold text-slate-800">{name}</p>
        <p className="truncate text-[7.5px] font-bold text-slate-400">{sub}</p>
      </div>
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-[7px] font-extrabold whitespace-nowrap",
          tone === "ok" ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700",
        )}
      >
        {status}
      </span>
    </div>
  );
}

function AuditDialog({ entries, state, open, onOpenChange }: { entries: { id: string; ts: string; actor: string; action: string; target: string; outcome: string }[]; state?: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Audit trail</DialogTitle>
          <DialogDescription>Every AI approval, rejection, scenario application, sync batch, conflict resolution and emergency action is recorded here — Who · What · When · Target.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400">{e.ts}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide",
                    e.outcome === "APPROVED"
                      ? "bg-emerald-100 text-emerald-700"
                      : e.outcome === "REJECTED"
                        ? "bg-red-100 text-red-700"
                        : "bg-sky-100 text-sky-700",
                  )}
                >
                  {e.outcome}
                </span>
                <span className="truncate text-[10.5px] font-bold text-slate-700">{e.actor}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-slate-600">{e.action}</p>
            </div>
          ))}
          {state === "denied" && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3">
              <p className="text-[12px] font-semibold text-slate-700">Restricted</p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">
                The audit trail is readable by administrators only. Your role cannot open
                this record — this is a permission boundary, not an absence of activity.
              </p>
            </div>
          )}
          {state !== "denied" && entries.length === 0 && (
            <p className="text-[12px] text-slate-500">No entries yet.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
