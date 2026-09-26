/*
 * The pure maths behind CanvasBackground: how many nodes a window gets, where
 * they start (spread evenly over the whole window), how they follow a resize
 * and how they move. No DOM, no canvas: field.test.ts runs it directly.
 *
 * Units are CSS pixels; speeds are CSS pixels per 60 fps step, and every
 * step takes `dt`, the elapsed time in such steps.
 */

export type Tone = 0 | 1 | 2;

export interface FieldNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Direction of the node's own drift, in radians; it wanders slowly. */
  heading: number;
  /** The drift speed the node settles back to after a push. */
  cruise: number;
  radius: number;
  /** 0.55 to 1: how bright this node is. */
  glow: number;
  tone: Tone;
}

export interface Size {
  width: number;
  height: number;
}

export interface Pointer {
  x: number;
  y: number;
}

/** A source of numbers in [0, 1); Math.random in the page, seeded in tests. */
export type Random = () => number;

export const MIN_NODES = 18;
// Capped at 60 (not the area formula's un-clamped result) so a very large or
// very high-resolution screen never costs more to animate than a normal one:
// fluid scaling makes the dots and links themselves bigger there instead
// (CanvasBackground.tsx's typeScale), not more numerous.
export const MAX_NODES = 60;
export const AREA_PER_NODE = 20000; // CSS px² per node
export const MIN_SPEED = 0.12;
export const MAX_SPEED = 0.3;
export const INTERACTION_RADIUS = 120;
export const REPULSION_STRENGTH = 0.6;
/** How fast a pushed node eases back to its drift (share of the gap per step). */
const SETTLE = 0.02;
/** How far a heading can wander per step, in radians. */
const WANDER = 0.08;

export function nodeCountFor({ width, height }: Size): number {
  return Math.max(MIN_NODES, Math.min(MAX_NODES, Math.round((width * height) / AREA_PER_NODE)));
}

/** How close two nodes must be to be linked: about 1.3 node spacings, 140 to 240px. */
export function linkDistanceFor(size: Size, count: number): number {
  const spacing = Math.sqrt((size.width * size.height) / Math.max(1, count));
  return Math.max(140, Math.min(240, spacing * 1.3));
}

function randomTone(rand: Random): Tone {
  const r = rand();
  if (r < 0.45) return 0;
  if (r < 0.75) return 2;
  return 1;
}

export function makeNode(x: number, y: number, rand: Random): FieldNode {
  const heading = rand() * Math.PI * 2;
  const cruise = MIN_SPEED + rand() * (MAX_SPEED - MIN_SPEED);
  return {
    x,
    y,
    vx: Math.cos(heading) * cruise,
    vy: Math.sin(heading) * cruise,
    heading,
    cruise,
    radius: 1.2 + rand() * 1.4,
    glow: 0.55 + rand() * 0.45,
    tone: randomTone(rand),
  };
}

/**
 * `count` points spread evenly over the area: a grid shaped like the area,
 * one point per chosen cell, each jittered inside the middle of its cell.
 * When the grid has more cells than points, the chosen cells are spaced
 * evenly through it, so no side is left empty.
 */
export function jitteredGrid(count: number, { width, height }: Size, rand: Random): Array<{ x: number; y: number }> {
  if (count <= 0 || width <= 0 || height <= 0) return [];
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cells = cols * rows;
  const cellW = width / cols;
  const cellH = height / rows;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const cell = Math.floor((i * cells) / count);
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    points.push({
      x: (col + 0.15 + rand() * 0.7) * cellW,
      y: (row + 0.15 + rand() * 0.7) * cellH,
    });
  }
  return points;
}

export function seedNodes(count: number, size: Size, rand: Random): FieldNode[] {
  return jitteredGrid(count, size, rand).map(({ x, y }) => makeNode(x, y, rand));
}

const distance2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * The nodes after the window changes from `from` to `to`: every position
 * scaled in proportion, so the pattern keeps its shape across the new area;
 * then nodes added where the field is emptiest (or removed where it is most
 * crowded) until there are `count`.
 */
export function rescaleNodes(nodes: readonly FieldNode[], from: Size, to: Size, count: number, rand: Random): FieldNode[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  const out = nodes.map((node) => ({
    ...node,
    x: Math.min(Math.max(node.x * sx, node.radius), Math.max(node.radius, to.width - node.radius)),
    y: Math.min(Math.max(node.y * sy, node.radius), Math.max(node.radius, to.height - node.radius)),
  }));

  if (out.length < count) {
    // Candidates on an even grid over the new area; take the one farthest
    // from every node so far, again and again.
    const candidates = jitteredGrid(Math.max(count * 2, 16), to, rand);
    while (out.length < count && candidates.length > 0) {
      let best = 0;
      let bestDistance = -1;
      candidates.forEach((candidate, index) => {
        let nearest = Infinity;
        for (const node of out) nearest = Math.min(nearest, distance2(candidate, node));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          best = index;
        }
      });
      const [spot] = candidates.splice(best, 1);
      out.push(makeNode(spot.x, spot.y, rand));
    }
  }

  while (out.length > count) {
    // Drop the node with the closest neighbour: the most crowded spot.
    let crowded = 0;
    let crowdedDistance = Infinity;
    out.forEach((node, index) => {
      for (let j = 0; j < out.length; j += 1) {
        if (j === index) continue;
        const d = distance2(node, out[j]);
        if (d < crowdedDistance) {
          crowdedDistance = d;
          crowded = index;
        }
      }
    });
    out.splice(crowded, 1);
  }
  return out;
}

/**
 * Moves every node by one step of `dt`: each drifts along a slowly wandering
 * heading at its own cruise speed (so the field never freezes), the pointer
 * pushes nearby nodes away, a pushed node eases back to its drift, and nodes
 * bounce off the edges. `scale` (default 1, CanvasBackground.tsx's typeScale)
 * grows the pointer's reach and each node's effective radius for the bounce,
 * to match the bigger radius it is actually drawn at on a large screen.
 */
export function stepNodes(
  nodes: FieldNode[],
  dt: number,
  { width, height }: Size,
  pointer: Pointer | null,
  rand: Random,
  scale = 1,
): void {
  const settle = 1 - Math.pow(1 - SETTLE, dt);
  const interactionRadius = INTERACTION_RADIUS * scale;
  for (const node of nodes) {
    node.heading += (rand() - 0.5) * 2 * WANDER * dt;
    const targetX = Math.cos(node.heading) * node.cruise;
    const targetY = Math.sin(node.heading) * node.cruise;
    node.vx += (targetX - node.vx) * settle;
    node.vy += (targetY - node.vy) * settle;

    if (pointer) {
      const dx = node.x - pointer.x;
      const dy = node.y - pointer.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 0 && distance < interactionRadius) {
        const force = ((interactionRadius - distance) / interactionRadius) * REPULSION_STRENGTH * dt;
        node.vx += (dx / distance) * force;
        node.vy += (dy / distance) * force;
      }
    }

    node.x += node.vx * dt;
    node.y += node.vy * dt;

    const radius = node.radius * scale;
    let bounced = false;
    if (node.x < radius) {
      node.x = radius;
      node.vx = Math.abs(node.vx);
      bounced = true;
    } else if (node.x > width - radius) {
      node.x = width - radius;
      node.vx = -Math.abs(node.vx);
      bounced = true;
    }
    if (node.y < radius) {
      node.y = radius;
      node.vy = Math.abs(node.vy);
      bounced = true;
    } else if (node.y > height - radius) {
      node.y = height - radius;
      node.vy = -Math.abs(node.vy);
      bounced = true;
    }
    // After a bounce the drift heads the new way too, not back into the edge.
    if (bounced) node.heading = Math.atan2(node.vy, node.vx);
  }
}

/** A small seeded generator (mulberry32), for tests and repeatable layouts. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
