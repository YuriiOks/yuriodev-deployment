import React, { useRef, useEffect } from 'react';
import { onMotionChange, prefersReducedMotion } from '../../../utils/motion';
import styles from './CanvasBackground.module.css';

/*
 * The animated "neural network" behind the page.
 *
 * Cost controls:
 * - The backing store is a quarter of the CSS size. The browser's upscaling
 *   softens the picture, with a sixteenth of the pixels and no filter pass
 *   over the whole viewport; dimmer lines and dots and a wider glow bring it
 *   close to the old CSS `filter: blur(3px)` haze (it stays a little crisper).
 *   devicePixelRatio is deliberately not applied (well under any 2x cap), so a
 *   high-density screen never paints more.
 * - At most 30 frames a second, with movement scaled by the elapsed time.
 * - The node count scales with the viewport area (20 on a phone, 60 at most).
 * - Colours are read from CSS on mount and when the theme changes, never per frame.
 * - Nothing runs while the tab is hidden; under reduced motion one static frame
 *   is drawn and no loop starts.
 * - Every listener, observer and pending frame is released on unmount.
 */

const BACKING_SCALE = 0.25;
// The old blur spread each line and dot over several pixels, which also
// dimmed them; these bring the upscaled picture back to that soft haze.
const LINK_ALPHA = { dark: 0.6, light: 1 };
const NODE_ALPHA = 0.7;
const GLOW_BLUR = { dark: 22, light: 8 }; // CSS px
// On the light background the glow barely shows, so the dots themselves are
// drawn wider; upscaled, they read as the old soft discs, not tiny squares.
const NODE_SPREAD = { dark: 0, light: 1.5 }; // CSS px added to the radius
const FRAME_INTERVAL_MS = 1000 / 30;
const BASE_STEP_MS = 1000 / 60; // the speeds below are tuned per 60 fps step
const MIN_NODES = 20;
const MAX_NODES = 60;
const AREA_PER_NODE = 15000; // CSS px² per node
const INTERACTION_RADIUS = 120;
const REPULSION_STRENGTH = 0.6;
const DAMPING = 0.98;
const LINK_DISTANCE = 180;
const MAX_LINKS_PER_NODE = 4;

type Tone = 'primary' | 'secondary' | 'tertiary';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  glow: number;
  tone: Tone;
  fill: string;
}

interface Palette {
  dark: boolean;
  colors: Record<Tone, string>;
}

const FALLBACK_COLORS: Record<Tone, string> = { primary: '#00d4ff', secondary: '#ffc107', tertiary: '#2dd4bf' };

function readPalette(): Palette {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    dark: root.getAttribute('data-theme') !== 'light',
    colors: {
      primary: read('--accent-primary', FALLBACK_COLORS.primary),
      secondary: read('--accent-secondary', FALLBACK_COLORS.secondary),
      tertiary: read('--accent-tertiary', FALLBACK_COLORS.tertiary),
    },
  };
}

/** Two-digit hex alpha for a 0-1 opacity, appended to a #rrggbb colour. */
function alphaHex(opacity: number): string {
  const value = Math.max(0, Math.min(255, Math.floor(opacity * 255)));
  return value.toString(16).padStart(2, '0');
}

function nodeCountFor(width: number, height: number): number {
  return Math.max(MIN_NODES, Math.min(MAX_NODES, Math.round((width * height) / AREA_PER_NODE)));
}

function randomTone(): Tone {
  if (Math.random() > 0.7) return 'secondary';
  return Math.random() > 0.5 ? 'tertiary' : 'primary';
}

const CanvasBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let palette = readPalette();
    let reducedMotion = prefersReducedMotion();
    const mouse: { x: number | null; y: number | null } = { x: null, y: null };
    const nodes: Node[] = [];

    let frameId = 0;
    let running = false;
    let lastFrame = 0;
    let resizeFrameId = 0;

    const nodeFill = (node: Node) =>
      palette.colors[node.tone] + alphaHex((NODE_ALPHA * node.glow * (palette.dark ? 200 : 100)) / 255);

    const makeNode = (): Node => {
      const node: Node = {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        radius: Math.random() * 2.5 + 1.5,
        glow: Math.random() * 0.5 + 0.5,
        tone: randomTone(),
        fill: '',
      };
      node.fill = nodeFill(node);
      return node;
    };

    const fitCanvas = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      // Resizing the backing store also resets the context state.
      canvas.width = Math.max(1, Math.round(width * BACKING_SCALE));
      canvas.height = Math.max(1, Math.round(height * BACKING_SCALE));
      ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);

      const wanted = nodeCountFor(width, height);
      while (nodes.length < wanted) nodes.push(makeNode());
      nodes.length = wanted;
      for (const node of nodes) {
        node.x = Math.min(node.x, width - node.radius);
        node.y = Math.min(node.y, height - node.radius);
      }
    };

    const step = (dt: number) => {
      const damping = Math.pow(DAMPING, dt);
      for (const node of nodes) {
        if (mouse.x !== null && mouse.y !== null) {
          const dx = node.x - mouse.x;
          const dy = node.y - mouse.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 0 && distance < INTERACTION_RADIUS) {
            const force = ((INTERACTION_RADIUS - distance) / INTERACTION_RADIUS) * REPULSION_STRENGTH * dt;
            node.vx += (dx / distance) * force;
            node.vy += (dy / distance) * force;
          }
        }

        node.x += node.vx * dt;
        node.y += node.vy * dt;
        node.vx *= damping;
        node.vy *= damping;

        if (Math.abs(node.vx) < 0.05 && Math.abs(node.vy) < 0.05) {
          node.vx += (Math.random() - 0.5) * 0.1;
          node.vy += (Math.random() - 0.5) * 0.1;
        }

        if (node.x - node.radius < 0) {
          node.x = node.radius;
          node.vx *= -0.8;
        } else if (node.x + node.radius > width) {
          node.x = width - node.radius;
          node.vx *= -0.8;
        }
        if (node.y - node.radius < 0) {
          node.y = node.radius;
          node.vy *= -0.8;
        } else if (node.y + node.radius > height) {
          node.y = height - node.radius;
          node.vy *= -0.8;
        }
      }
    };

    // trails: true paints a translucent wash over the last frame (the moving
    // version); false starts from a clean canvas (the static frame).
    const draw = (trails: boolean) => {
      if (trails) {
        ctx.fillStyle = palette.dark ? 'rgba(10, 15, 28, 0.15)' : 'rgba(248, 250, 252, 0.05)';
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      // shadowBlur is in backing-store pixels and ignores the transform.
      ctx.shadowBlur = (palette.dark ? GLOW_BLUR.dark : GLOW_BLUR.light) * BACKING_SCALE;
      const spread = palette.dark ? NODE_SPREAD.dark : NODE_SPREAD.light;
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + spread, 0, Math.PI * 2);
        ctx.fillStyle = node.fill;
        ctx.shadowColor = palette.colors[node.tone];
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      ctx.lineWidth = 0.8;
      const maxLinks = nodes.length * 1.5;
      let links = 0;
      for (let i = 0; i < nodes.length && links <= maxLinks; i++) {
        let nodeLinks = 0;
        for (let j = i + 1; j < nodes.length && nodeLinks < MAX_LINKS_PER_NODE && links <= maxLinks; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= LINK_DISTANCE) continue;
          const opacity = ((palette.dark ? LINK_ALPHA.dark * 0.3 : LINK_ALPHA.light * 0.15) * (LINK_DISTANCE - distance)) / LINK_DISTANCE;
          const color = distance < LINK_DISTANCE / 2 ? palette.colors.secondary : palette.colors.primary;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = color + alphaHex(opacity);
          ctx.stroke();
          nodeLinks++;
          links++;
        }
      }
    };

    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      if (lastFrame && now - lastFrame < FRAME_INTERVAL_MS - 1) return;
      const dt = lastFrame ? Math.min((now - lastFrame) / BASE_STEP_MS, 4) : 1;
      lastFrame = now;
      step(dt);
      draw(true);
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
      draw(false);
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
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    };
    const onMouseLeave = () => {
      mouse.x = null;
      mouse.y = null;
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
      for (const node of nodes) node.fill = nodeFill(node);
      refresh();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);

    fitCanvas();
    draw(false);
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
