import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetryOnResume } from '../feature/src/reconnect-policy';

const base = { enabled: true, failed: false, busy: false, playing: false };

test('returning to the app keeps a working connection and its loaded lists', () => {
    assert.equal(shouldRetryOnResume(base), false);
});

test('returning to the app reconnects only after a failure, never during playback or loading', () => {
    assert.equal(shouldRetryOnResume({ ...base, failed: true }), true);
    assert.equal(shouldRetryOnResume({ ...base, failed: true, playing: true }), false);
    assert.equal(shouldRetryOnResume({ ...base, failed: true, busy: true }), false);
    assert.equal(shouldRetryOnResume({ ...base, failed: true, enabled: false }), false);
});
