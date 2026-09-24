import { formatAvailabilitySummary } from './availability-summary.formatter';

// Task 14.6 (fe §5.4/§11.7) — mirrors
// apps/server/.../associations/availability-summary.formatter.spec.ts
// (Task 5.10) test-for-test, to prove this client-side port produces
// identical output to the server's `RosterRowDto.availabilitySummary`
// formatter, not just similar-looking output.
describe('formatAvailabilitySummary (Task 14.6, client port of server Task 5.10)', () => {
  it('formats the documented example: "Mon 5-8pm, Wed 6-9pm"', () => {
    const summary = formatAvailabilitySummary([
      { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }, // Mon 5pm-8pm
      { dayOfWeek: 3, startTime: 18 * 60, endTime: 21 * 60, isAvailable: true }, // Wed 6pm-9pm
    ]);

    expect(summary).toBe('Mon 5-8pm, Wed 6-9pm');
  });

  it('orders by day then start time regardless of input order', () => {
    const summary = formatAvailabilitySummary([
      { dayOfWeek: 3, startTime: 18 * 60, endTime: 21 * 60, isAvailable: true },
      { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
    ]);

    expect(summary).toBe('Mon 5-8pm, Wed 6-9pm');
  });

  it('excludes isAvailable: false slots', () => {
    const summary = formatAvailabilitySummary([{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: false }]);

    expect(summary).toBe('');
  });

  it('spans am/pm explicitly when the range crosses noon', () => {
    const summary = formatAvailabilitySummary([{ dayOfWeek: 2, startTime: 11 * 60, endTime: 13 * 60, isAvailable: true }]);

    expect(summary).toBe('Tue 11am-1pm');
  });
});
