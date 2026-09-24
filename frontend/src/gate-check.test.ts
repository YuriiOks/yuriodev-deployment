import { expect, test } from 'vitest';

// Deliberately failing: proves a red test blocks images and stage promotion. Reverted in the next commit.
test('gate check', () => { expect(1).toBe(2); });
