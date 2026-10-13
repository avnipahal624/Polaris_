/**
 * POLARIS HOME LINK — asynchronous family connection for polar connectivity.
 *
 * "Stay connected, even when the signal can't."
 *
 * NOT video calling. Store-and-forward asynchronous messaging engineered for
 * intermittent, delayed and extremely low-bandwidth links, wired into the same
 * connectivity engine and priority queue as every other POLARIS subsystem.
 *
 * Privacy is architectural: family content is never exposed to the control
 * room; expedition operational data is never exposed to the family portal.
 */
import { PRIORITY_META } from "./safety";

/* ------------------------------------------------------------------ */
/* Message lifecycle                                                   */
/* ------------------------------------------------------------------ */

export type MessageState =
  | "DRAFT"
  | "QUEUED"
  | "COMPRESSING"
  | "WAITING FOR CONNECTIVITY"
  | "TRANSMITTING"
  | "DELIVERED"
  | "OPENED";

export const MESSAGE_FLOW: MessageState[] = [
  "DRAFT",
  "QUEUED",
  "COMPRESSING",
  "WAITING FOR CONNECTIVITY",
  "TRANSMITTING",
  "DELIVERED",
  "OPENED",
];

export type MessageKind =
  | "SHORT VIDEO"
  | "VOICE MESSAGE"
  | "TEXT MESSAGE"
  | "PHOTO + TEXT"
  | "ENCOURAGEMENT CARD"
  | "BIRTHDAY / FESTIVAL"
  | "WE MISS YOU"
  | "FAMILY MESSAGE";

export const MESSAGE_KINDS: { kind: MessageKind; icon: string; note: string }[] = [
  { kind: "SHORT VIDEO", icon: "🎥", note: "Auto-compressed before transmission" },
  { kind: "VOICE MESSAGE", icon: "🎙", note: "Smallest media payload — delivers first" },
  { kind: "TEXT MESSAGE", icon: "✉", note: "Tiny payload, always deliverable" },
  { kind: "PHOTO + TEXT", icon: "📷", note: "Photo downscaled to link quality" },
  { kind: "ENCOURAGEMENT CARD", icon: "💛", note: "Predefined cards, near-zero bandwidth" },
  { kind: "BIRTHDAY / FESTIVAL", icon: "🎂", note: "Scheduled for the right day at the station" },
  { kind: "WE MISS YOU", icon: "🫶", note: "Quick one-tap message" },
  { kind: "FAMILY MESSAGE", icon: "✍", note: "Free-form message from the family portal" },
];

/* ------------------------------------------------------------------ */
/* Priority model (extends the operational ladder, never above safety) */
/* ------------------------------------------------------------------ */

export const HOME_LINK_PRIORITY = {
  level: "P4",
  meta: PRIORITY_META[4],
  rule: "Family messages are P4 — they NEVER preempt P0–P3. Emergency channel has priority.",
  order: [
    { p: "P0", label: "SOS / critical emergency" },
    { p: "P1", label: "Personnel safety / active mission communication" },
    { p: "P2", label: "Hazard / location / convoy information" },
    { p: "P3", label: "Cargo / inventory / transport" },
    { p: "P4", label: "Family messages / non-critical communication" },
    { p: "P5", label: "Analytics / large media / non-critical files" },
  ] as { p: string; label: string }[],
};

/* ------------------------------------------------------------------ */
/* Bandwidth-aware media pipeline                                      */
/* ------------------------------------------------------------------ */

export type MediaQuality = "LOW" | "MEDIUM" | "HIGH";
export const DEFAULT_QUALITY: MediaQuality = "LOW";

export interface MediaPipeline {
  original: string;
  steps: string[];
  audioFirst: boolean;
  estimatedKb: number;
  note: string;
}

/** Conceptual encoding plan shown in the UI — no real transcoding in the demo. */
export function mediaPipeline(kind: MessageKind, quality: MediaQuality): MediaPipeline {
  if (kind === "SHORT VIDEO") {
    return {
      original: "Original video (~24 MB · 30 s)",
      steps:
        quality === "LOW"
          ? ["LOW-BANDWIDTH ENCODE (240p, mono)", "COMPRESSED VERSION (~380 KB)", "PRIORITY QUEUE (P4)", "AVAILABLE CONNECTION", "TRANSMISSION"]
          : quality === "MEDIUM"
            ? ["MEDIUM ENCODE (360p)", "COMPRESSED VERSION (~900 KB)", "PRIORITY QUEUE (P4)", "AVAILABLE CONNECTION", "TRANSMISSION"]
            : ["HIGH ENCODE (720p, kept for archive)", "COMPRESSED VERSION (~2.4 MB)", "PRIORITY QUEUE (P4)", "AVAILABLE CONNECTION", "TRANSMISSION"],
      audioFirst: quality === "LOW",
      estimatedKb: quality === "LOW" ? 380 : quality === "MEDIUM" ? 900 : 2400,
      note:
        quality === "LOW"
          ? "Audio extracted and sent first — “Audio available now”, “Video pending synchronization”."
          : "Single-pass delivery when the link allows.",
    };
  }
  if (kind === "VOICE MESSAGE") return { original: "Voice note (~180 KB · 30 s)", steps: ["OPUS ENCODE (16 kbps)", "COMPRESSED VERSION (~60 KB)", "PRIORITY QUEUE (P4)", "AVAILABLE CONNECTION", "TRANSMISSION"], audioFirst: false, estimatedKb: 60, note: "Voice delivers on the weakest usable link." };
  if (kind === "PHOTO + TEXT") return { original: "Photo + caption (~3.2 MB)", steps: ["DOWNSCALE to link quality", "COMPRESSED VERSION (~120 KB)", "PRIORITY QUEUE (P4)", "AVAILABLE CONNECTION", "TRANSMISSION"], audioFirst: false, estimatedKb: 120, note: "Photos re-encoded per device link class." };
  return { original: "Text payload (<2 KB)", steps: ["PLAINTEXT-ONLY METADATA STRIPPED", "PRIORITY QUEUE (P4)", "AVAILABLE CONNECTION", "TRANSMISSION"], audioFirst: false, estimatedKb: 2, note: "Text always fits any window." };
}

/** POLAR INTELLIGENCE delivery suggestion for a connectivity window. */
export function deliveryRecommendation(waiting: { id: string; kind: MessageKind; from: string }[], capacity: "low" | "medium" | "high"): string {
  if (waiting.length === 0) return "No family messages waiting.";
  const voice = waiting.filter((w) => w.kind === "VOICE MESSAGE").length;
  const video = waiting.filter((w) => w.kind === "SHORT VIDEO").length;
  const text = waiting.length - voice - video;
  if (capacity === "low")
    return `Connectivity window detected. ${waiting.length} family message${waiting.length === 1 ? "" : "s"} waiting. Estimated transfer capacity: low. POLARIS recommends transmitting ${Math.min(text + voice, 2 + voice) || 2} voice/message${voice === 1 ? "" : "s"} now and deferring ${video} video${video === 1 ? "" : "s"}. Human approval available for any operational exception.`;
  if (capacity === "medium")
    return `Connectivity window detected — medium capacity. Sending all text and voice now (${text + voice}); ${video} compressed video${video === 1 ? "" : "s"} scheduled for the next window.`;
  return `Connectivity window detected — high capacity. Full delivery of all ${waiting.length} waiting message${waiting.length === 1 ? "" : "s"} including video.`;
}

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

export interface HomeLinkMessage {
  id: string;
  direction: "family→field" | "field→family";
  from: string;
  to: string;
  kind: MessageKind;
  preview: string;
  duration?: string;
  state: MessageState;
  quality?: MediaQuality;
  audioFirstDone?: boolean;
  ageMinutes: number;
  stationId: string;
}

export const SEED_MESSAGES: HomeLinkMessage[] = [
  {
    id: "hl-001",
    direction: "family→field",
    from: "Mom",
    to: "Arjun Nair (Bharati)",
    kind: "TEXT MESSAGE",
    preview: "Thinking of you. Stay safe. ❤️",
    state: "OPENED",
    ageMinutes: 214,
    stationId: "bharati",
  },
  {
    id: "hl-002",
    direction: "family→field",
    from: "Sister — Diya",
    to: "Arjun Nair (Bharati)",
    kind: "VOICE MESSAGE",
    preview: "“Good luck with the expedition! We are so proud of you.”",
    duration: "0:26",
    state: "DELIVERED",
    ageMinutes: 186,
    stationId: "bharati",
  },
  {
    id: "hl-003",
    direction: "family→field",
    from: "Mom",
    to: "Arjun Nair (Bharati)",
    kind: "SHORT VIDEO",
    preview: "“Hey, we are all thinking of you. Stay safe.”",
    duration: "0:30",
    state: "WAITING FOR CONNECTIVITY",
    quality: "LOW",
    ageMinutes: 47,
    stationId: "bharati",
  },
  {
    id: "hl-004",
    direction: "family→field",
    from: "Dad",
    to: "Arjun Nair (Bharati)",
    kind: "BIRTHDAY / FESTIVAL",
    preview: "Early birthday message — scheduled for 04 Oct at Bharati",
    duration: "0:44",
    state: "QUEUED",
    ageMinutes: 22,
    stationId: "bharati",
  },
  {
    id: "hl-005",
    direction: "field→family",
    from: "Arjun Nair",
    to: "Family (Nair)",
    kind: "VOICE MESSAGE",
    preview: "“Everything is okay. I'll message when I can.”",
    duration: "0:18",
    state: "QUEUED",
    ageMinutes: 6,
    stationId: "bharati",
  },
  {
    id: "hl-006",
    direction: "family→field",
    from: "Family (Nair)",
    to: "Kavita Joshi (Camp Suhrid)",
    kind: "ENCOURAGEMENT CARD",
    preview: "“The mountains miss you too. 💛”",
    state: "DELIVERED",
    ageMinutes: 320,
    stationId: "camp-suhrid",
  },
  {
    id: "hl-007",
    direction: "field→family",
    from: "Kavita Joshi",
    to: "Family (Nair)",
    kind: "PHOTO + TEXT",
    preview: "Sun over the ice shelf — camp is calm today.",
    state: "TRANSMITTING",
    quality: "LOW",
    ageMinutes: 2,
    stationId: "camp-suhrid",
  },
];

/* ---- Family Moments — asynchronous micro-activities ---- */

export interface FamilyMoment {
  id: string;
  from: string;
  prompt: string;
  responses: { who: string; text: string; when: string }[];
  state: "WAITING FOR RESPONSE" | "RESPONDED";
}

export const FAMILY_MOMENTS: FamilyMoment[] = [
  {
    id: "fm-1",
    from: "Mom",
    prompt: "Guess what we cooked today?",
    responses: [{ who: "Arjun", text: "The dal from Diwali? Saving my guess for the video reply.", when: "Queued (P4)" }],
    state: "RESPONDED",
  },
  {
    id: "fm-2",
    from: "Diya (sister)",
    prompt: "Tell us your favorite memory from home.",
    responses: [],
    state: "WAITING FOR RESPONSE",
  },
  {
    id: "fm-3",
    from: "Dad",
    prompt: "Send us one thing you saw today.",
    responses: [],
    state: "WAITING FOR RESPONSE",
  },
  {
    id: "fm-4",
    from: "Family",
    prompt: "Complete today's family quiz — 3 questions, 2 KB total.",
    responses: [],
    state: "WAITING FOR RESPONSE",
  },
];

/* ---- Memory Capsule ---- */

export interface CapsuleItem {
  id: string;
  type: "PHOTO" | "VOICE" | "VIDEO" | "STORY" | "NOTE";
  title: string;
  by: string;
  size: string;
}

export const MEMORY_CAPSULE: CapsuleItem[] = [
  { id: "mc-1", type: "PHOTO", title: "Dad — 2008", by: "Mom", size: "140 KB" },
  { id: "mc-2", type: "VOICE", title: "“Remember this trip?”", by: "Diya", size: "85 KB" },
  { id: "mc-3", type: "VIDEO", title: "Diwali at home", by: "Family", size: "610 KB (LOW)" },
  { id: "mc-4", type: "STORY", title: "“Your first day of school”", by: "Dad", size: "2 KB" },
  { id: "mc-5", type: "NOTE", title: "Festival plan for your return", by: "Mom", size: "1 KB" },
];

/* ------------------------------------------------------------------ */
/* Well-being — voluntary self-check, never a diagnostic               */
/* ------------------------------------------------------------------ */

export const CHECKIN_OPTIONS = [
  { emoji: "🙂", label: "Good" },
  { emoji: "😐", label: "Okay" },
  { emoji: "😔", label: "Low" },
  { emoji: "😣", label: "Struggling" },
] as const;

export const SUPPORT_ROUTES = [
  { id: "family", label: "Family", note: "Record a Home Link message — queued for the next window" },
  { id: "team", label: "Team Support", note: "Station leader / peer support — private to your station" },
  { id: "medical", label: "Medical Support", note: "Confidential route to the expedition medical officer" },
] as const;

/** Aggregate control-room indicators — operational, never clinical, never private content. */
export function wellBeingAggregate(): {
  checkins: string;
  supportRequests: number;
  familyBacklog: number;
  connectivityDisruptions: number;
} {
  return { checkins: "21/24", supportRequests: 2, familyBacklog: SEED_MESSAGES.filter((m) => m.direction === "family→field" && m.state !== "OPENED").length, connectivityDisruptions: 3 };
}

/** Evidence-informed seasonal support — NOT the "third-quarter phenomenon". */
export const WINTER_SUPPORT_WINDOW = {
  title: "Winter Support Window",
  basis:
    "Research on Indian Antarctic expeditioners (27th ISE) documented psychological and behavioral changes across phases of Antarctic residence — including increased anxiety/insomnia during colder periods and changes in social functioning during winter. That study explicitly did NOT validate the “third-quarter phenomenon”; POLARIS therefore treats this as an evidence-informed support window, not a deterministic cycle.",
  suggestions: ["Family Moment", "Team activity", "Well-being check-in", "Family message", "Recreation activity"],
};

/* ------------------------------------------------------------------ */
/* Security model                                                      */
/* ------------------------------------------------------------------ */

export const HOME_LINK_SECURITY = [
  "End-to-end encrypted where technically appropriate; content opaque to the sync engine",
  "Role-based access — control room sees delivery status, never message content",
  "Family portal authorization bound to the individual expedition member",
  "Device authentication for field pickup",
  "Local encrypted storage on field devices",
  "Automatic expiration policy for cached media after delivery",
];

export const FAMILY_PORTAL_EXCLUDES = [
  "live GPS / exact routes",
  "station operational data",
  "other personnel information",
  "hazard intelligence",
  "private medical information",
];

/* ------------------------------------------------------------------ */
/* Future deployment environments (architecture, not current claims)   */
/* ------------------------------------------------------------------ */

export const FUTURE_ENVIRONMENTS = [
  "Arctic research stations",
  "High-altitude Himalayan research camps",
  "Offshore scientific missions",
  "Remote disaster-response teams",
  "Deep-field geological expeditions",
  "Isolated medical missions",
  "Maritime research vessels",
  "Disaster-relief deployments",
  "Remote infrastructure teams",
];
