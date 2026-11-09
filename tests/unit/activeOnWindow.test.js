const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolveActiveOnWindow } = require('../../src/server/utils/activeOnWindow');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('activeOnWindow.js', () => {
  test('legacy ?date= becomes from = to covering exactly one day', () => {
    const result = resolveActiveOnWindow({ date: '2026-10-23' });
    assert.equal(result.error, undefined);
    assert.equal(result.from, '2026-10-23');
    assert.equal(result.to, '2026-10-23');
    assert.equal(result.endMs - result.startMs, DAY_MS);
    // startMs must be LOCAL midnight of the chosen day - the same day key
    // getMessageDateKey produces on the client.
    assert.equal(result.startMs, new Date(2026, 9, 23).getTime());
  });

  test('from..to window covers the whole "to" day', () => {
    const result = resolveActiveOnWindow({ from: '2026-10-01', to: '2026-10-07' });
    assert.equal(result.from, '2026-10-01');
    assert.equal(result.to, '2026-10-07');
    assert.equal(result.endMs - result.startMs, 7 * DAY_MS);
  });

  test('inverted from/to is swapped, window width unchanged', () => {
    const ordered = resolveActiveOnWindow({ from: '2026-10-01', to: '2026-10-07' });
    const inverted = resolveActiveOnWindow({ from: '2026-10-07', to: '2026-10-01' });
    assert.equal(inverted.from, '2026-10-01');
    assert.equal(inverted.to, '2026-10-07');
    assert.equal(inverted.startMs, ordered.startMs);
    assert.equal(inverted.endMs, ordered.endMs);
  });

  test('only "from" is unbounded upward; only "to" includes its whole day', () => {
    const fromOnly = resolveActiveOnWindow({ from: '2026-10-01' });
    assert.equal(fromOnly.startMs, new Date(2026, 9, 1).getTime());
    assert.equal(fromOnly.endMs, null);

    const toOnly = resolveActiveOnWindow({ to: '2026-10-07' });
    assert.equal(toOnly.startMs, null);
    assert.equal(toOnly.endMs, new Date(2026, 9, 8).getTime());
  });

  test('missing range without legacy date errors', () => {
    assert.equal(resolveActiveOnWindow({}).error, 'MISSING_RANGE');
    assert.equal(resolveActiveOnWindow({ from: '', to: '' }).error, 'MISSING_RANGE');
  });

  test('malformed dates are rejected', () => {
    assert.equal(resolveActiveOnWindow({ from: '23/10/2026' }).error, 'BAD_FORMAT');
    assert.equal(resolveActiveOnWindow({ from: '2026-10-2' }).error, 'BAD_FORMAT');
    assert.equal(resolveActiveOnWindow({ to: 'not-a-date' }).error, 'BAD_FORMAT');
  });

  test('well-formed but impossible dates error instead of throwing', () => {
    assert.equal(resolveActiveOnWindow({ from: '2026-13-99' }).error, 'BAD_DATE');
  });

  test('from/to take precedence over the legacy date param', () => {
    const result = resolveActiveOnWindow({ from: '2026-10-01', to: '2026-10-07', date: '2026-10-23' });
    assert.equal(result.from, '2026-10-01');
    assert.equal(result.to, '2026-10-07');
  });
});
