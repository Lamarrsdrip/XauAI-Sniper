import assert from 'node:assert/strict';
import test from 'node:test';
import { goBackOrNavigate } from '../src/navigation/safeBack.ts';

test('returns through native stack history when available', () => {
  const calls = [];
  goBackOrNavigate({ canGoBack: () => true, goBack: () => calls.push('back'), navigate: () => calls.push('navigate') }, 'More');
  assert.deepEqual(calls, ['back']);
});

test('uses the root fallback for deep-linked screens with no stack history', () => {
  const calls = [];
  goBackOrNavigate({ canGoBack: () => false, navigate: (route) => calls.push(route) }, 'Signals');
  assert.deepEqual(calls, ['Signals']);
});
