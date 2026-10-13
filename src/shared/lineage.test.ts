import { describe, expect, it } from 'vitest';
import { type Blood, ZERO_LIN, affinityPrint, branchNx, inherit, newNx, nixOf, seven, zeroBlood } from './lineage.ts';
import { seeded } from './rng.ts';

const lin = (no: number, nx: string, name = `L${no}`) => ({ no, name, nx });
const blood = (a: string, b: string, c: string, d: string): Blood => [lin(1, a), lin(2, b), lin(3, c), lin(4, d)];

describe('lineage codes', () => {
  it('seven() appends the sum of the six digits mod 6', () => {
    expect(seven('000000')).toBe('0000000');
    expect(seven('123450')).toBe('1234503'); // 1+2+3+4+5+0 = 15 -> 3
  });

  it('new codes are six digits 0..5 plus a type digit', () => {
    const rng = seeded(3);
    for (let i = 0; i < 100; i++) {
      const nx = newNx(rng);
      expect(nx).toMatch(/^[0-5]{6}[0-5]$/);
      expect(branchNx(nx, rng)).toMatch(/^[0-5]{7}$/);
    }
  });
});

describe('inheritance', () => {
  it('a child takes [mother.1, mother.3, father.1, father.3], so it joins its father\'s lineage', () => {
    const m = blood('0000000', '1111111', '2222222', '3333333');
    const f = blood('4444444', '5555555', '0123450', '1234501');
    const { blood: c } = inherit(m, f, 99, seeded(1));
    expect(c).toEqual([m[1], m[3], f[1], f[3]]);
    expect(c[3]).toEqual(f[3]);
  });

  it('an unknown seed founds a new lineage numbered after the newborn', () => {
    const m = blood('0000000', '1111111', '2222222', '3333333');
    const { blood: c } = inherit(m, null, 77, seeded(2));
    expect(c[3].no).toBe(77);
    expect(c[3].name).toBe('');
    expect(c[3].nx).toMatch(/^[0-5]{7}$/);
    expect(c[2]).toEqual(ZERO_LIN);
  });
});

describe('nicks (lineage compatibility)', () => {
  it('a world without lineages changes nothing', () => {
    const { mult } = nixOf(zeroBlood(), 1);
    for (const m of mult) expect(m).toBeCloseTo(1, 10);
  });

  it('digits adding up to 5 lift a stat, and the lineage types add their own bonus', () => {
    // slots: 10 = 母母父, 11 = 母父 (digit 0 = 2, type 1), 12 = 父母父, 13 = 父 (digit 0 = 3, type 2)
    const b: Blood = [lin(1, '0000000'), lin(2, '2000001'), lin(3, '0000000'), lin(4, '3000002')];
    const n = nixOf(b, 4);
    expect(n.mult[0]).toBeCloseTo(1.1, 10); // 2 + 3 = 5
    expect(n.mult[1]).toBeCloseTo(1.2, 10); // mother-father lineage type = STM: 1.05 + 0.15
    expect(n.mult[2]).toBeCloseTo(1.15, 10); // father lineage type = STR: 1.05 + 0.10
    expect(n.mult[3]).toBeCloseTo(1.05, 10);
    expect(n.print).toBe('○☆◎△△△');
  });

  it('too few different lineages is penalised (inbreeding)', () => {
    const same: Blood = [lin(1, '1111114'), lin(1, '1111114'), lin(1, '1111114'), lin(1, '1111114')];
    for (const m of nixOf(same, 1).mult) expect(m).toBeLessThanOrEqual(1);
  });

  it('affinity list: same lineage on both sides shows as all crosses', () => {
    const mine: Blood = [lin(9, '0000000'), lin(5, '1111110'), lin(9, '0000000'), lin(5, '1111110')];
    expect(affinityPrint(mine, lin(5, '1111110'))).toBe('××××××');
    expect(affinityPrint(mine, lin(6, '4444441'))).not.toBe('××××××');
  });
});
