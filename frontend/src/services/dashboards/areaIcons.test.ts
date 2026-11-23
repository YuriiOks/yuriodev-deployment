import { describe, expect, it } from 'vitest';
import { isDrawnIcon } from '../../components/dashboards/ProjectIcon/iconPaths';
import { AREA_ICON, areaIconName } from './areaIcons';

const AREA_IDS = ['money', 'work-income', 'court-paperwork', 'health-sport', 'romantic', 'friends', 'family', 'travel', 'home', 'hobbies-growth'];

describe('the life area icons', () => {
  it('map each of the ten catalog ids to a drawing the set has, and a few of them to the agreed ones', () => {
    expect(Object.keys(AREA_ICON).sort()).toEqual([...AREA_IDS].sort());
    for (const id of AREA_IDS) expect(isDrawnIcon(areaIconName(id)), id).toBe(true);
    expect(areaIconName('money')).toBe('wallet');
    expect(areaIconName('work-income')).toBe('briefcase');
    expect(areaIconName('travel')).toBe('plane');
    expect(areaIconName('home')).toBe('home');
  });

  it('gives an unknown, empty or inherited id the neutral dot, so a new area never breaks the list', () => {
    for (const id of ['brand-new-area', '', null, undefined, 'toString', 'constructor']) expect(areaIconName(id)).toBe('dot');
    expect(isDrawnIcon('dot')).toBe(true);
  });
});
