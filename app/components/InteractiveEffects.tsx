"use client";

import { useEffect, useRef } from "react";

type RippleRing = {
  delay: number;
  maxRadius: number;
  lineWidth: number;
  color: string;
};

type WaterRipple = {
  x: number;
  y: number;
  born: number;
  duration: number;
  isBaby: boolean;
  baseAlpha: number;
  rings: RippleRing[];
  plungeAlpha: number;
};

type WaterDroplet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  radius: number;
  color: string;
  alpha: number;
  age: number;
  maxAge: number;
  babyRippleRadius: number;
  shouldSpawnBabyRipple: boolean;
  spawnedBabyRipple: boolean;
};

const PALETTE_RGB = [
  "139, 115, 201", // --accent (lilac)
  "79, 157, 150",  // --mint (teal-mint)
  "201, 130, 103", // --peach (warm coral-peach)
  "168, 148, 224", // soft lavender highlight
];

// Only match interactive buttons / controls
const INTERACTIVE_BUTTON_SELECTOR =
  "button, a, input, textarea, select, label, [role='button'], .calendar-day.is-interactive";

const TILT_CARD_SELECTOR =
  ".dashboard-card, .music-player-bar, .guestbook-home-entry, .project-row, .maintenance-card";

const SPOTLIGHT_CARD_SELECTOR =
  ".glass-card, .music-player-bar, .maintenance-card";

export function InteractiveEffects() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotionQuery.matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resizeCanvas = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas, { passive: true });

    const ripples: WaterRipple[] = [];
    const droplets: WaterDroplet[] = [];
    let animationFrameId = 0;

    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

    const spawnSplashDroplets = (
      x: number,
      y: number,
      options: { withRipples: boolean; baseRadius: number },
    ) => {
      const { withRipples, baseRadius } = options;
      const dropletCount = 8;

      for (let i = 0; i < dropletCount; i += 1) {
        const angle =
          (Math.PI * 2 * i) / dropletCount + (Math.random() - 0.5) * 0.42;

        if (withRipples) {
          const maxAge = 38 + Math.floor(Math.random() * 18);
          const landingFrames = Math.max(1, maxAge * 0.82);
          const targetDistance = baseRadius * (0.45 + Math.random() * 0.47);
          const radialSpeed = targetDistance / landingFrames;
          const gravity = 0.11 + Math.random() * 0.03;
          const upwardBoost = 0.5 * gravity * landingFrames;

          droplets.push({
            x: x + Math.cos(angle) * 6,
            y: y + Math.sin(angle) * 6,
            vx: Math.cos(angle) * radialSpeed,
            vy: Math.sin(angle) * radialSpeed - upwardBoost,
            gravity,
            radius: 1.5 + Math.random() * 1.5,
            color: PALETTE_RGB[i % PALETTE_RGB.length],
            alpha: 0.72,
            age: 0,
            maxAge,
            babyRippleRadius: baseRadius * (0.28 + Math.random() * 0.14),
            shouldSpawnBabyRipple: true,
            spawnedBabyRipple: false,
          });
        } else {
          // Normal click: pure splashing water-flower particles without ripples
          const speed = 1.4 + Math.random() * 2.3;
          droplets.push({
            x: x + Math.cos(angle) * 3,
            y: y + Math.sin(angle) * 3,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed * 0.55 - (1.6 + Math.random() * 1.6),
            gravity: 0.085 + Math.random() * 0.025,
            radius: 1.5 + Math.random() * 1.6,
            color: PALETTE_RGB[i % PALETTE_RGB.length],
            alpha: 0.76,
            age: 0,
            maxAge: 30 + Math.floor(Math.random() * 16),
            babyRippleRadius: 0,
            shouldSpawnBabyRipple: false,
            spawnedBabyRipple: true,
          });
        }
      }
    };

    const spawnStoneRipple = (
      x: number,
      y: number,
      options?: { isBaby?: boolean; babyMaxRadius?: number },
    ) => {
      const now = performance.now();
      const isBaby = options?.isBaby ?? false;

      if (isBaby) {
        const babyRadius = options?.babyMaxRadius ?? 85 + Math.random() * 35;
        ripples.push({
          x,
          y,
          born: now,
          duration: 1150,
          isBaby: true,
          baseAlpha: 0.34,
          plungeAlpha: 0,
          rings: [
            {
              delay: 0,
              maxRadius: babyRadius,
              lineWidth: 1.4,
              color: PALETTE_RGB[Math.floor(Math.random() * 2)],
            },
            {
              delay: 110,
              maxRadius: babyRadius * 0.68,
              lineWidth: 1.1,
              color: PALETTE_RGB[2],
            },
          ],
        });
        startLoop();
        return;
      }

      // Interactive button click: full concentric water ripple packet
      const baseRadius = 300;
      const rings: RippleRing[] = [
        {
          delay: 0,
          maxRadius: baseRadius,
          lineWidth: 2.3,
          color: "79, 157, 150",
        },
        {
          delay: 130,
          maxRadius: baseRadius * 0.78,
          lineWidth: 2.0,
          color: "139, 115, 201",
        },
        {
          delay: 260,
          maxRadius: baseRadius * 0.56,
          lineWidth: 1.7,
          color: "201, 130, 103",
        },
        {
          delay: 390,
          maxRadius: baseRadius * 0.38,
          lineWidth: 1.4,
          color: "255, 255, 255",
        },
      ];

      ripples.push({
        x,
        y,
        born: now,
        duration: 2000,
        isBaby: false,
        baseAlpha: 0.52,
        plungeAlpha: 0.7,
        rings,
      });

      spawnSplashDroplets(x, y, { withRipples: true, baseRadius });
      startLoop();
    };

    const renderFrame = (now: number) => {
      ctx.clearRect(0, 0, width, height);

      // 1. Update & draw water ripples
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const ripple = ripples[i];
        const elapsed = now - ripple.born;
        if (elapsed >= ripple.duration) {
          ripples.splice(i, 1);
          continue;
        }

        // Unified opacity across all concentric layers of this ripple, decaying synchronously
        const globalProgress = elapsed / ripple.duration;
        const unifiedAlpha = ripple.baseAlpha * Math.pow(1 - globalProgress, 1.45);

        // Initial stone plunge flash at center
        if (!ripple.isBaby && elapsed < 280 && ripple.plungeAlpha > 0) {
          const plungeProgress = elapsed / 280;
          const plungeRadius = 6 + plungeProgress * 32;
          const fade = (1 - plungeProgress) * ripple.plungeAlpha;
          const plungeGrad = ctx.createRadialGradient(
            ripple.x,
            ripple.y,
            0,
            ripple.x,
            ripple.y,
            plungeRadius,
          );
          plungeGrad.addColorStop(0, `rgba(255, 255, 255, ${fade * 0.9})`);
          plungeGrad.addColorStop(0.5, `rgba(139, 115, 201, ${fade * 0.45})`);
          plungeGrad.addColorStop(1, "rgba(139, 115, 201, 0)");
          ctx.beginPath();
          ctx.fillStyle = plungeGrad;
          ctx.arc(ripple.x, ripple.y, plungeRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        if (unifiedAlpha <= 0.005) continue;

        // Draw each concentric wave ring with the shared synchronous opacity
        for (let r = 0; r < ripple.rings.length; r += 1) {
          const ring = ripple.rings[r];
          const ringElapsed = elapsed - ring.delay;
          if (ringElapsed <= 0) continue;

          const ringDuration = ripple.duration - ring.delay;
          if (ringDuration <= 0) continue;

          const expansionProgress = Math.min(1, ringElapsed / ringDuration);
          const eased = easeOutQuart(expansionProgress);
          const currentRadius = 4 + eased * ring.maxRadius;

          // Smooth 70ms birth ramp so delayed inner rings join the unified opacity without a hard pop
          const birthRamp = Math.min(1, ringElapsed / 70);
          const ringAlpha = unifiedAlpha * birthRamp;

          // Outer refractive color wave crest
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, currentRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${ring.color}, ${ringAlpha.toFixed(3)})`;
          ctx.lineWidth = Math.max(0.5, ring.lineWidth * (1 - globalProgress * 0.5));
          ctx.stroke();

          // Subtle inner specular water highlight crest
          if (!ripple.isBaby && currentRadius > 8) {
            ctx.beginPath();
            ctx.arc(
              ripple.x,
              ripple.y,
              Math.max(1, currentRadius - 2.5),
              0,
              Math.PI * 2,
            );
            ctx.strokeStyle = `rgba(255, 255, 255, ${(ringAlpha * 0.65).toFixed(3)})`;
            ctx.lineWidth = Math.max(0.4, ring.lineWidth * 0.45);
            ctx.stroke();
          }
        }
      }

      // 2. Update & draw splash crown micro-droplets
      for (let i = droplets.length - 1; i >= 0; i -= 1) {
        const drop = droplets[i];
        drop.age += 1;
        drop.x += drop.vx;
        drop.y += drop.vy;
        drop.vy += drop.gravity;

        const life = drop.age / drop.maxAge;
        if (drop.shouldSpawnBabyRipple && life >= 0.82 && !drop.spawnedBabyRipple) {
          drop.spawnedBabyRipple = true;
          spawnStoneRipple(drop.x, drop.y, {
            isBaby: true,
            babyMaxRadius: drop.babyRippleRadius,
          });
        }

        if (drop.age >= drop.maxAge) {
          droplets.splice(i, 1);
          continue;
        }

        const alpha = drop.alpha * (1 - life);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${drop.color}, ${alpha.toFixed(3)})`;
        ctx.arc(
          drop.x,
          drop.y,
          Math.max(0.4, drop.radius * (1 - life * 0.4)),
          0,
          Math.PI * 2,
        );
        ctx.fill();

        // Tiny white specular dot on the water droplet
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`;
        ctx.arc(
          drop.x - 0.35,
          drop.y - 0.35,
          Math.max(0.25, drop.radius * 0.42),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // Only continue the RAF loop while ripples or droplets are active
      if (ripples.length > 0 || droplets.length > 0) {
        animationFrameId = window.requestAnimationFrame(renderFrame);
      } else {
        animationFrameId = 0;
      }
    };

    const startLoop = () => {
      if (animationFrameId === 0) {
        animationFrameId = window.requestAnimationFrame(renderFrame);
      }
    };

    let activeSpotCard: HTMLElement | null = null;
    let activeTiltCard: HTMLElement | null = null;
    let pointerMoveFrame = 0;
    let latestPointerEvent: PointerEvent | null = null;

    const clearCardEffects = () => {
      if (activeSpotCard) {
        activeSpotCard.style.setProperty("--spot-opacity", "0");
        activeSpotCard = null;
      }
      if (activeTiltCard) {
        activeTiltCard.style.setProperty("--card-tilt-x", "0deg");
        activeTiltCard.style.setProperty("--card-tilt-y", "0deg");
        activeTiltCard = null;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      const target = event.target instanceof Element ? event.target : null;
      const isInteractiveButton = Boolean(target?.closest(INTERACTIVE_BUTTON_SELECTOR));

      if (isInteractiveButton) {
        spawnStoneRipple(event.clientX, event.clientY, { isBaby: false });
      } else {
        spawnSplashDroplets(event.clientX, event.clientY, {
          withRipples: false,
          baseRadius: 0,
        });
        startLoop();
      }
    };

    const processPointerMove = () => {
      pointerMoveFrame = 0;
      const event = latestPointerEvent;
      if (!event) return;

      const { clientX, clientY } = event;
      const target = event.target instanceof Element ? event.target : null;

      const nextSpotCard =
        target?.closest<HTMLElement>(SPOTLIGHT_CARD_SELECTOR) ?? null;
      if (activeSpotCard && activeSpotCard !== nextSpotCard) {
        activeSpotCard.style.setProperty("--spot-opacity", "0");
      }
      activeSpotCard = nextSpotCard;
      if (activeSpotCard) {
        const rect = activeSpotCard.getBoundingClientRect();
        activeSpotCard.style.setProperty("--spot-x", `${clientX - rect.left}px`);
        activeSpotCard.style.setProperty("--spot-y", `${clientY - rect.top}px`);
        activeSpotCard.style.setProperty("--spot-opacity", "1");
      }

      const nextTiltCard =
        target?.closest<HTMLElement>(TILT_CARD_SELECTOR) ?? null;
      if (activeTiltCard && activeTiltCard !== nextTiltCard) {
        activeTiltCard.style.setProperty("--card-tilt-x", "0deg");
        activeTiltCard.style.setProperty("--card-tilt-y", "0deg");
      }
      activeTiltCard = nextTiltCard;
      if (activeTiltCard) {
        const rect = activeTiltCard.getBoundingClientRect();
        const relX = (clientX - rect.left) / Math.max(1, rect.width) - 0.5;
        const relY = (clientY - rect.top) / Math.max(1, rect.height) - 0.5;
        const maxTilt = 2.0;
        const tiltX = (-relY * maxTilt).toFixed(2);
        const tiltY = (relX * maxTilt).toFixed(2);
        activeTiltCard.style.setProperty("--card-tilt-x", `${tiltX}deg`);
        activeTiltCard.style.setProperty("--card-tilt-y", `${tiltY}deg`);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      latestPointerEvent = event;
      if (pointerMoveFrame === 0) {
        pointerMoveFrame = window.requestAnimationFrame(processPointerMove);
      }
    };

    const handlePointerLeave = () => {
      clearCardEffects();
    };

    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("mouseleave", handlePointerLeave, { passive: true });

    return () => {
      if (animationFrameId !== 0) window.cancelAnimationFrame(animationFrameId);
      if (pointerMoveFrame !== 0) window.cancelAnimationFrame(pointerMoveFrame);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("mouseleave", handlePointerLeave);
      clearCardEffects();
    };
  }, []);

  return <canvas ref={canvasRef} className="interactive-fx-canvas" aria-hidden="true" />;
}
