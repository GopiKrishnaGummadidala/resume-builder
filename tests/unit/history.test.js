import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../../js/history.js';

describe('createHistory', () => {
  test('starts with nothing to undo or redo', () => {
    const h = createHistory('a');
    assert.equal(h.canUndo, false);
    assert.equal(h.canRedo, false);
    assert.equal(h.undo(), null);
    assert.equal(h.redo(), null);
  });

  test('undo and redo walk through the recorded snapshots', () => {
    const h = createHistory('a');
    assert.equal(h.record('b'), true);
    assert.equal(h.record('c'), true);
    assert.equal(h.undo(), 'b');
    assert.equal(h.undo(), 'a');
    assert.equal(h.undo(), null);
    assert.equal(h.redo(), 'b');
    assert.equal(h.redo(), 'c');
    assert.equal(h.redo(), null);
  });

  test('recording the same snapshot again adds no step', () => {
    const h = createHistory('a');
    assert.equal(h.record('a'), false);
    assert.equal(h.canUndo, false);
  });

  test('a new change after undo discards the undone steps', () => {
    const h = createHistory('a');
    h.record('b');
    h.record('c');
    h.undo();
    h.record('d');
    assert.equal(h.canRedo, false);
    assert.equal(h.undo(), 'b');
    assert.equal(h.redo(), 'd');
  });

  test('keeps at most `limit` snapshots, dropping the oldest', () => {
    const h = createHistory('0', 3);
    ['1', '2', '3', '4'].forEach(s => h.record(s));
    assert.equal(h.undo(), '3');
    assert.equal(h.undo(), '2');
    assert.equal(h.undo(), null);
  });
});
