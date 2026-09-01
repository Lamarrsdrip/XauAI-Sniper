import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNotificationPrefs } from '../src/api/notificationPrefs.ts';
import { looksCustomerSafe, presentCode, presentCustomerText, signalProgressLabel, signalStatusLabel } from '../src/utils/presentation.ts';

test('normalizes an empty or legacy preference document to a safe model', () => {
  assert.deepEqual(normalizeNotificationPrefs({ user_id: 'legacy-user', tier: 'ALL_UPDATES' }), {
    user_id: 'legacy-user',
    tier: 'ALL_UPDATES',
    quiet_hours_start: null,
    quiet_hours_end: null,
    notify_all_devices: true,
    muted_categories: [],
  });
});

test('rejects malformed preference values and unknown legacy categories', () => {
  assert.deepEqual(normalizeNotificationPrefs({
    user_id: 17,
    tier: 'EVERYTHING',
    quiet_hours_start: '9',
    quiet_hours_end: 24,
    notify_all_devices: 'yes',
    muted_categories: ['TRADES', 'UNKNOWN', null, 'TRADES', 'ACADEMY'],
  }, 'fallback-user'), {
    user_id: 'fallback-user',
    tier: 'OFF',
    quiet_hours_start: null,
    quiet_hours_end: null,
    notify_all_devices: true,
    muted_categories: ['TRADES', 'ACADEMY'],
  });
});

test('preserves valid preference values', () => {
  const prefs = normalizeNotificationPrefs({
    user_id: 'u1',
    tier: 'HOURLY_PLUS_RESULTS',
    quiet_hours_start: 22,
    quiet_hours_end: 7,
    notify_all_devices: false,
    muted_categories: ['M10_ENGINE', 'SIGNAL_OUTCOMES'],
  });
  assert.equal(prefs.tier, 'HOURLY_PLUS_RESULTS');
  assert.equal(prefs.quiet_hours_start, 22);
  assert.deepEqual(prefs.muted_categories, ['M10_ENGINE', 'SIGNAL_OUTCOMES']);
});

test('converts internal trading codes and partial-target stops into customer language', () => {
  assert.equal(presentCode('NO_VALID_OUTLOOK'), 'No confirmed Gold setup yet');
  assert.equal(presentCode('WAITING_FOR_NEW_PRIMARY_BAR'), 'Waiting for the next confirmed market bar');
  assert.equal(signalStatusLabel({ status: 'SL_HIT', tp1_hit_at: '2026-01-01T00:00:00Z', tp2_hit_at: null, tp3_hit_at: null }), 'First target hit · remainder stopped');
  assert.equal(signalProgressLabel({ status: 'SL_HIT', tp1_hit_at: '2026-01-01T00:00:00Z', tp2_hit_at: null, tp3_hit_at: null }), 'TP1 hit · remainder stopped');
});

test('translates internal codes embedded in a customer-facing outlook explanation', () => {
  assert.equal(
    presentCustomerText('Location: LOCATION_RESET_CONFIRMED. Structure: STRUCTURE_OPPOSES.'),
    'Location: Price has returned to a more favorable area. Structure: Market structure is still pushing against the setup.',
  );
});

// Regression for a real bug: api/client.ts previously discarded every
// backend error `detail` outside 401/403/404/429, even when the backend
// had already written a clean sentence (e.g. Billing checkout's "Payment
// system not configured yet."), making a real, actionable, already-safe
// error indistinguishable from a generic failure.
test('looksCustomerSafe lets an already-clean backend sentence through', () => {
  assert.equal(looksCustomerSafe('Payment system not configured yet.'), true);
  assert.equal(looksCustomerSafe('Card payment is not currently available.'), true);
  assert.equal(looksCustomerSafe('This plan is not currently on sale.'), true);
});

test('looksCustomerSafe rejects raw backend codes/enums', () => {
  assert.equal(looksCustomerSafe('NOT_ENTITLED'), false);
  assert.equal(looksCustomerSafe('PAYMENT_SYSTEM_NOT_CONFIGURED'), false);
  assert.equal(looksCustomerSafe('INVALID PLAN ID'), false);
  assert.equal(looksCustomerSafe(''), false);
  assert.equal(looksCustomerSafe('   '), false);
});
