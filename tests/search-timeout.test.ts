import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompatSystemInstructions,
  getModeTimeout,
} from '../src/lib/agents/search/compat.ts';

test('returns the exact timeout for each optimization mode', () => {
  assert.equal(getModeTimeout('speed'), 45_000);
  assert.equal(getModeTimeout('balanced'), 90_000);
  assert.equal(getModeTimeout('quality'), 180_000);
});

test('requests a Korean answer while preserving an existing instruction', () => {
  assert.equal(
    buildCompatSystemInstructions('ko', 'Use bullet points.'),
    'Use bullet points.\nRespond in Korean.',
  );
});

test('does not add a language instruction for other languages', () => {
  assert.equal(buildCompatSystemInstructions('en', 'Be concise.'), 'Be concise.');
  assert.equal(buildCompatSystemInstructions(undefined), '');
});
