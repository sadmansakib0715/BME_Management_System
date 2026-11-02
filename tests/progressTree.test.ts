import { describe, expect, it } from 'vitest';
import { buildForest, nextActions, rollUp, type PNode } from '../src/lib/progressTree';

const tree: PNode = { id: 'r', label: 'BME 301', children: [
  { id: 's', label: 'Setup', children: [{ id: 'a', label: 'COs', state: 'done' }, { id: 'b', label: 'Mapping', state: 'done' }] },
  { id: 'e', label: 'Term final', children: [
    { id: 'q', label: 'Questions', state: 'active' }, { id: 'm', label: 'Moderation', state: 'locked' }, { id: 'x', label: 'Old CT', state: 'na' }] },
  { id: 'c', label: 'Close-out', children: [{ id: 'f', label: 'Feedback', state: 'ready' }, { id: 'car', label: 'CAR', state: 'returned' }] },
] };

describe('progress tree', () => {
  const r = rollUp(tree);
  it('rolls states up', () => {
    expect(r.children!.map((c) => c.state)).toEqual(['done', 'active', 'returned']);
    expect(r.state).toBe('returned');
  });
  it('counts leaves and skips not-used ones', () => {
    expect([r.done, r.total]).toEqual([2, 6]);
  });
  it('puts fixes first, then work in progress, then what can start', () => {
    expect(nextActions(r).map((n) => n.node.id)).toEqual(['car', 'q', 'f']);
    expect(nextActions(r)[0].path).toEqual(['Close-out']);
  });
});

describe('multi-course tree', () => {
  const done: PNode = { id: 'd', label: 'BME 101', children: [{ id: 'd1', label: 'COs', state: 'done' }] };
  it('puts courses under one root and adds up their steps', () => {
    const f = buildForest('My courses', undefined, [{ node: tree }, { node: done }]);
    expect(f.children!.map((c) => c.label)).toEqual(['BME 301', 'BME 101']);
    expect([f.done, f.total]).toEqual([3, 7]);
    expect(nextActions(f)[0].path).toEqual(['BME 301', 'Close-out']);
  });
  it('groups courses when asked', () => {
    const f = buildForest('BME', undefined, [{ node: done, group: 'Level 1, Term 1' }, { node: tree, group: 'Level 3, Term 1' }]);
    expect(f.children!.map((c) => [c.label, c.state])).toEqual([['Level 1, Term 1', 'done'], ['Level 3, Term 1', 'returned']]);
  });
});
