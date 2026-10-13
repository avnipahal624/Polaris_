/**
 * HOME LINK views — control-room operations (status only), family portal
 * (privacy-first), well-being check-in, and the aggregate well-being panel.
 *
 * Design language: same polar glass system, mission-critical but calm.
 * Never social-network styling.
 */
import { useState } from "react";
import {
  CheckCircle2,
  Heart,
  Lock,
  Pause,
  Play,
  Radio,
  Send,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOps } from "@/lib/ops-store";
import {
  CHECKIN_OPTIONS,
  FAMILY_MOMENTS,
  FAMILY_PORTAL_EXCLUDES,
  FUTURE_ENVIRONMENTS,
  HOME_LINK_PRIORITY,
  HOME_LINK_SECURITY,
  MEMORY_CAPSULE,
  MESSAGE_FLOW,
  MESSAGE_KINDS,
  SEED_MESSAGES,
  SUPPORT_ROUTES,
  WINTER_SUPPORT_WINDOW,
  deliveryRecommendation,
  mediaPipeline,
  wellBeingAggregate,
  type MediaQuality,
  type MessageKind,
  type MessageState,
} from "@/lib/homelink";

const card = "rounded-xl border border-white/10 bg-white/[0.06] backdrop-blur-md";

const STATE_TONE: Record<MessageState, string> = {
  DRAFT: "bg-white/10 text-sky-200/70",
  QUEUED: "bg-amber-500/15 text-amber-300",
  COMPRESSING: "bg-sky-500/15 text-sky-300",
  "WAITING FOR CONNECTIVITY": "bg-amber-500/15 text-amber-300",
  TRANSMITTING: "bg-sky-500/25 text-sky-200 animate-pulse",
  DELIVERED: "bg-emerald-500/15 text-emerald-300",
  OPENED: "bg-emerald-500/20 text-emerald-200",
};

function StateChip({ state }: { state: MessageState }) {
  return <span className={cn("rounded px-2 py-0.5 text-[9px] font-extrabold whitespace-nowrap", STATE_TONE[state])}>{state}</span>;
}

function FlowStrip({ state }: { state: MessageState }) {
  const idx = MESSAGE_FLOW.indexOf(state);
  return (
    <div className="flex items-center gap-1">
      {MESSAGE_FLOW.map((s, i) => (
        <span key={s} title={s} className={cn("h-1.5 flex-1 rounded-full", i <= idx ? "bg-sky-400" : "bg-white/15")} />
      ))}
    </div>
  );
}

/* ================================================================== */
/* CONTROL ROOM — HOME LINK OPERATIONS (status only, never content)     */
/* ================================================================== */

export function HomeLinkOpsModule() {
  const { connMode, goto } = useOps();
  const [quality, setQuality] = useState<MediaQuality>("LOW");
  const waiting = SEED_MESSAGES.filter((m) => m.state === "WAITING FOR CONNECTIVITY" || m.state === "QUEUED");
  const rec = deliveryRecommendation(waiting.map((w) => ({ id: w.id, kind: w.kind, from: w.from })), connMode === "NORMAL" ? "high" : connMode === "WEAK" ? "medium" : "low");
  const counts = {
    queued: SEED_MESSAGES.filter((m) => m.state === "QUEUED" || m.state === "WAITING FOR CONNECTIVITY" || m.state === "COMPRESSING").length,
    delivered: SEED_MESSAGES.filter((m) => m.state === "DELIVERED" || m.state === "OPENED").length,
    transmitting: SEED_MESSAGES.filter((m) => m.state === "TRANSMITTING").length,
  };

  return (
    <section className="space-y-3">
      <header>
        <h2 className="flex items-center gap-2 text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">
          <Heart className="h-4 w-4 text-rose-300" /> HOME LINK OPERATIONS
        </h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">
          “Stay connected, even when the signal can't.” · Asynchronous family messages designed for polar connectivity · Delivery status only — content is end-to-end encrypted and never visible here
        </p>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-2">
        <Kpi label="Queued" value={counts.queued} tone="text-amber-300" />
        <Kpi label="Delivered" value={counts.delivered} tone="text-emerald-300" />
        <Kpi label="Transmitting" value={counts.transmitting} tone="text-sky-300" />
        <Kpi label="Waiting" value={waiting.length} tone="text-amber-300" />
      </div>

      {/* Intelligence recommendation */}
      <div className={cn(card, "p-3")}>
        <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">POLAR INTELLIGENCE — delivery scheduling</p>
        <p className="mt-1 text-[11.5px] font-semibold text-sky-100/85">{rec}</p>
        <p className="mt-1.5 text-[9.5px] font-bold text-emerald-300/90">Family traffic is P4 — emergency channel (P0–P1) always has priority.</p>
      </div>

      {/* Quality selector + pipeline */}
      <div className={cn(card, "p-3")}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Bandwidth-aware media</p>
          <div className="ml-auto flex gap-1.5">
            {(["LOW", "MEDIUM", "HIGH"] as MediaQuality[]).map((q) => (
              <button key={q} type="button" onClick={() => setQuality(q)} className={cn("rounded-full px-2.5 py-1 text-[10px] font-extrabold", quality === q ? "bg-sky-500 text-white" : "bg-white/10 text-sky-200/80 hover:bg-white/20")}>
                {q}
              </button>
            ))}
            <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[9px] font-bold text-amber-300">field default: LOW</span>
          </div>
        </div>
        <Pipeline kind="SHORT VIDEO" quality={quality} />
      </div>

      {/* Message flow list */}
      <div className="space-y-1.5">
        {SEED_MESSAGES.map((m) => (
          <div key={m.id} className={cn(card, "px-3 py-2.5")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[8.5px] font-extrabold", m.direction === "family→field" ? "bg-rose-500/15 text-rose-300" : "bg-sky-500/15 text-sky-300")}>
                {m.direction === "family→field" ? "HOME → FIELD" : "FIELD → HOME"}
              </span>
              <p className="text-[11.5px] font-extrabold text-white">{m.kind}</p>
              <StateChip state={m.state} />
              {m.quality === "LOW" && m.kind === "SHORT VIDEO" && m.state !== "OPENED" && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[8.5px] font-bold text-emerald-300">audio available now · video pending sync</span>}
              <span className="ml-auto text-[9.5px] font-bold text-sky-200/50">{m.ageMinutes < 60 ? `${m.ageMinutes} min ago` : `${Math.round(m.ageMinutes / 60)} h ago`}</span>
            </div>
            <p className="mt-0.5 truncate text-[10.5px] font-semibold text-sky-200/60">
              {m.from} → {m.to} · {m.duration ? `${m.duration} · ` : ""}content encrypted (status only)
            </p>
            <div className="mt-1.5"><FlowStrip state={m.state} /></div>
          </div>
        ))}
      </div>

      {/* Architecture + security */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className={cn(card, "p-3")}>
          <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Delivery chain</p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed font-semibold text-sky-100/80">
            FAMILY → MESSAGE/VIDEO/VOICE → COMPRESSION → ENCRYPTION → OFFLINE QUEUE → BANDWIDTH-AWARE PRIORITIZATION → SATELLITE / AVAILABLE CONNECTION → FIELD DEVICE → LOCAL DELIVERY
          </p>
        </div>
        <div className={cn(card, "p-3")}>
          <p className="flex items-center gap-1.5 text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase"><ShieldCheck className="h-3 w-3" /> Security model</p>
          <ul className="mt-1.5 space-y-0.5">
            {HOME_LINK_SECURITY.map((s) => (
              <li key={s} className="flex gap-1.5 text-[10px] text-sky-100/75"><span className="text-emerald-400">✓</span>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Well-being aggregate + winter window */}
      <WellBeingAggregateCard />
      <WinterWindowCard />

      {/* Future environments */}
      <div className={cn(card, "p-3")}>
        <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Future deployment environments (architecture extensible — not currently deployed)</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {FUTURE_ENVIRONMENTS.map((f) => (
            <span key={f} className="rounded-full bg-white/10 px-2.5 py-1 text-[9.5px] font-bold text-sky-100/75">{f}</span>
          ))}
        </div>
      </div>

      <Button variant="ghost" size="sm" className="h-7 text-[10.5px] text-sky-200" onClick={() => goto("field")}>
        Open Field Safety Mode (includes HOME LINK)
      </Button>
    </section>
  );
}

function Pipeline({ kind, quality }: { kind: MessageKind; quality: MediaQuality }) {
  const p = mediaPipeline(kind, quality);
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[9.5px] font-bold">
        <span className="rounded bg-white/10 px-2 py-0.5 text-sky-200/80">{p.original}</span>
        {p.steps.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="text-sky-400/60">→</span>
            <span className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-200">{s}</span>
          </span>
        ))}
      </div>
      {p.audioFirst && <p className="mt-1.5 text-[9.5px] font-bold text-emerald-300/90">Audio-first enabled at LOW quality — “Audio available now” · “Video pending synchronization”.</p>}
      <p className="mt-1 text-[9.5px] font-semibold text-sky-200/50">{p.note} · estimated transfer ≈ {p.estimatedKb} KB</p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={cn(card, "px-3 py-2")}>
      <p className={cn("text-lg leading-none font-extrabold", tone)}>{value}</p>
      <p className="mt-1 text-[8.5px] font-bold tracking-wide text-sky-200/60 uppercase">{label}</p>
    </div>
  );
}

/* ================================================================== */
/* WELL-BEING (aggregate control-room + private check-in)               */
/* ================================================================== */

function WellBeingAggregateCard() {
  const agg = wellBeingAggregate();
  return (
    <div className={cn(card, "p-3")}>
      <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Team well-being — aggregate indicators only</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Agg k="Check-ins completed" v={agg.checkins} />
        <Agg k="Optional support requests" v={String(agg.supportRequests)} />
        <Agg k="Family communication backlog" v={String(agg.familyBacklog)} />
        <Agg k="Connectivity disruptions" v={String(agg.connectivityDisruptions)} />
      </div>
      <p className="mt-2 text-[9.5px] font-semibold text-sky-200/50">
        Purpose is operational support, not surveillance. Private family content and individual emotional responses are never shown to the control room. No diagnosis — POLARIS is not a clinical system.
      </p>
    </div>
  );
}

function Agg({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-black/20 px-2.5 py-1.5">
      <p className="text-[13px] font-extrabold text-white">{v}</p>
      <p className="text-[8.5px] font-bold tracking-wide text-sky-200/60 uppercase">{k}</p>
    </div>
  );
}

export function WinterWindowCard() {
  return (
    <div className={cn(card, "border-sky-400/25 p-3")}>
      <p className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-widest text-sky-200 uppercase"><Pause className="h-3.5 w-3.5" /> {WINTER_SUPPORT_WINDOW.title}</p>
      <p className="mt-1.5 text-[10.5px] leading-relaxed font-semibold text-sky-100/80">{WINTER_SUPPORT_WINDOW.basis}</p>
      <p className="mt-1.5 text-[10.5px] font-bold text-sky-200">Extended isolation period detected — consider:</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {WINTER_SUPPORT_WINDOW.suggestions.map((s) => (
          <li key={s} className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[9.5px] font-bold text-emerald-300">✓ {s}</li>
        ))}
      </ul>
    </div>
  );
}

/* ================================================================== */
/* FAMILY PORTAL — what the family sees (nothing operational)           */
/* ================================================================== */

export function FamilyPortalModule() {
  const [compose, setCompose] = useState<MessageKind | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const outbound = SEED_MESSAGES.filter((m) => m.direction === "family→field");
  const replies = SEED_MESSAGES.filter((m) => m.direction === "field→family");

  const send = (kind: MessageKind) => {
    setCompose(null);
    setSent(`Your ${kind.toLowerCase()} is queued — it will be delivered when the expedition link next synchronizes. Emergency traffic always has priority.`);
  };

  return (
    <section className="space-y-3">
      <header>
        <h2 className="flex items-center gap-2 text-[15px] leading-none font-extrabold tracking-wide text-white uppercase">
          <Heart className="h-4 w-4 text-rose-300" /> POLARIS HOME — Family Portal
        </h2>
        <p className="mt-1 text-[10.5px] font-semibold text-sky-200/75">Asynchronous family messages designed for polar connectivity — no live access, no operational data</p>
      </header>

      <div className={cn(card, "p-4")}>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[9.5px] font-bold tracking-widest text-sky-200/60 uppercase">Connected to</p>
            <p className="text-[13px] font-extrabold text-white">Expedition Member — Arjun Nair</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[9.5px] font-bold tracking-widest text-sky-200/60 uppercase">Status</p>
            <p className="text-[11.5px] font-bold text-sky-200">Last communication synchronized 3 hours ago</p>
            <p className="text-[10px] font-semibold text-amber-300">Waiting for next synchronization</p>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <ComposeBtn icon="🎥" label="Record Video" note="auto-compressed" onClick={() => setCompose("SHORT VIDEO")} />
          <ComposeBtn icon="🎙" label="Record Voice" note="delivers first" onClick={() => setCompose("VOICE MESSAGE")} />
          <ComposeBtn icon="✉" label="Send Text" note="always deliverable" onClick={() => setCompose("TEXT MESSAGE")} />
        </div>
        <p className="mt-2 text-[10.5px] font-semibold text-sky-200/60">Your message will be delivered when connectivity becomes available — not instantly.</p>

        {compose && (
          <div className="mt-2.5 rounded-lg bg-black/20 p-2.5">
            <p className="text-[10px] font-extrabold tracking-widest text-sky-200/60 uppercase">Compose — {compose}</p>
            <div className="mt-1.5 flex gap-2">
              <Input placeholder={compose === "TEXT MESSAGE" ? "Type your message…" : "Optional note with the recording…"} className="h-8 border-white/20 bg-white/10 text-[12px] font-semibold text-white placeholder:text-sky-200/40" />
              <Button size="sm" className="h-8 bg-rose-400 text-[10.5px] font-extrabold text-slate-900 hover:bg-rose-300" onClick={() => send(compose)}>
                <Send className="mr-1 h-3 w-3" /> Send
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-[10.5px]" onClick={() => setCompose(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {sent && <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-300">{sent}</p>}
      </div>

      {/* Quick message types */}
      <div className={cn(card, "p-3")}>
        <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Quick send</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {MESSAGE_KINDS.filter((k) => k.kind !== "SHORT VIDEO" && k.kind !== "VOICE MESSAGE" && k.kind !== "TEXT MESSAGE").map((k) => (
            <button key={k.kind} type="button" onClick={() => send(k.kind)} className="rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-2 text-left hover:bg-white/10">
              <p className="text-[13px]">{k.icon}</p>
              <p className="text-[10px] font-extrabold text-white">{k.kind}</p>
              <p className="text-[8.5px] font-semibold text-sky-200/60">{k.note}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Previous messages */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className={cn(card, "p-3")}>
          <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Messages you sent</p>
          <div className="mt-2 space-y-1.5">
            {outbound.map((m) => (
              <div key={m.id} className="rounded-lg bg-black/20 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-extrabold text-white">{m.from}</p>
                  <StateChip state={m.state} />
                  {m.state === "WAITING FOR CONNECTIVITY" && <span className="ml-auto text-[9px] font-bold text-amber-300">Queued locally — waiting for available communication</span>}
                </div>
                <p className="mt-0.5 text-[10.5px] text-sky-100/75">{m.preview}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={cn(card, "p-3")}>
          <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Replies from the expedition</p>
          <div className="mt-2 space-y-1.5">
            {replies.map((m) => (
              <div key={m.id} className="rounded-lg bg-black/20 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-extrabold text-white">{m.from}</p>
                  <StateChip state={m.state} />
                </div>
                <p className="mt-0.5 text-[10.5px] text-sky-100/75">{m.preview}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Family Moments */}
      <div className={cn(card, "p-3")}>
        <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Family Moments — small asynchronous activities</p>
        <div className="mt-2 space-y-1.5">
          {FAMILY_MOMENTS.map((fm) => (
            <div key={fm.id} className="rounded-lg bg-black/20 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-extrabold text-white">{fm.prompt}</p>
                <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[8.5px] font-extrabold", fm.state === "RESPONDED" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>{fm.state}</span>
              </div>
              <p className="text-[9.5px] font-semibold text-sky-200/60">from {fm.from}{fm.responses.length > 0 ? ` · reply: “${fm.responses[0].text}” (${fm.responses[0].when})` : ""}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9.5px] font-semibold text-sky-200/50">Create a moment: “Guess what we cooked today?” · “Send us one thing you saw today.” · “Record a message for everyone at home.”</p>
      </div>

      {/* Memory Capsule */}
      <div className={cn(card, "p-3")}>
        <p className="text-[9.5px] font-extrabold tracking-widest text-sky-200/60 uppercase">Memory Capsule — “From Home” · {MEMORY_CAPSULE.length} memories waiting</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {MEMORY_CAPSULE.map((c) => (
            <div key={c.id} className="rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-2">
              <p className="text-[9px] font-extrabold tracking-wide text-sky-300 uppercase">{c.type}</p>
              <p className="truncate text-[10.5px] font-bold text-white">{c.title}</p>
              <p className="text-[8.5px] font-semibold text-sky-200/60">{c.by} · {c.size}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Privacy promise */}
      <div className={cn(card, "flex flex-wrap items-start gap-3 p-3")}>
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <div>
          <p className="text-[10.5px] font-extrabold text-white">Privacy & operational security</p>
          <p className="mt-0.5 text-[10px] font-semibold text-sky-200/70">The family portal never shows: {FAMILY_PORTAL_EXCLUDES.join(" · ")}.</p>
          <p className="text-[10px] font-semibold text-sky-200/50">Control-room staff see delivery status only — never message content.</p>
        </div>
      </div>
    </section>
  );
}

function ComposeBtn({ icon, label, note, onClick }: { icon: string; label: string; note: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/[0.07] px-3 py-3 hover:bg-white/10 active:scale-[0.98]">
      <span className="text-xl">{icon}</span>
      <span className="text-[11.5px] font-extrabold text-white">{label}</span>
      <span className="text-[9px] font-semibold text-sky-200/60">{note}</span>
    </button>
  );
}

/* ================================================================== */
/* PRIVATE WELL-BEING CHECK-IN (voluntary, non-diagnostic)              */
/* ================================================================== */

export function WellBeingCheckIn({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [routed, setRouted] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-[#081c33]/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/15 bg-[#10305a]/95 p-5 text-white shadow-2xl">
        <div>
          <p className="text-[13px] font-extrabold tracking-wide uppercase">Well-being check-in</p>
          <p className="mt-0.5 text-[10.5px] font-semibold text-sky-200/70">Private & voluntary · a self-check, never a diagnosis · nothing here labels or reports you</p>
        </div>

        {!picked && (
          <>
            <p className="text-[13px] font-bold">How are you feeling today?</p>
            <div className="grid grid-cols-2 gap-2">
              {CHECKIN_OPTIONS.map((o) => (
                <button key={o.label} type="button" onClick={() => setPicked(o.label)} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/[0.07] active:scale-[0.98]">
                  <span className="text-2xl">{o.emoji}</span>
                  <span className="text-[12px] font-extrabold">{o.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {picked && !routed && (
          <>
            <p className="text-[13px] font-bold">Thank you — noted privately{picked === "Struggling" || picked === "Low" ? ". That sounds like a hard stretch — support is available if you want it." : "."}</p>
            <p className="text-[11px] font-semibold text-sky-200/70">Want to connect with someone?</p>
            <div className="space-y-1.5">
              {SUPPORT_ROUTES.map((r) => (
                <button key={r.id} type="button" onClick={() => setRouted(r.label)} className="w-full rounded-xl border border-white/15 bg-white/[0.07] px-3 py-3 text-left hover:bg-white/10">
                  <p className="text-[12px] font-extrabold">{r.label}</p>
                  <p className="text-[10px] font-semibold text-sky-200/65">{r.note}</p>
                </button>
              ))}
              <button type="button" onClick={onClose} className="w-full rounded-xl px-3 py-2 text-[11px] font-bold text-sky-200/70 hover:bg-white/10">
                No thanks — just logging my check-in
              </button>
            </div>
            <p className="text-[9.5px] font-semibold text-sky-200/50">If support is requested, only that fact is shared with the chosen route — not how you feel.</p>
          </>
        )}

        {routed && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-[12px] font-extrabold text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Request sent to {routed}</p>
            <p className="text-[11px] font-semibold text-sky-200/75">They will reach out through the station channel. Your responses stay private.</p>
            <Button size="sm" className="h-8 w-full bg-sky-500 text-[11px] font-extrabold hover:bg-sky-600" onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </div>
  );
}
