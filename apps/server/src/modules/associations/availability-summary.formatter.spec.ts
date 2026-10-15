import { computeSuggestedWindows, formatAvailabilitySummary, formatSuggestedRange } from './availability-summary.formatter';

describe('formatAvailabilitySummary (Task 5.10)', () => {
  it('formats the documented example: "Best Times: Mon 5-8pm, Wed 6-9pm"', () => {
    const summary = formatAvailabilitySummary([
      { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }, // Mon 5pm-8pm
      { dayOfWeek: 3, startTime: 18 * 60, endTime: 21 * 60, isAvailable: true }, // Wed 6pm-9pm
    ]);

    expect(summary).toBe('Best Times: Mon 5-8pm, Wed 6-9pm');
  });

  it('orders by day then start time regardless of input order', () => {
    const summary = formatAvailabilitySummary([
      { dayOfWeek: 3, startTime: 18 * 60, endTime: 21 * 60, isAvailable: true },
      { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
    ]);

    expect(summary).toBe('Best Times: Mon 5-8pm, Wed 6-9pm');
  });

  it('excludes isAvailable: false slots', () => {
    const summary = formatAvailabilitySummary([
      { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: false },
    ]);

    expect(summary).toBe('');
  });

  it('spans am/pm explicitly when the range crosses noon', () => {
    const summary = formatAvailabilitySummary([{ dayOfWeek: 2, startTime: 11 * 60, endTime: 13 * 60, isAvailable: true }]);

    expect(summary).toBe('Best Times: Tue 11am-1pm');
  });
});

describe('computeSuggestedWindows / formatSuggestedRange (US-01.09 suggest session times)', () => {
  const slot = (playerProfileId: string, dayOfWeek: number, startHour: number, endHour: number, isAvailable = true) => ({
    playerProfileId,
    dayOfWeek,
    startTime: startHour * 60,
    endTime: endHour * 60,
    isAvailable,
  });

  it('ranks windows by the number of players available, then by length', () => {
    const windows = computeSuggestedWindows([
      slot('a', 1, 17, 20),
      slot('b', 1, 17, 20),
      slot('c', 1, 17, 20),
      slot('a', 3, 18, 21),
      slot('b', 3, 18, 21),
      slot('c', 5, 9, 10),
    ]);

    expect(windows).toEqual([
      { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, availableCount: 3 },
      { dayOfWeek: 3, startTime: 18 * 60, endTime: 21 * 60, availableCount: 2 },
      { dayOfWeek: 5, startTime: 9 * 60, endTime: 10 * 60, availableCount: 1 },
    ]);
  });

  it('splits a day where only part of the group overlaps and counts each player once', () => {
    const windows = computeSuggestedWindows([
      slot('a', 2, 16, 20),
      slot('b', 2, 18, 22),
      slot('b', 2, 19, 21), // overlapping duplicate of the same player
    ]);

    expect(windows).toEqual([
      { dayOfWeek: 2, startTime: 18 * 60, endTime: 20 * 60, availableCount: 2 },
      { dayOfWeek: 2, startTime: 16 * 60, endTime: 18 * 60, availableCount: 1 },
      { dayOfWeek: 2, startTime: 20 * 60, endTime: 22 * 60, availableCount: 1 },
    ]);
  });

  it('merges back-to-back slots of the same player into one window', () => {
    const windows = computeSuggestedWindows([slot('a', 4, 9, 11), slot('a', 4, 11, 13)]);

    expect(windows).toEqual([{ dayOfWeek: 4, startTime: 9 * 60, endTime: 13 * 60, availableCount: 1 }]);
  });

  it('ignores isAvailable: false slots and empty input, and caps the result at 3', () => {
    expect(computeSuggestedWindows([slot('a', 1, 17, 20, false)])).toEqual([]);
    expect(computeSuggestedWindows([])).toEqual([]);

    const many = [0, 1, 2, 3, 4].map((day) => slot('a', day, 10, 11));
    expect(computeSuggestedWindows(many)).toHaveLength(3);
  });

  it('is deterministic: ties fall back to the earlier day, then the earlier start', () => {
    const windows = computeSuggestedWindows([slot('a', 4, 10, 11), slot('a', 2, 15, 16), slot('a', 2, 9, 10)]);

    expect(windows.map((w) => [w.dayOfWeek, w.startTime / 60])).toEqual([
      [2, 9],
      [2, 15],
      [4, 10],
    ]);
  });

  it('formats labels like "Mon 5:00-8:00 PM", naming both periods when the window crosses noon', () => {
    expect(formatSuggestedRange(1, 17 * 60, 20 * 60)).toBe('Mon 5:00-8:00 PM');
    expect(formatSuggestedRange(6, 9 * 60 + 30, 11 * 60)).toBe('Sat 9:30-11:00 AM');
    expect(formatSuggestedRange(2, 11 * 60, 13 * 60)).toBe('Tue 11:00 AM-1:00 PM');
  });
});
