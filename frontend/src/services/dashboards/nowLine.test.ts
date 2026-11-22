import { describe, expect, it } from 'vitest';
import { nowOffsetHours } from './nowLine';

const HOURS = Array.from({ length: 12 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`);
const at = (h: number, m: number) => new Date(2026, 10, 23, h, m);

describe('nowOffsetHours', () => {
  it('is the time since the grid opens, in hours', () => {
    expect(nowOffsetHours(at(9, 0), HOURS)).toBe(0);
    expect(nowOffsetHours(at(10, 30), HOURS)).toBe(1.5);
    expect(nowOffsetHours(at(20, 59), HOURS)).toBeCloseTo(11.983, 2);
  });

  it('is null outside the grid (before 09:00, from 21:00)', () => {
    expect(nowOffsetHours(at(8, 59), HOURS)).toBeNull();
    expect(nowOffsetHours(at(21, 0), HOURS)).toBeNull();
    expect(nowOffsetHours(at(2, 15), HOURS)).toBeNull();
  });
});
