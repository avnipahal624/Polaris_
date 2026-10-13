/**
 * POLARIS Field Safety Mode — minimal, huge-target offline-first UI for
 * personnel operating around stations, camps, convoys and remote areas.
 * Everything works with NO connectivity: actions become local priority events.
 */
import { useState } from "react";
import {
  CheckCircle2,
  CloudSnow,
  Heart,
  ListChecks,
  Map as MapIcon,
  Play,
  RefreshCw,
  ScanLine,
  Send,
  Siren,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CRITICAL_OFFLINE_SCOPE,
  EXPOSURE_TONE,
  PRIORITY_META,
  assessRouteExposure,
  priorityOf,
  type FieldActionId,
} from "@/lib/safety";
import { HAZARDS, STATIONS } from "@/lib/polar-data";
import { SEED_MESSAGES, type MessageKind } from "@/lib/homelink";
import { useOps } from "@/lib/ops-store";

export function FieldSafetyMode({ onExit }: { onExit: () => void }) {
  const { conn, connMode, setConnMode, queue, syncedCount, scanCargo, triggerSos, sos, goto } = useOps();
  const [panel, setPanel] = useState<FieldActionId | "homelink" | null>(null);
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const offline = conn === "OFFLINE";

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#0b2340] text-white">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold", offline ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/15 text-emerald-300")}>
          {offline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
          {offline ? `OFFLINE · ${queue.length} actions queued` : conn === "SYNCING" ? `SYNCING ${syncedCount}/${queue.length + syncedCount}` : connMode}
        </span>
        <p className="hidden text-[11px] font-bold tracking-wide text-sky-200/70 uppercase sm:block">Field Safety Mode — works with no network</p>
        <button type="button" onClick={onExit} className="ml-auto rounded-full bg-white/10 px-4 py-2 text-[12px] font-extrabold hover:bg-white/20">
          Exit Field Mode
        </button>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!panel && (
          <div className="mx-auto grid max-w-xl grid-cols-2 gap-3">
            {            (
              [
                { id: "map", icon: MapIcon, label: "MAP", note: "Offline map · routes" },
                { id: "scan", icon: ScanLine, label: "SCAN", note: "Cargo · queues offline" },
                { id: "tasks", icon: ListChecks, label: "TASKS", note: "Update task status" },
                { id: "hazards", icon: TriangleAlert, label: "HAZARDS", note: "Cached zones" },
                { id: "weather", icon: CloudSnow, label: "WEATHER", note: "Cached warnings" },
                { id: "homelink", icon: Heart, label: "HOME LINK", note: "Messages from home" },
                { id: "sync", icon: RefreshCw, label: "SYNC", note: "Priority queue" },
              ] as const
            ).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setPanel(a.id)}
                className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.07] p-4 active:scale-[0.98]"
              >
                <a.icon className="h-9 w-9 text-sky-300" />
                <span className="text-lg font-extrabold tracking-widest">{a.label}</span>
                <span className="text-[10.5px] font-semibold text-sky-200/60">{a.note}</span>
              </button>
            ))}

            {/* SOS — deliberately dominant */}
            <button
              type="button"
              onClick={triggerSos}
              className={cn(
                "col-span-2 flex min-h-32 flex-col items-center justify-center gap-1 rounded-2xl border-2 text-white active:scale-[0.98]",
                sos.active ? "border-red-300 bg-red-700" : "border-red-300/70 bg-gradient-to-b from-red-500 to-red-600",
              )}
            >
              <Siren className="h-10 w-10" />
              <span className="text-2xl font-extrabold tracking-[0.3em]">{sos.active ? "SOS ACTIVE" : "SOS"}</span>
              <span className="text-[11px] font-bold text-white/85">
                {sos.active ? "INC-2609-04 · control room alerted" : "No network required — GPS + packet stored locally"}
              </span>
            </button>

            <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.05] p-3">
              <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Cached locally on this device</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {CRITICAL_OFFLINE_SCOPE.map((x) => (
                  <span key={x} className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-sky-100/80">{x}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {panel === "map" && (
          <PanelWrap title="MAP — offline" onBack={() => setPanel(null)}>
            <p className="text-[12px] font-semibold text-sky-100/80">Full Antarctic EPSG:3031 base map, station/camp positions, saved routes and hazard zones are cached on the device.</p>
            <div className="mt-3 grid gap-2">
              {STATIONS.map((s) => (
                <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
                  <p className="text-[12px] font-extrabold">{s.name}</p>
                  <p className="text-[10.5px] text-sky-200/70">{s.lat.toFixed(2)}°S {s.lon.toFixed(2)}°E · {s.weather.condition} · {s.hazardIds.length} hazard(s)</p>
                </div>
              ))}
            </div>
            <Button size="sm" className="mt-3 h-10 bg-sky-500 text-[12px] font-extrabold" onClick={() => { setPanel(null); onExit(); goto("home"); }}>
              Open live map
            </Button>
          </PanelWrap>
        )}

        {panel === "scan" && (
          <PanelWrap title="SCAN — works offline" onBack={() => setPanel(null)}>
            <div className="flex gap-2">
              <Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Barcode / RFID…" className="h-12 border-white/20 bg-white/10 text-[14px] font-bold text-white placeholder:text-sky-200/40" />
              <Button size="sm" className="h-12 bg-sky-500 px-5 text-[13px] font-extrabold" onClick={() => { if (scan.trim()) { const r = scanCargo(scan); setScanMsg(r === "found" ? "Verified — queued (P3)" : r === "unverified" ? "Flagged — unverified consignment (P3)" : "NOT in manifest — missing-cargo anomaly raised (P3)"); setScan(""); } }}>
                SCAN
              </Button>
            </div>
            {scanMsg && <p className="mt-2 text-[12px] font-bold text-sky-200">{scanMsg}</p>}
            <p className="mt-2 text-[11px] text-sky-200/60">Scans become LOCAL EVENTS → ENCRYPTED SYNC QUEUE (P3) → server validation → conflict check → central system.</p>
          </PanelWrap>
        )}

        {panel === "tasks" && (
          <PanelWrap title="TASKS — offline updates" onBack={() => setPanel(null)}>
            {[
              "Generator load audit — 60% complete",
              "Crevasse survey line 3 — in progress",
              "Consignment verification ANT-26062-041 — pending",
              "Water quality sampling — done",
            ].map((t) => (
              <button key={t} type="button" className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-left text-[13px] font-bold active:scale-[0.99]", t.includes("done") && "opacity-60")}>
                <CheckCircle2 className={cn("h-5 w-5", t.includes("done") ? "text-emerald-400" : "text-sky-300/60")} />
                {t}
              </button>
            ))}
            <p className="mt-2 text-[11px] text-sky-200/60">Task updates queue as P2 events (active mission scope).</p>
          </PanelWrap>
        )}

        {panel === "hazards" && (
          <PanelWrap title="HAZARDS — cached zones" onBack={() => setPanel(null)}>
            {HAZARDS.map((h) => (
              <div key={h.id} className={cn("rounded-xl border border-white/10 bg-white/[0.06] p-3", h.severity === "critical" && "ring-1 ring-red-400/40")}>
                <div className="flex items-center gap-2">
                  <TriangleAlert className={cn("h-4 w-4", h.severity === "critical" ? "text-red-400" : "text-amber-400")} />
                  <p className="text-[12.5px] font-extrabold">{h.label}</p>
                  <span className="ml-auto text-[10px] font-bold text-sky-200/60">{h.kind}</span>
                </div>
                <p className="mt-1 text-[11px] text-sky-100/75">{h.note}</p>
                <p className="mt-1 text-[10px] text-sky-200/50">{h.lat.toFixed(2)}°S {h.lon.toFixed(2)}°E · radius {h.radiusKm} km</p>
              </div>
            ))}
          </PanelWrap>
        )}

        {panel === "weather" && (
          <PanelWrap title="WEATHER — last cached warnings" onBack={() => setPanel(null)}>
            {STATIONS.map((s) => (
              <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                <p className="text-[12px] font-extrabold">{s.short} — {s.weather.condition}</p>
                <p className="text-[11px] text-sky-200/70">{s.weather.tempC}°C · wind {s.weather.windKph} km/h · vis {s.weather.visibilityKm} km</p>
                {s.weather.windKph >= 45 && <p className="mt-1 text-[10.5px] font-bold text-amber-300">WARNING — wind above movement gate</p>}
              </div>
            ))}
            <p className="mt-2 text-[11px] text-sky-200/60">Snapshot cached at last sync {conn === "OFFLINE" ? "(device offline — showing last warnings)" : ""}.</p>
          </PanelWrap>
        )}

        {panel === "homelink" && <HomeLinkField onBack={() => setPanel(null)} />}

        {panel === "sync" && (
          <PanelWrap title="SYNC — priority queue" onBack={() => setPanel(null)}>
            <div className="grid grid-cols-2 gap-2">
              {([1, 2, 3, 4] as const).map((p) => {
                const items = queue.filter((q) => priorityOf(q.kind) === p);
                const meta = PRIORITY_META[p];
                return (
                  <div key={p} className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                    <p className={cn("inline-block rounded px-2 py-0.5 text-[10px] font-extrabold", meta.tone)}>{meta.label}</p>
                    <p className="mt-1 text-[10px] font-bold text-sky-200/60">{meta.scope}</p>
                    <p className="mt-1 text-lg font-extrabold">{items.length}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 space-y-1">
              {queue.map((q) => (
                <div key={q.id} className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2 text-[11.5px]">
                  <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-extrabold", PRIORITY_META[priorityOf(q.kind)].tone)}>P{priorityOf(q.kind)}</span>
                  <span className="truncate font-semibold text-sky-100/85">{q.summary}</span>
                  <span className={cn("ml-auto text-[9.5px] font-extrabold", q.state === "SYNCING" ? "text-sky-300" : "text-amber-300")}>{q.state}</span>
                </div>
              ))}
              {queue.length === 0 && <p className="text-[12px] font-semibold text-emerald-300">Queue empty — all events verified.</p>}
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.05] p-3">
              <p className="text-[10px] font-extrabold tracking-widest text-sky-200/60 uppercase">Simulate connectivity</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["NORMAL", "WEAK", "LOW_BANDWIDTH", "OFFLINE"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => { setConnMode(m); }} className={cn("rounded-full px-3 py-1.5 text-[10.5px] font-extrabold", connMode === m ? "bg-sky-500 text-white" : "bg-white/10 text-sky-200/80 hover:bg-white/20")}>
                    {m === "LOW_BANDWIDTH" ? "LOW BANDWIDTH" : m}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-sky-200/50">{connMode === "NORMAL" ? "Full synchronization and operational data." : connMode === "WEAK" ? "Text-first payloads — images deferred." : connMode === "LOW_BANDWIDTH" ? "Mission-critical only — SOS, personnel, location, hazards, routes, cargo status, critical inventory, weather warnings. Imagery/analytics deferred." : "Local operation — every action queues encrypted, prioritized P1→P4, syncs on reconnect."}</p>
            </div>
          </PanelWrap>
        )}
      </div>

      {/* route exposure strip */}
      {assessRouteExposure("r-suhrid") && assessRouteExposure("r-suhrid")!.exposure !== "LOW" && (
        <button
          type="button"
          onClick={() => { onExit(); goto("home"); }}
          className="flex items-center gap-2 border-t border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-left"
        >
          <span className={cn("rounded px-2 py-0.5 text-[10px] font-extrabold", EXPOSURE_TONE[assessRouteExposure("r-suhrid")!.exposure])}>
            ROUTE EXPOSURE DETECTED — {assessRouteExposure("r-suhrid")!.exposure}
          </span>
          <span className="truncate text-[11px] font-bold text-amber-100/90">Maitri → Suhrid over-ice line — tap to review on map</span>
        </button>
      )}
    </div>
  );
}

function PanelWrap({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-2">
      <button type="button" onClick={onBack} className="rounded-full bg-white/10 px-4 py-2 text-[12px] font-extrabold hover:bg-white/20">
        ← Back
      </button>
      <h2 className="text-[15px] font-extrabold tracking-wide uppercase">{title}</h2>
      {children}
    </div>
  );
}

/* ---- HOME LINK field screen — works offline from cached content ---- */

function HomeLinkField({ onBack }: { onBack: () => void }) {
  const { conn, connMode } = useOps();
  const [reply, setReply] = useState<null | "VOICE MESSAGE" | "SHORT VIDEO" | "TEXT MESSAGE">(null);
  const [replied, setReplied] = useState(false);
  const inbound = SEED_MESSAGES.filter((m) => m.direction === "family→field");
  const fresh = inbound.filter((m) => m.state !== "OPENED");

  return (
    <PanelWrap title="HOME LINK — messages from home" onBack={onBack}>
      {fresh.length > 0 && (
        <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-[12px] font-extrabold text-rose-200">❤️ {fresh.length} new message{fresh.length === 1 ? "" : "s"} available</p>
      )}
      <div className="space-y-2">
        {inbound.map((m) => (
          <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg">{m.kind === "SHORT VIDEO" ? "🎥" : m.kind === "VOICE MESSAGE" ? "🎙" : m.kind === "BIRTHDAY / FESTIVAL" ? "🎂" : "❤️"}</span>
              <p className="text-[12.5px] font-extrabold">{m.from}</p>
              <span className="ml-auto text-[10px] font-bold text-sky-200/60">Received {m.ageMinutes < 60 ? `${m.ageMinutes} min ago` : `${Math.round(m.ageMinutes / 60)} h ago`}</span>
            </div>
            <p className="mt-1 text-[12px] font-semibold text-sky-100/85">{m.preview}</p>
            {m.kind === "SHORT VIDEO" && m.state === "WAITING FOR CONNECTIVITY" ? (
              <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-300">Audio available now · video pending synchronization</p>
            ) : (
              <button type="button" className="mt-1.5 flex items-center gap-1.5 rounded-full bg-sky-500/20 px-3 py-1.5 text-[11px] font-extrabold text-sky-200 hover:bg-sky-500/30">
                <Play className="h-3 w-3" /> PLAY{m.duration ? ` · ${m.duration}` : ""}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="pt-1 text-[10px] font-extrabold tracking-widest text-sky-200/60 uppercase">Record reply</p>
      {!replied ? (
        <div className="grid grid-cols-3 gap-2">
          {([
            { k: "VOICE MESSAGE", icon: "🎙", label: "Voice" },
            { k: "SHORT VIDEO", icon: "🎥", label: "Video" },
            { k: "TEXT MESSAGE", icon: "✉", label: "Text" },
          ] as { k: MessageKind; icon: string; label: string }[]).map((b) => (
            <button key={b.k} type="button" onClick={() => { setReply(b.k as "VOICE MESSAGE"); setReplied(true); }} className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-white/15 bg-white/[0.07] active:scale-[0.98]">
              <span className="text-lg">{b.icon}</span>
              <span className="text-[11px] font-extrabold">{b.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-[11.5px] font-bold text-emerald-300">
          {reply === "TEXT MESSAGE" ? "Reply queued (P4)" : "Reply recorded — queued (P4)"} for next synchronization · emergency channel has priority
        </p>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
        <p className="text-[10.5px] font-bold">Connection: <span className={conn === "OFFLINE" ? "text-amber-300" : "text-emerald-300"}>{conn === "OFFLINE" ? "OFFLINE" : connMode}</span></p>
        <p className="text-[10.5px] font-bold">Reply status: <span className="text-amber-300">Queued for next synchronization</span></p>
        <p className="mt-1 text-[9.5px] font-semibold text-sky-200/55">Previously synchronized messages play fully offline. Family traffic never delays safety sync (P0–P3 first).</p>
      </div>

      <button type="button" onClick={onBack} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-[11.5px] font-extrabold text-sky-200 hover:bg-white/20">
        <Send className="h-3.5 w-3.5" /> All replies enter the encrypted priority sync queue
      </button>
    </PanelWrap>
  );
}
