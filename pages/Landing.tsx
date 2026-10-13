/**
 * POLARIS — public landing page.
 *
 * This is the marketing front door, not a second product. It reuses the exact
 * same map component, design tokens, auth and routing as the Command Center so
 * the two read as one product.
 *
 * Hard content rule: this page shows real geography (NASA GIBS EPSG:3031, the
 * real NCPOR station and camp coordinates) and architectural capability. It
 * shows NO operational statistics. Counts, percentages, consumables-at-risk
 * figures and "LIVE" chips all originate in the database and are deliberately
 * absent here — a public page that displays invented numbers is worse than one
 * that displays none.
 */
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  Boxes,
  Cloud,
  Compass,
  Gauge,
  Link2,
  MapPin,
  MessageSquare,
  Radar,
  ShieldCheck,
  Siren,
  Snowflake,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AntarcticMap } from "@/components/antarctic-map";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

const SNOW = "#F7FBFF";
const ICE = "#EAF5FF";
const PALE = "#CFE8FA";
const POLAR = "#1674D1";
const NAVY = "#0B2850";

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/** Signed-in operators go straight to the Command Center; everyone else authenticates. */
function useCommandCenter() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  return () => navigate(isAuthenticated ? "/dashboard" : "/auth", { replace: false });
}

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

/** A translucent white panel. Used sparingly — most of the page is not glass. */
function Glass({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-white/70 bg-white/55 shadow-[0_18px_60px_-28px_rgba(11,40,80,0.35)] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[#1674D1]/80">
      {children}
    </p>
  );
}

/** Section shell. Generous vertical rhythm is the point — resist filling it. */
function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("relative px-5 sm:px-8", className)}>
      <div className="mx-auto w-full max-w-[1180px]">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function Header() {
  const open = useCommandCenter();
  return (
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 rounded-full border border-white/80 bg-white/70 px-4 py-2.5 shadow-[0_10px_40px_-24px_rgba(11,40,80,0.45)] backdrop-blur-xl sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#1674D1] text-white shadow-[0_6px_18px_-8px_rgba(22,116,209,0.9)]">
            <Compass className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </span>
          <span className="leading-none">
            <span className="block text-[15px] font-extrabold tracking-[-0.02em] text-[#0B2850]">
              POLARIS
            </span>
            <span className="mt-1 hidden text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#1674D1]/70 sm:block">
              Integrated Polar Expedition Operations System
            </span>
          </span>
        </div>

        <Button
          onClick={open}
          size="sm"
          className="h-9 shrink-0 rounded-full bg-[#1674D1] px-4 text-[11.5px] font-bold tracking-wide text-white shadow-[0_8px_20px_-10px_rgba(22,116,209,0.95)] transition hover:bg-[#0B2850]"
        >
          Open Command Center
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

/**
 * The operational map is the visual centrepiece. It renders the real
 * EPSG:3031 projection with real station and camp coordinates, real routes and
 * real hazard zones. No asset layer is passed, so there are no moving dots and
 * no operational counts — only geography.
 */
function HeroMap() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
      className="relative"
    >
      <Glass className="overflow-hidden p-2">
        <div className="relative h-[400px] overflow-hidden rounded-[22px] sm:h-[460px] lg:h-[520px]">
          <AntarcticMap assets={[]} compactLayers wheelZoom={false} className="h-full w-full" />

          {/* A single very slow light sweep across the ice. Reads as atmosphere,
              not as a loading shimmer; it never draws over the labels. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.5, 0] }}
            transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
            style={{
              background:
                "linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.4) 50%, transparent 62%)",
            }}
          />
        </div>
      </Glass>

      {/* A single restrained panel. Deliberately carries no numbers. */}
      <Glass className="absolute bottom-5 left-5 w-[248px] p-4 sm:bottom-6 sm:left-6">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#1674D1]/10 text-[#1674D1]">
            <Brain className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0B2850]">
            Polar Intelligence
          </p>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-[#0B2850]/70">
          Operational awareness across cargo, people, movement and safety.
        </p>
        <div className="mt-3 h-px w-full bg-gradient-to-r from-[#1674D1]/25 to-transparent" />
        <p className="mt-2.5 text-[9.5px] font-medium uppercase tracking-[0.13em] text-[#0B2850]/45">
          Predicted · Assessed · Human approved
        </p>
        {/* Slow breathing dot: present, never attention-seeking. */}
        <motion.span
          aria-hidden
          className="absolute right-4 top-4 h-1.5 w-1.5 rounded-full bg-[#1674D1]"
          animate={{ opacity: [0.35, 1, 0.35], scale: [1, 1.25, 1] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </Glass>
    </motion.div>
  );
}

function Hero() {
  const open = useCommandCenter();
  const navigate = useNavigate();
  const goCapabilities = () => {
    const el = document.getElementById("capabilities");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Section className="pb-16 pt-12 sm:pt-16 lg:pb-24 lg:pt-20">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:gap-14">
        {/* ---- Left ---- */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-[#1674D1]/15 bg-white/70 px-3 py-1.5 backdrop-blur"
          >
            <span className="grid h-4 w-4 place-items-center rounded-full bg-[#1674D1]/12 text-[#1674D1]">
              <Snowflake className="h-2.5 w-2.5" />
            </span>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-[#0B2850]/65">
              NCPOR · Ministry of Earth Sciences · Government of India
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="mt-6 text-[54px] font-black leading-[0.92] tracking-[-0.035em] text-[#0B2850] sm:text-[68px]"
          >
            POLARIS
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
            className="mt-4 text-[26px] font-bold leading-[1.16] tracking-[-0.02em] text-[#1674D1] sm:text-[31px]"
          >
            One operational picture
            <br />
            for the entire expedition.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="mt-5 max-w-[46ch] text-[14.5px] leading-[1.65] text-[#0B2850]/65"
          >
            An integrated operational platform connecting polar logistics, personnel,
            transport, inventory, weather, hazards and emergency response — even when
            connectivity becomes unreliable.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Button
              onClick={open}
              className="h-11 rounded-full bg-[#1674D1] px-6 text-[12.5px] font-bold tracking-wide text-white shadow-[0_14px_30px_-14px_rgba(22,116,209,0.95)] transition hover:bg-[#0B2850]"
            >
              Launch Command Center
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={goCapabilities}
              className="h-11 rounded-full border-[#1674D1]/20 bg-white/70 px-6 text-[12.5px] font-semibold text-[#0B2850] backdrop-blur transition hover:bg-white"
            >
              Explore POLARIS
            </Button>
          </motion.div>

          {/* Compact trust row — no padding walls, no grid. */}
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.34 }}
            className="mt-8 flex flex-wrap gap-x-6 gap-y-2.5"
          >
            {[
              { icon: Brain, label: "Explainable AI" },
              { icon: Cloud, label: "Offline-first field operations" },
              { icon: Siren, label: "SOS & emergency response" },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-[#1674D1]" strokeWidth={2.2} />
                <span className="text-[11.5px] font-medium text-[#0B2850]/70">{label}</span>
              </li>
            ))}
          </motion.ul>
        </div>

        {/* ---- Right ---- */}
        <HeroMap />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Capability strip                                                    */
/* ------------------------------------------------------------------ */

const CAPABILITIES = [
  { icon: Radar, title: "Live Operations", text: "Personnel, vehicles and missions" },
  { icon: Boxes, title: "Smart Logistics", text: "Cargo, inventory and resupply" },
  { icon: Link2, title: "Field Connectivity", text: "Offline-first operations and synchronization" },
  { icon: ShieldCheck, title: "Safety", text: "Hazards, check-ins and SOS" },
  { icon: Brain, title: "Polar Intelligence", text: "Prediction and decision support" },
];

function CapabilityStrip() {
  return (
    <Section id="capabilities" className="pb-20 lg:pb-24">
      <Glass className="px-6 py-6 sm:px-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-[#1674D1]/10">
          {CAPABILITIES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3 lg:pr-6 lg:first:pl-0">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1674D1]/10 text-[#1674D1]">
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#0B2850]">
                  {title}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-[#0B2850]/55">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </Glass>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Core idea — the operational chain                                   */
/* ------------------------------------------------------------------ */

const CHAIN = [
  "Cargo",
  "Transport",
  "Station",
  "Inventory",
  "Personnel",
  "GPS",
  "Hazards",
  "Response",
];

function CoreIdea() {
  return (
    <Section className="pb-20 lg:pb-28">
      <div className="max-w-[640px]">
        <Eyebrow>The core idea</Eyebrow>
        <h2 className="mt-4 text-[34px] font-extrabold leading-[1.08] tracking-[-0.025em] text-[#0B2850] sm:text-[44px]">
          From cargo
          <br />
          to field safety.
        </h2>
        <p className="mt-5 text-[14.5px] leading-[1.65] text-[#0B2850]/62">
          POLARIS connects the operational chain that normally exists across separate
          systems. A single record follows an item from dispatch to the person who
          depends on it.
        </p>
      </div>

      {/* Horizontal flow of small glass nodes joined by thin lines. */}
      <div className="mt-12 flex flex-wrap items-center gap-y-4">
        {CHAIN.map((node, i) => (
          <div key={node} className="flex items-center">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.05 }}
              className="rounded-full border border-white/80 bg-white/65 px-5 py-2.5 text-[12px] font-semibold text-[#0B2850] shadow-[0_8px_24px_-18px_rgba(11,40,80,0.5)] backdrop-blur"
            >
              {node}
            </motion.div>
            {i < CHAIN.length - 1 && (
              <span
                aria-hidden
                className="mx-2 h-px w-5 bg-gradient-to-r from-[#1674D1]/30 to-[#1674D1]/12 sm:w-7"
              />
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Offline-first                                                       */
/* ------------------------------------------------------------------ */

const DEGRADATION = [
  "Connected",
  "Low bandwidth",
  "Offline",
  "Local storage",
  "Priority sync",
  "Operational picture restored",
];

function OfflineFirst() {
  return (
    <Section className="pb-20 lg:pb-28">
      <Glass className="overflow-hidden p-8 sm:p-12">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
          <div>
            <Eyebrow>Graceful degradation</Eyebrow>
            <h2 className="mt-4 text-[30px] font-extrabold leading-[1.1] tracking-[-0.025em] text-[#0B2850] sm:text-[40px]">
              When connectivity disappears,
              <br className="hidden sm:block" /> operations continue.
            </h2>
            <p className="mt-5 max-w-[48ch] text-[14.5px] leading-[1.65] text-[#0B2850]/62">
              Critical field actions continue locally. Events are securely queued and
              synchronized according to priority when connectivity returns — emergency
              traffic is never overtaken by routine data.
            </p>
          </div>

          <div className="relative">
            <div className="absolute inset-y-0 left-[15px] w-px bg-gradient-to-b from-transparent via-[#1674D1]/25 to-transparent" />
            <ol className="space-y-1">
              {DEGRADATION.map((step, i) => (
                <motion.li
                  key={step}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.4, delay: i * 0.07 }}
                  className="relative flex items-center gap-4 py-2.5"
                >
                  <span
                    className={cn(
                      "relative z-10 grid h-[31px] w-[31px] shrink-0 place-items-center rounded-full border text-[10.5px] font-bold",
                      i === DEGRADATION.length - 1
                        ? "border-[#1674D1]/30 bg-[#1674D1] text-white"
                        : "border-[#1674D1]/18 bg-white text-[#1674D1]",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      "text-[13.5px]",
                      i === DEGRADATION.length - 1
                        ? "font-bold text-[#0B2850]"
                        : "font-medium text-[#0B2850]/62",
                    )}
                  >
                    {step}
                  </span>
                </motion.li>
              ))}
            </ol>
          </div>
        </div>
      </Glass>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Polar Intelligence                                                  */
/* ------------------------------------------------------------------ */

const INTEL_MODULES = [
  { title: "Predict", text: "Supply · Fuel · Demand · Expiry", icon: Gauge },
  { title: "Detect", text: "Cargo anomalies · Route deviations · Missed check-ins", icon: Radar },
  { title: "Assess", text: "Weather · Hazards · Connectivity · Operational risk", icon: Cloud },
  { title: "Recommend", text: "Resupply · Transport · Route · Response", icon: Brain },
];

function PolarIntelligence() {
  return (
    <Section className="pb-20 lg:pb-28">
      <div className="max-w-[680px]">
        <Eyebrow>Decision support</Eyebrow>
        <h2 className="mt-4 text-[30px] font-extrabold leading-[1.1] tracking-[-0.025em] text-[#0B2850] sm:text-[40px]">
          Polar Intelligence
        </h2>
        <p className="mt-4 text-[17px] font-semibold leading-snug text-[#1674D1] sm:text-[20px]">
          From monitoring what happened to anticipating what happens next.
        </p>
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INTEL_MODULES.map(({ title, text, icon: Icon }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: i * 0.07 }}
            className="rounded-2xl border border-white/80 bg-white/55 p-5 backdrop-blur-xl"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1674D1]/10 text-[#1674D1]">
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
            <p className="mt-3.5 text-[13px] font-bold uppercase tracking-[0.08em] text-[#0B2850]">
              {title}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#0B2850]/55">{text}</p>
          </motion.div>
        ))}
      </div>

      <p className="mt-8 text-center text-[15px] font-extrabold uppercase tracking-[0.14em] text-[#0B2850]/75 sm:text-[17px]">
        AI recommends.
        <span className="text-[#1674D1]"> Authorized humans decide.</span>
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Field safety                                                        */
/* ------------------------------------------------------------------ */

const SAFETY = [
  {
    icon: MapPin,
    title: "Hazard-aware routing",
    text: "Identify exposure to mapped hazards along planned movement.",
  },
  {
    icon: Users,
    title: "Convoy monitoring",
    text: "Track teams, vehicles and scheduled check-ins.",
  },
  {
    icon: Siren,
    title: "SOS",
    text: "Capture location, status and emergency context at the moment of trigger.",
  },
  {
    icon: Link2,
    title: "Offline emergency",
    text: "Queue critical events when communication is unavailable.",
  },
];

function FieldSafety() {
  return (
    <Section className="pb-20 lg:pb-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-center lg:gap-16">
        <div>
          <Eyebrow>Field operations</Eyebrow>
          <h2 className="mt-4 text-[30px] font-extrabold leading-[1.1] tracking-[-0.025em] text-[#0B2850] sm:text-[40px]">
            Built for the field.
          </h2>
          <p className="mt-5 max-w-[42ch] text-[14.5px] leading-[1.65] text-[#0B2850]/62">
            Designed for glaciology teams working beyond reliable coverage, where the
            operational picture must survive a lost link.
          </p>
        </div>

        <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
          {SAFETY.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-3.5">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1674D1]/10 text-[#1674D1]">
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <div>
                <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-[#0B2850]">
                  {title}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#0B2850]/58">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Home Link                                                           */
/* ------------------------------------------------------------------ */

const HOME_LINK = ["Family", "Message / Voice / Video", "Secure queue", "Available connectivity", "Field device"];

function HomeLink() {
  return (
    <Section className="pb-20 lg:pb-28">
      <Glass className="p-8 sm:p-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
          <div>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#1674D1]/10 text-[#1674D1]">
              <MessageSquare className="h-4 w-4" strokeWidth={2} />
            </span>
            <h2 className="mt-4 text-[28px] font-extrabold leading-[1.12] tracking-[-0.025em] text-[#0B2850] sm:text-[36px]">
              A link to home,
              <br />
              even across the ice.
            </h2>
            <p className="mt-4 max-w-[44ch] text-[14.5px] leading-[1.65] text-[#0B2850]/62">
              Family messages can be securely queued and delivered when connectivity
              becomes available — text, voice, short video and photographs, sized for
              the link that is actually present.
            </p>
            <p className="mt-4 text-[11px] leading-relaxed text-[#0B2850]/45">
              Delivery is queued, not instantaneous. POLARIS does not present this as
              live video calling.
            </p>
          </div>

          <div className="relative">
            <div className="absolute inset-y-0 left-[15px] w-px bg-gradient-to-b from-transparent via-[#1674D1]/25 to-transparent" />
            <ol className="space-y-1">
              {HOME_LINK.map((step, i) => (
                <li key={step} className="relative flex items-center gap-4 py-2.5">
                  <span
                    className={cn(
                      "relative z-10 grid h-[31px] w-[31px] shrink-0 place-items-center rounded-full border text-[10.5px] font-bold",
                      i === HOME_LINK.length - 1
                        ? "border-[#1674D1]/30 bg-[#1674D1] text-white"
                        : "border-[#1674D1]/18 bg-white text-[#1674D1]",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      "text-[13.5px]",
                      i === HOME_LINK.length - 1
                        ? "font-bold text-[#0B2850]"
                        : "font-medium text-[#0B2850]/62",
                    )}
                  >
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Glass>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Final CTA                                                           */
/* ------------------------------------------------------------------ */

function FinalCta() {
  const open = useCommandCenter();
  return (
    <Section className="pb-24 pt-8 lg:pb-32">
      <div className="relative overflow-hidden rounded-[32px] border border-white/80 bg-gradient-to-b from-white/70 to-[#EAF5FF]/70 px-8 py-16 text-center backdrop-blur-xl sm:px-12 sm:py-20">
        <h2 className="text-[32px] font-extrabold leading-[1.08] tracking-[-0.03em] text-[#0B2850] sm:text-[46px]">
          One expedition.
          <br />
          One operational picture.
        </h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-[14.5px] leading-[1.65] text-[#0B2850]/62">
          POLARIS connects logistics, people, movement, safety and intelligence into
          one coordinated system.
        </p>
        <Button
          onClick={open}
          className="mt-9 h-12 rounded-full bg-[#1674D1] px-8 text-[13px] font-bold tracking-wide text-white shadow-[0_18px_36px_-16px_rgba(22,116,209,0.95)] transition hover:bg-[#0B2850]"
        >
          Open Command Center
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <p className="mt-10 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-[#0B2850]/35">
        Polar Expedition Operations · NCPOR · Ministry of Earth Sciences
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{
        background: `linear-gradient(180deg, ${SNOW} 0%, ${ICE} 42%, ${SNOW} 100%)`,
      }}
    >
      {/* Soft polar light. Behind everything, never intercepts pointer events. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: `radial-gradient(70% 48% at 78% 8%, ${PALE}55 0%, transparent 62%),
                       radial-gradient(52% 40% at 8% 26%, #FFFFFF 0%, transparent 58%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[420px]"
        style={{ background: `linear-gradient(0deg, ${PALE}33 0%, transparent 100%)` }}
      />

      <div className="relative z-10">
        <Header />
        <main>
          <Hero />
          <CapabilityStrip />
          <CoreIdea />
          <OfflineFirst />
          <PolarIntelligence />
          <FieldSafety />
          <HomeLink />
          <FinalCta />
        </main>
      </div>
    </div>
  );
}
