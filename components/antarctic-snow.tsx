/**
 * Antarctic snowfall — atmospheric background layer.
 *
 * A single canvas particle system rather than a DOM element per flake, so the
 * cost is bounded regardless of how many flakes are on screen. Each flake
 * carries a `depth` in [0,1] that drives size, fall speed, horizontal drift and
 * opacity together, which is what produces the parallax: near flakes are
 * larger, faster, more transparent-edged and drift wider than far ones.
 *
 * Rendering uses one pre-rendered soft radial sprite drawn with `drawImage`.
 * That gives a blurred, non-hard-edged flake for a fraction of the cost of a
 * per-particle gradient or a canvas blur filter.
 *
 * Purely decorative: `pointer-events: none`, `aria-hidden`, fixed behind all
 * content, and paused entirely when the tab is hidden.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* Upper bound on live particles. Kept small on purpose — this is atmosphere,
   not weather. */
const MAX_FLAKES = 96;
const MIN_FLAKES = 20;
const FRAME_MS = 1000 / 60;

/** Particle budget scales with viewport area and is cut back on small screens. */
function targetCount(width: number, height: number): number {
  const byArea = Math.round((width * height) / 16000);
  if (width < 640) return Math.max(MIN_FLAKES, Math.round(byArea * 0.5));
  if (width < 1024) return Math.max(MIN_FLAKES, Math.round(byArea * 0.72));
  return Math.min(MAX_FLAKES, Math.max(MIN_FLAKES, byArea));
}

interface Flake {
  x: number;
  y: number;
  /** 0 = far, 1 = near. Drives size, speed, drift and alpha together. */
  depth: number;
  size: number;
  /** Pixels per 60fps frame. */
  vy: number;
  /** Horizontal drift amplitude in px. */
  drift: number;
  /** Drift oscillation rate. */
  wobble: number;
  phase: number;
  alpha: number;
}

/** One soft radial sprite, reused for every flake. */
function makeSprite(): HTMLCanvasElement {
  const s = 24;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    // White core into very pale ice blue, fully transparent at the rim, so the
    // flake has no hard edge at any size.
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(240,249,255,0.85)");
    grad.addColorStop(0.7, "rgba(207,232,250,0.25)");
    grad.addColorStop(1, "rgba(207,232,250,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
  return c;
}

function makeFlake(width: number, height: number, seeded = false): Flake {
  // Squaring biases the distribution toward the far end, so most flakes are
  // small and faint and only a few read as "close".
  const r = Math.random();
  const depth = seeded ? Math.min(1, Math.max(0, r * r * 1.15)) : r * r;

  return {
    x: Math.random() * width,
    y: seeded ? Math.random() * height : Math.random() * -height * 0.2 - 10,
    depth,
    size: 1.2 + depth * 3.6,
    vy: 0.11 + depth * 0.46,
    drift: 5 + depth * 20,
    wobble: 0.4 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    // Spec calls for 10–35% opacity; the near end stays under that ceiling.
    alpha: 0.1 + depth * 0.25,
  };
}

export function AntarcticSnow({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const sprite = makeSprite();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0;
    let height = 0;
    let flakes: Flake[] = [];
    let raf = 0;
    let last = 0;
    let elapsed = 0;
    let running = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const wanted = targetCount(width, height);
      // Preserve existing flakes across a resize so a window drag does not
      // visibly reset the whole field.
      if (flakes.length > wanted) flakes.length = wanted;
      while (flakes.length < wanted) flakes.push(makeFlake(width, height, true));
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const f of flakes) {
        ctx.globalAlpha = f.alpha;
        // Near flakes are drawn larger than their core size, which reads as a
        // soft depth-of-field blur without paying for a real blur filter.
        const drawSize = f.size * (1 + f.depth * 0.9);
        ctx.drawImage(sprite, f.x - drawSize / 2, f.y - drawSize / 2, drawSize, drawSize);
      }
      ctx.globalAlpha = 1;
    };

    const step = (dt: number) => {
      elapsed += dt;
      for (const f of flakes) {
        f.y += f.vy * dt;
        f.phase += f.wobble * dt;
        f.x += Math.sin(f.phase) * (f.drift * dt) / 60;

        // Recycle to the top once past the bottom, with a fresh x so the field
        // does not fall into visible vertical lanes.
        if (f.y - f.size > height) {
          f.y = -f.size - Math.random() * 60;
          f.x = Math.random() * width;
        }
        if (f.x < -40) f.x = width + 40;
        if (f.x > width + 40) f.x = -40;
      }
      draw();
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // Clamp dt so a backgrounded tab does not teleport every flake on return.
      const dt = Math.min(3, (now - last) / FRAME_MS || 1);
      last = now;
      step(dt);
    };

    const start = () => {
      if (reduced.matches) {
        // Reduced motion: a single still field. Still atmospheric, no falling.
        draw();
        return;
      }
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onVisibility = () => {
      // Do not burn battery animating a field nobody is looking at.
      if (document.hidden) stop();
      else if (running) start();
    };

    const onMotionChange = () => {
      stop();
      if (reduced.matches) draw();
      else start();
    };

    resize();
    draw();
    start();

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onMotionChange);
    running = true;

    return () => {
      running = false;
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("pointer-events-none fixed inset-0 z-0 h-full w-full", className)}
    />
  );
}
