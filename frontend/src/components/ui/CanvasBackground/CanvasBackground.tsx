import React, { useRef, useEffect } from 'react';
import { onMotionChange, prefersReducedMotion } from '../../../utils/motion';
import {
  linkDistanceFor,
  nodeCountFor,
  rescaleNodes,
  seedNodes,
  stepNodes,
  type FieldNode,
  type Pointer,
  type Size,
  type Tone,
} from './field';
import styles from './CanvasBackground.module.css';

/*
 * The animated "neural network" behind the page: crisp dots with a soft glow,
 * spread evenly over the whole window and drifting gently, linked by thin
 * lines when they come close. The maths (seeding, resizing, movement) lives
 * in field.ts.
 *
 * Cost controls:
 * - The backing store is the CSS size times the device pixel ratio, capped
 *   at 1.5: sharp on high-density screens without painting 4x the pixels.
 * - Each tone's glow is a radial-gradient sprite drawn once (again only when
 *   the theme or the pixel ratio changes) and stamped with drawImage; no
 *   shadowBlur, which would blur every dot on every frame.
 * - At most 30 frames a second, with movement scaled by the elapsed time.
 * - The node count scales with the viewport area (18 on a phone, 80 at most).
 * - Colours are read from CSS on mount and when the theme changes, never per frame.
 * - Nothing runs while the tab is hidden; under reduced motion one static frame
 *   is drawn and no loop starts.
 * - Every listener, observer and pending frame is released on unmount.
 */

const MAX_PIXEL_RATIO = 1.5;
const FRAME_INTERVAL_MS = 1000 / 30;
const BASE_STEP_MS = 1000 / 60; // the speeds in field.ts are per 60 fps step
const GLOW_RADIUS = 14; // CSS px: how far a dot's glow reaches
const MAX_LINKS_PER_NODE = 3;
const LINE_WIDTH = 0.75; // CSS px

interface Palette {
  colors: Record<Tone, string>;
  dotAlpha: number;
  glowAlpha: number;
  lineAlpha: number;
}

const FALLBACK: Palette = {
  colors: { 0: '#00d4ff', 1: '#ffc107', 2: '#2dd4bf' },
  dotAlpha: 0.85,
  glowAlpha: 0.5,
  lineAlpha: 0.2,
};

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const alpha = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    colors: {
      0: color('--canvas-1', FALLBACK.colors[0]),
      1: color('--canvas-2', FALLBACK.colors[1]),
      2: color('--canvas-3', FALLBACK.colors[2]),
    },
    dotAlpha: alpha('--canvas-dot-alpha', FALLBACK.dotAlpha),
    glowAlpha: alpha('--canvas-glow-alpha', FALLBACK.glowAlpha),
    lineAlpha: alpha('--canvas-line-alpha', FALLBACK.lineAlpha),
  };
}

/** A soft round glow in `color`, fading to nothing at its edge, `scale` backing pixels per CSS pixel. */
function glowSprite(color: string, scale: number): HTMLCanvasElement | null {
  const sprite = document.createElement('canvas');
  const size = Math.max(2, Math.ceil(GLOW_RADIUS * 2 * scale));
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  if (!ctx || typeof ctx.createRadialGradient !== 'function') return null;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, withAlpha(color, 0.9));
  gradient.addColorStop(0.18, withAlpha(color, 0.45));
  gradient.addColorStop(0.5, withAlpha(color, 0.12));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

/** `color` (#rgb, #rrggbb or rgb()) at `alpha`, as an rgba() string. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let rgb: number[] | null = null;
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = color.match(/^rgba?\(([^)]+)\)$/i);
    if (fn) rgb = fn[1].split(',').slice(0, 3).map((part) => Number(part.trim()));
  }
  if (!rgb || rgb.some((n) => !Number.isFinite(n))) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}

const CanvasBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rand = Math.random;
    let size: Size = { width: window.innerWidth, height: window.innerHeight };
    let scale = 1;
    let palette = readPalette();
    let sprites: Record<Tone, HTMLCanvasElement | null> = { 0: null, 1: null, 2: null };
    let dotFills: Record<Tone, string> = { 0: '', 1: '', 2: '' };
    let lineColors: Record<Tone, string> = { 0: '', 1: '', 2: '' };
    let linkDistance = 180;
    let reducedMotion = prefersReducedMotion();
    let pointer: Pointer | null = null;
    let nodes: FieldNode[] = [];

    let frameId = 0;
    let running = false;
    let lastFrame = 0;
    let resizeFrameId = 0;

    const pixelRatio = () => Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_PIXEL_RATIO);

    const paint = () => {
      sprites = { 0: glowSprite(palette.colors[0], scale), 1: glowSprite(palette.colors[1], scale), 2: glowSprite(palette.colors[2], scale) };
      dotFills = {
        0: withAlpha(palette.colors[0], palette.dotAlpha),
        1: withAlpha(palette.colors[1], palette.dotAlpha),
        2: withAlpha(palette.colors[2], palette.dotAlpha),
      };
      lineColors = { 0: palette.colors[0], 1: palette.colors[1], 2: palette.colors[2] };
    };

    const fitCanvas = () => {
      const next = { width: window.innerWidth, height: window.innerHeight };
      const nextScale = pixelRatio();
      // Resizing the backing store also resets the context state.
      canvas.width = Math.max(1, Math.round(next.width * nextScale));
      canvas.height = Math.max(1, Math.round(next.height * nextScale));
      ctx.setTransform(nextScale, 0, 0, nextScale, 0, 0);

      const count = nodeCountFor(next);
      nodes = nodes.length === 0 ? seedNodes(count, next, rand) : rescaleNodes(nodes, size, next, count, rand);
      linkDistance = linkDistanceFor(next, count);
      size = next;
      if (nextScale !== scale || sprites[0] === null) {
        scale = nextScale;
        paint();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, size.width, size.height);

      // Lines first, under the dots: thin, fading with distance.
      ctx.lineWidth = LINE_WIDTH;
      const maxDistance2 = linkDistance * linkDistance;
      for (let i = 0; i < nodes.length; i++) {
        let links = 0;
        for (let j = i + 1; j < nodes.length && links < MAX_LINKS_PER_NODE; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= maxDistance2) continue;
          ctx.globalAlpha = palette.lineAlpha * (1 - Math.sqrt(d2) / linkDistance);
          ctx.strokeStyle = lineColors[nodes[i].tone];
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
          links++;
        }
      }

      // Glow sprites, then the crisp dot on top.
      for (const node of nodes) {
        const sprite = sprites[node.tone];
        if (sprite) {
          ctx.globalAlpha = palette.glowAlpha * node.glow;
          ctx.drawImage(sprite, node.x - GLOW_RADIUS, node.y - GLOW_RADIUS, GLOW_RADIUS * 2, GLOW_RADIUS * 2);
        }
      }
      ctx.globalAlpha = 1;
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = dotFills[node.tone];
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      if (lastFrame && now - lastFrame < FRAME_INTERVAL_MS - 1) return;
      const dt = lastFrame ? Math.min((now - lastFrame) / BASE_STEP_MS, 4) : 1;
      lastFrame = now;
      stepNodes(nodes, dt, size, pointer, rand);
      draw();
    };

    const start = () => {
      if (running || reducedMotion || document.hidden) return;
      running = true;
      lastFrame = 0;
      frameId = requestAnimationFrame(frame);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frameId);
    };

    const refresh = () => {
      if (running) return;
      draw();
    };

    const onResize = () => {
      if (resizeFrameId) return;
      resizeFrameId = requestAnimationFrame(() => {
        resizeFrameId = 0;
        fitCanvas();
        refresh();
      });
    };

    const onMouseMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onMouseLeave = () => {
      pointer = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };

    const stopFollowingMotion = onMotionChange((reduced) => {
      reducedMotion = reduced;
      if (reduced) {
        stop();
        refresh();
      } else {
        start();
      }
    });

    // Re-read the colours only when the theme actually changes.
    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
      paint();
      refresh();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);

    fitCanvas();
    draw();
    start();

    return () => {
      stop();
      cancelAnimationFrame(resizeFrameId);
      stopFollowingMotion();
      themeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
      document.documentElement.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.neuralBackground} aria-hidden="true"></canvas>;
};

export default CanvasBackground;
