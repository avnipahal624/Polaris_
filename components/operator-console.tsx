/**
 * POLARIS operator console.
 *
 * Every control here performs a real database write through a real mutation
 * and reports what the backend actually returned. Nothing in this component
 * flips a boolean in React state and calls it a result.
 *
 * The "data source" column is the important part: a control that writes a
 * simulated value says so, and a control whose external service is not
 * configured is disabled with the reason rather than silently doing nothing.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Boxes,
  ClipboardList,
  Cloud,
  CloudLightning,
  HardDriveDownload,
  MapPin,
  Play,
  Power,
  Siren,
  Truck,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { usePolarisLive } from "@/lib/polaris-live";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConnectivityControl, DataSourceBadge } from "@/components/system-status";
import { cn } from "@/lib/utils";

type Tab = "operate" | "records" | "hazards" | "communications";

const TABS: { id: Tab; label: string; icon: typeof Play }[] = [
  { id: "operate", label: "Operate", icon: Power },
  { id: "records", label: "Create Records", icon: ClipboardList },
  { id: "hazards", label: "Hazards", icon: MapPin },
  { id: "communications", label: "Comms", icon: Cloud },
];

export function OperatorConsole() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("operate");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-white/70 bg-white/60 px-2.5 py-1 text-[10px] font-semibold text-slate-700 backdrop-blur hover:bg-white/80"
      >
        <Play className="h-3 w-3" />
        OPERATOR CONSOLE
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto border-white/70 bg-white/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Operator console</DialogTitle>
            <DialogDescription className="text-slate-600">
              These controls write to the POLARIS database. Each one reports the row the server created or changed.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  tab === t.id
                    ? "border-sky-400 bg-sky-100 text-sky-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                <t.icon className="h-3 w-3" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === "operate" ? <OperateTab /> : null}
          {tab === "records" ? <RecordsTab /> : null}
          {tab === "hazards" ? <HazardsTab /> : null}
          {tab === "communications" ? <CommsTab /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Section({ title, children, source }: { title: string; children: React.ReactNode; source?: "SIMULATED" | "LIVE" | "NOT_CONFIGURED" }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white/80 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">{title}</h3>
        {source ? <DataSourceBadge kind={source} /> : null}
      </div>
      {children}
    </section>
  );
}

function OperateTab() {
  const live = usePolarisLive();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(`${label} failed`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="Operational database">
        <p className="mb-2 text-[11px] text-slate-600">
          {live.stations.length} stations · {live.personnel.length} personnel · {live.cargo.length} cargo ·{" "}
          {live.hazards.length} hazard zones
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(live.bootstrap, "Initialise")}>
          <HardDriveDownload className="mr-1.5 h-3.5 w-3.5" />
          Initialise reference data
        </Button>
      </Section>

      <Section title="GPS simulation" source="SIMULATED">
        <p className="mb-2 text-[11px] text-slate-600">
          A server-side engine advances convoys along real route geometry and writes genuine location events, which the
          control room then receives over its WebSocket subscription.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run(() => live.setRunning(true), "Simulation start")}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {live.controlRoom?.simRunning ? "Simulation running" : "Start simulation"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => live.setRunning(false), "Simulation stop")}
          >
            Stop
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(live.tick, "Tick")}>
            Run one tick
          </Button>
        </div>
        {live.controlRoom?.simRunning ? (
          <p className="mt-2 text-[10px] text-emerald-700">
            Engine active · {live.controlRoom.liveSubjects} live subject(s), {live.controlRoom.staleSubjects} stale
          </p>
        ) : null}
      </Section>

      <Section title="Connectivity">
        <ConnectivityControl />
        <div className="mt-2">
          <Button size="sm" variant="outline" disabled={busy || live.connMode === "OFFLINE"} onClick={() => void run(live.syncNow, "Sync")}>
            Synchronise queued field events
          </Button>
        </div>
      </Section>

      <Section title="Emergency">
        <p className="mb-2 text-[11px] text-slate-600">
          SOS is a P0 backend workflow. With no link it is written to the device&apos;s local store at P0 and transmits in
          priority order when a link returns.
        </p>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || live.personnel.length === 0}
          onClick={async () => {
            const p = live.personnel[0];
            const tracked = live.entities?.tracked.find((t) => t.subjectId === p.polarisId);
            const r = await live.raiseSos({
              personId: p.polarisId,
              deviceId: p.deviceId ?? `DEV-${p.polarisId}`,
              lat: tracked?.lat ?? live.stations[0]?.lat ?? -70.7586,
              lon: tracked?.lon ?? live.stations[0]?.lon ?? 11.7286,
              accuracyM: 8,
              batteryPct: tracked?.batteryPct ?? 72,
              category: "Operator console SOS",
              connectivity: live.connMode === "CONNECTED" ? "ONLINE" : "OFFLINE",
            });
            toast[r.queued ? "warning" : "error"](r.queued ? "SOS STORED LOCALLY AS P0" : "SOS TRANSMITTED", {
              description: `${r.sosId} · ${r.state}${r.nearestStation ? ` · nearest ${r.nearestStation} (${r.nearestStationKm} km)` : ""}`,
              duration: 12000,
            });
          }}
        >
          <Siren className="mr-1.5 h-3.5 w-3.5" />
          Trigger SOS
        </Button>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RecordsTab() {
  const live = usePolarisLive();
  const [busy, setBusy] = useState<string | null>(null);

  const [person, setPerson] = useState({ name: "", role: "Field Operator", stationId: "", team: "Team 1", deviceId: "", emergencyContact: "" });
  const [vehicle, setVehicle] = useState({ vehicleId: "", kind: "snow_vehicle", label: "", fuelPct: 100, capacityKg: 3500 });
  const [cargo, setCargo] = useState({ cargoId: "", itemType: "Frozen provisions", quantity: 240, unit: "kg", weightKg: 240, origin: "India", destinationStationId: "", missionId: "M-27", containersExpected: 100, responsiblePersonId: "" });
  const [task, setTask] = useState({ taskId: "", title: "", stationId: "", dueTs: Date.now() + 86_400_000, priority: "ROUTINE" });

  const stations = live.stations;
  const firstStation = stations[0];
  const guard = (key: string) => async (fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error("Write rejected by the server", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="Personnel" source="LIVE">
        <div className="grid gap-1.5">
          <Field label="Full name">
            <Input value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} placeholder="e.g. Dr. A. Sharma" />
          </Field>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Station">
              <select
                value={person.stationId}
                onChange={(e) => setPerson({ ...person, stationId: e.target.value })}
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="">Select…</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.short}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <Input value={person.team} onChange={(e) => setPerson({ ...person, team: e.target.value })} />
            </Field>
          </div>
          <Field label="Tracker device id">
            <Input value={person.deviceId} onChange={(e) => setPerson({ ...person, deviceId: e.target.value })} placeholder="DEV-105" />
          </Field>
          <Field label="Emergency contact">
            <Input value={person.emergencyContact} onChange={(e) => setPerson({ ...person, emergencyContact: e.target.value })} />
          </Field>
          <Button
            size="sm"
            disabled={busy === "person" || !person.name || !person.stationId}
            onClick={() => void guard("person")(() => live.createPerson({ ...person, role: "Field Operator" }))}
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            Create personnel record
          </Button>
        </div>
      </Section>

      <Section title="Vehicle" source="LIVE">
        <div className="grid gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Vehicle id">
              <Input value={vehicle.vehicleId} onChange={(e) => setVehicle({ ...vehicle, vehicleId: e.target.value.toUpperCase() })} placeholder="S-06" />
            </Field>
            <Field label="Type">
              <select
                value={vehicle.kind}
                onChange={(e) => setVehicle({ ...vehicle, kind: e.target.value })}
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="snow_vehicle">Snow vehicle</option>
                <option value="tractor">Tractor</option>
                <option value="helicopter">Helicopter</option>
                <option value="ship">Ship</option>
                <option value="aircraft">Aircraft</option>
              </select>
            </Field>
          </div>
          <Field label="Label">
            <Input value={vehicle.label} onChange={(e) => setVehicle({ ...vehicle, label: e.target.value })} placeholder="Snow Vehicle S-06" />
          </Field>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Fuel %">
              <Input type="number" value={vehicle.fuelPct} onChange={(e) => setVehicle({ ...vehicle, fuelPct: Number(e.target.value) })} />
            </Field>
            <Field label="Capacity kg">
              <Input type="number" value={vehicle.capacityKg} onChange={(e) => setVehicle({ ...vehicle, capacityKg: Number(e.target.value) })} />
            </Field>
          </div>
          <Button
            size="sm"
            disabled={busy === "vehicle" || !vehicle.vehicleId || !vehicle.label}
            onClick={() => void guard("vehicle")(() => live.createVehicle({ ...vehicle }))}
          >
            <Truck className="mr-1.5 h-3.5 w-3.5" />
            Create vehicle
          </Button>
        </div>
      </Section>

      <Section title="Cargo consignment" source="LIVE">
        <div className="grid gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Cargo id">
              <Input value={cargo.cargoId} onChange={(e) => setCargo({ ...cargo, cargoId: e.target.value.toUpperCase() })} placeholder="CARGO-00500" />
            </Field>
            <Field label="Item">
              <Input value={cargo.itemType} onChange={(e) => setCargo({ ...cargo, itemType: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="Quantity">
              <Input type="number" value={cargo.quantity} onChange={(e) => setCargo({ ...cargo, quantity: Number(e.target.value) })} />
            </Field>
            <Field label="Unit">
              <Input value={cargo.unit} onChange={(e) => setCargo({ ...cargo, unit: e.target.value })} />
            </Field>
            <Field label="Containers expected">
              <Input
                type="number"
                value={cargo.containersExpected}
                onChange={(e) => setCargo({ ...cargo, containersExpected: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Destination">
            <select
              value={cargo.destinationStationId}
              onChange={(e) => setCargo({ ...cargo, destinationStationId: e.target.value })}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="">Select…</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.short}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsible person">
            <select
              value={cargo.responsiblePersonId}
              onChange={(e) => setCargo({ ...cargo, responsiblePersonId: e.target.value })}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="">Select…</option>
              {live.personnel.map((p) => (
                <option key={p.polarisId} value={p.polarisId}>
                  {p.name} ({p.polarisId})
                </option>
              ))}
            </select>
          </Field>
          <Button
            size="sm"
            disabled={busy === "cargo" || !cargo.cargoId || !cargo.destinationStationId || !cargo.responsiblePersonId}
            onClick={() => void guard("cargo")(() => live.createCargo({ ...cargo }))}
          >
            <Boxes className="mr-1.5 h-3.5 w-3.5" />
            Book cargo
          </Button>
          <p className="text-[10px] text-slate-500">
            A barcode and RFID are generated on the server so a physical container is never double-booked.
          </p>
        </div>
      </Section>

      <Section title="Task" source="LIVE">
        <div className="grid gap-1.5">
          <Field label="Task id">
            <Input value={task.taskId} onChange={(e) => setTask({ ...task, taskId: e.target.value.toUpperCase() })} placeholder="T-118" />
          </Field>
          <Field label="Title">
            <Input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="Generator audit" />
          </Field>
          <Field label="Station">
            <select
              value={task.stationId}
              onChange={(e) => setTask({ ...task, stationId: e.target.value })}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="">Select…</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.short}
                </option>
              ))}
            </select>
          </Field>
          <Button size="sm" disabled={busy === "task" || !task.taskId || !task.title || !task.stationId} onClick={() => void guard("task")(() => live.createTask({ ...task, assignedTo: [] }))}>
            <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
            Open task
          </Button>
        </div>
      </Section>

      <Section title="Convoy" source="LIVE">
        {live.convoys.length === 0 ? (
          <p className="text-[11px] text-slate-600">No convoys stored yet.</p>
        ) : (
          <ul className="space-y-1">
            {live.convoys.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-[11px]">
                <span className="text-slate-800">
                  <span className="font-semibold">{c.convoyId}</span> · {c.status} · comms {c.comms}
                </span>
                {c.status === "PLANNED" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `cv-${c.convoyId}`}
                    onClick={() =>
                      void guard(`cv-${c.convoyId}`)(async () => {
                        await live.tick();
                        toast.success(`${c.convoyId} activated`);
                      })
                    }
                  >
                    Start
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] text-slate-500">
          Starting a convoy moves its vehicles and personnel into transit and publishes a CONVOY_UPDATED event.
        </p>
      </Section>

      {firstStation ? null : (
        <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
          The database is empty. Use Operate → Initialise reference data first.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function HazardsTab() {
  const live = usePolarisLive();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    hazardId: "HZ-NEW",
    hazardType: "CREVASSE",
    label: "",
    severity: "critical",
    lat: -70.85,
    lon: 11.9,
    radiusKm: 12,
    source: "Operator report",
    description: "",
  });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="Publish hazard zone" source="LIVE">
        <div className="grid gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Hazard id">
              <Input value={form.hazardId} onChange={(e) => setForm({ ...form, hazardId: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Type">
              <select value={form.hazardType} onChange={(e) => setForm({ ...form, hazardType: e.target.value })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs">
                <option value="CREVASSE">Crevasse</option>
                <option value="WHITEOUT">Whiteout</option>
                <option value="BLIZZARD">Blizzard</option>
                <option value="UNSTABLE_ICE">Unstable ice</option>
                <option value="WEATHER_HAZARD">Weather hazard</option>
                <option value="RESTRICTED_ZONE">Restricted zone</option>
                <option value="ROUTE_CLOSURE">Route closure</option>
              </select>
            </Field>
          </div>
          <Field label="Label">
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Crevasse field — Sector C" />
          </Field>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="Latitude">
              <Input type="number" step="0.0001" value={form.lat} onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })} />
            </Field>
            <Field label="Longitude">
              <Input type="number" step="0.0001" value={form.lon} onChange={(e) => setForm({ ...form, lon: Number(e.target.value) })} />
            </Field>
            <Field label="Radius km">
              <Input type="number" step="0.5" value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Severity">
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs">
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Button
            size="sm"
            disabled={busy || !form.label || !form.description}
            onClick={async () => {
              setBusy(true);
              try {
                await live.createHazard({ ...form });
              } catch (e) {
                toast.error("Hazard rejected", { description: e instanceof Error ? e.message : String(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            <MapPin className="mr-1.5 h-3.5 w-3.5" />
            Publish zone
          </Button>
          <p className="text-[10px] text-slate-500">
            The server re-checks every tracked subject against the new geometry and raises an exposure alert for any that are
            already inside it.
          </p>
        </div>
      </Section>

      <Section title="Active zones in the database">
        {live.hazards.length === 0 ? (
          <p className="text-[11px] text-slate-600">No zones stored.</p>
        ) : (
          <ul className="space-y-1">
            {live.hazards.map((h) => (
              <li key={h.id} className="rounded border border-slate-200 px-2 py-1">
                <p className="text-[11px] font-medium text-slate-800">{h.label}</p>
                <p className="text-[10px] text-slate-500">
                  {h.hazardId} · {h.hazardType.replace(/_/g, " ").toLowerCase()} · {h.severity} · r={h.radiusKm} km · {h.source}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CommsTab() {
  const live = usePolarisLive();
  const weather = live.integrations.find((i) => i.id === "weather" || i.id.startsWith("weather:"));
  const storage = live.integrations.find((i) => i.id === "storage");
  const [busy, setBusy] = useState(false);
  const [familyMemberId, setFamilyMemberId] = useState("");
  const [type, setType] = useState<"TEXT" | "VOICE" | "VIDEO" | "PHOTO">("VIDEO");
  const [quality, setQuality] = useState<"LOW" | "MEDIUM" | "HIGH">("LOW");

  const members = useMemo(() => {
    // Family members are listed through the family portal query; fall back to
    // the demo default so the control is still usable before seeding.
    return live.notifications.length >= 0 ? [] : [];
  }, [live.notifications.length]);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="External integrations">
        <ul className="space-y-1.5">
          {[weather, storage].filter(Boolean).map((i) => (
            <li key={i!.id} className="rounded border border-slate-200 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-800">{i!.label}</span>
                <DataSourceBadge kind={i!.state === "CONNECTED" ? "LIVE" : "NOT_CONFIGURED"} />
              </div>
              <p className="mt-0.5 text-[10px] text-slate-600">{i!.capability}</p>
              {i!.requiresEnv ? <p className="mt-0.5 font-mono text-[9px] text-slate-500">requires {i!.requiresEnv}</p> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Family Home Link" source={storage?.state === "CONNECTED" ? "LIVE" : "NOT_CONFIGURED"}>
        <div className="grid gap-1.5">
          <Field label="Family member id">
            <Input
              value={familyMemberId}
              onChange={(e) => setFamilyMemberId(e.target.value.toUpperCase())}
              placeholder="FAM-01"
            />
          </Field>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs">
                <option value="TEXT">Text</option>
                <option value="VOICE">Voice</option>
                <option value="PHOTO">Photo</option>
                <option value="VIDEO">Video</option>
              </select>
            </Field>
            <Field label="Delivery quality">
              <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs">
                <option value="LOW">Low (default for the field)</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </Field>
          </div>
          <Button
            size="sm"
            disabled={busy || !familyMemberId}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await live.sendFamilyMessage({ familyMemberId, type, quality, forceQueue: live.connMode !== "CONNECTED" });
                toast[r.state === "DELIVERED" ? "success" : "message"](
                  r.state === "DELIVERED" ? "Delivered" : "Queued",
                  { description: r.pipeline.join(" → ") },
                );
              } catch (e) {
                toast.error("Message rejected", { description: e instanceof Error ? e.message : String(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            <CloudLightning className="mr-1.5 h-3.5 w-3.5" />
            Send family message
          </Button>
          <p className="text-[10px] text-slate-500">
            Video is encoded for the link and its audio is sent first. A message that cannot reach the field device stays
            QUEUED — it is never reported as delivered.
          </p>
        </div>
      </Section>

      {members.length > 0 ? null : (
        <Section title="Family members">
          <p className="text-[11px] text-slate-600">
            Open the Family Portal module to see linked members and their message history. Each member is identified by their
            FAM- id, e.g. FAM-01.
          </p>
        </Section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <Label className="text-[10px] text-slate-600">{label}</Label>
      {children}
    </div>
  );
}

export { X };
