import { describe, expect, it } from 'vitest';
import {
  MAX_NODES,
  MIN_NODES,
  MIN_SPEED,
  jitteredGrid,
  linkDistanceFor,
  nodeCountFor,
  rescaleNodes,
  seedNodes,
  seededRandom,
  stepNodes,
  type FieldNode,
  type Size,
} from './field';

/** How many points fall in each cell of a cols x rows grid over `size`. */
function histogram(points: ReadonlyArray<{ x: number; y: number }>, size: Size, cols: number, rows: number): number[] {
  const counts = new Array(cols * rows).fill(0);
  for (const { x, y } of points) {
    const col = Math.min(cols - 1, Math.floor((x / size.width) * cols));
    const row = Math.min(rows - 1, Math.floor((y / size.height) * rows));
    counts[row * cols + col] += 1;
  }
  return counts;
}

const speed = (node: FieldNode) => Math.hypot(node.vx, node.vy);

describe('nodeCountFor', () => {
  it('scales with the area between a floor and a cap', () => {
    expect(nodeCountFor({ width: 375, height: 812 })).toBe(MIN_NODES);
    expect(nodeCountFor({ width: 1280, height: 800 })).toBe(51);
    expect(nodeCountFor({ width: 2560, height: 1440 })).toBe(MAX_NODES);
  });

  it('links nodes at about 1.3 spacings, within 140 to 240px', () => {
    expect(linkDistanceFor({ width: 1280, height: 800 }, 51)).toBeCloseTo(1.3 * Math.sqrt((1280 * 800) / 51), 5);
    expect(linkDistanceFor({ width: 4000, height: 3000 }, 80)).toBe(240);
    expect(linkDistanceFor({ width: 200, height: 200 }, 80)).toBe(140);
  });
});

describe('seeding', () => {
  it('spreads the nodes over the whole area, every region of it', () => {
    const size = { width: 2000, height: 1100 };
    const nodes = seedNodes(80, size, seededRandom(1));
    expect(nodes).toHaveLength(80);
    for (const node of nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(size.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(size.height);
    }
    // A 4 x 3 grid of regions: each holds its fair share (80 / 12 is about 6.7), give or take.
    const counts = histogram(nodes, size, 4, 3);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...counts)).toBeLessThanOrEqual(10);
  });

  it('reaches the edges on both axes', () => {
    const size = { width: 1440, height: 900 };
    const points = jitteredGrid(60, size, seededRandom(7));
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    expect(Math.min(...xs)).toBeLessThan(size.width * 0.12);
    expect(Math.max(...xs)).toBeGreaterThan(size.width * 0.88);
    expect(Math.min(...ys)).toBeLessThan(size.height * 0.15);
    expect(Math.max(...ys)).toBeGreaterThan(size.height * 0.85);
  });

  it('starts every node moving', () => {
    for (const node of seedNodes(40, { width: 1000, height: 800 }, seededRandom(3))) {
      expect(speed(node)).toBeGreaterThanOrEqual(MIN_SPEED - 1e-9);
    }
  });

  it('returns nothing for an empty area', () => {
    expect(jitteredGrid(10, { width: 0, height: 500 }, seededRandom(1))).toEqual([]);
  });
});

describe('rescaleNodes', () => {
  it('moves every node in proportion to the new size', () => {
    const rand = seededRandom(2);
    const nodes = seedNodes(20, { width: 1000, height: 1000 }, rand);
    const moved = rescaleNodes(nodes, { width: 1000, height: 1000 }, { width: 2000, height: 1500 }, 20, rand);
    expect(moved).toHaveLength(20);
    moved.forEach((node, i) => {
      expect(node.x).toBeCloseTo(nodes[i].x * 2, 5);
      expect(node.y).toBeCloseTo(nodes[i].y * 1.5, 5);
    });
  });

  it('after the window widens, the nodes cover the new area evenly (not bunched on the left)', () => {
    const rand = seededRandom(4);
    const from = { width: 1024, height: 768 };
    const to = { width: 2560, height: 1440 };
    const nodes = rescaleNodes(seedNodes(nodeCountFor(from), from, rand), from, to, nodeCountFor(to), rand);
    expect(nodes).toHaveLength(nodeCountFor(to));
    const counts = histogram(nodes, to, 4, 2);
    const fair = nodes.length / counts.length;
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(fair * 0.5);
    expect(Math.max(...counts)).toBeLessThanOrEqual(fair * 1.6);
  });

  it('removes nodes from the most crowded spots when the window shrinks', () => {
    const rand = seededRandom(5);
    const from = { width: 1920, height: 1080 };
    const to = { width: 800, height: 600 };
    const nodes = rescaleNodes(seedNodes(80, from, rand), from, to, 24, rand);
    expect(nodes).toHaveLength(24);
    for (const node of nodes) {
      expect(node.x).toBeLessThanOrEqual(to.width);
      expect(node.y).toBeLessThanOrEqual(to.height);
    }
    const counts = histogram(nodes, to, 2, 2);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(3);
  });
});

describe('stepNodes', () => {
  it('keeps drifting forever without a pointer: no node freezes, none leaves the area', () => {
    const rand = seededRandom(6);
    const size = { width: 1200, height: 800 };
    const nodes = seedNodes(40, size, rand);
    for (let i = 0; i < 3000; i += 1) stepNodes(nodes, 2, size, null, rand);
    for (const node of nodes) {
      expect(speed(node)).toBeGreaterThan(MIN_SPEED * 0.8);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(size.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(size.height);
    }
  });

  it('the field stays spread out over time', () => {
    const rand = seededRandom(8);
    const size = { width: 1600, height: 900 };
    const nodes = seedNodes(72, size, rand);
    for (let i = 0; i < 2000; i += 1) stepNodes(nodes, 2, size, null, rand);
    const counts = histogram(nodes, size, 2, 2);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
  });

  it('the pointer pushes nearby nodes away, and they settle back to their drift', () => {
    const rand = seededRandom(9);
    const size = { width: 1000, height: 1000 };
    const [node] = seedNodes(1, size, rand);
    node.x = 500;
    node.y = 500;
    const pointer = { x: 470, y: 500 };
    stepNodes([node], 1, size, pointer, rand);
    expect(node.vx).toBeGreaterThan(0.2);
    expect(node.x).toBeGreaterThan(500);

    for (let i = 0; i < 400; i += 1) stepNodes([node], 1, size, null, rand);
    expect(speed(node)).toBeCloseTo(node.cruise, 1);
  });
});
