import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Media } from '@meddl/tv/util';
import { episodeAfter } from '../feature/src/episode-order';

const ep = (id: string, season?: number, episode?: number) =>
    ({ id, kind: 'episode', season, episode, sourceId: 's', providerId: id, title: id, raw: {} }) as Media;

test('the next episode follows season and episode numbers, across seasons', () => {
    const list = [ep('s2e1', 2, 1), ep('s1e2', 1, 2), ep('s1e1', 1, 1)];
    assert.equal(episodeAfter(ep('s1e1', 1, 1), list)?.id, 's1e2');
    assert.equal(episodeAfter(ep('s1e2', 1, 2), list)?.id, 's2e1');
    assert.equal(episodeAfter(ep('s2e1', 2, 1), list), undefined);
});

test('episodes without numbers keep the provider order; unknown episodes have no next', () => {
    const list = [ep('a'), ep('b'), ep('c')];
    assert.equal(episodeAfter(ep('a'), list)?.id, 'b');
    assert.equal(episodeAfter(ep('x'), list), undefined);
});
