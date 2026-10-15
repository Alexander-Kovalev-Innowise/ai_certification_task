import { buildDelta, buildWindows } from './dashboard.service';

describe('dashboard.service helpers', () => {
  describe('buildDelta', () => {
    it('reports an increase as up with the absolute difference', () => {
      expect(buildDelta(7, 3, 'month')).toEqual({ value: 4, period: 'month', direction: 'up' });
    });

    it('reports a decrease as down with a non-negative value', () => {
      expect(buildDelta(1, 4, 'week')).toEqual({ value: 3, period: 'week', direction: 'down' });
    });

    it('reports no change as flat', () => {
      expect(buildDelta(5, 5, 'month')).toEqual({ value: 0, period: 'month', direction: 'flat' });
    });
  });

  describe('buildWindows', () => {
    const now = new Date('2026-10-04T15:30:00.000Z');
    const windows = buildWindows(now);

    it('aligns the 30-day window to UTC midnight so it spans exactly 30 calendar days including today', () => {
      expect(windows.month.from.toISOString()).toBe('2026-09-05T00:00:00.000Z');
      expect(windows.month.to.getTime()).toBeGreaterThan(now.getTime());
    });

    it('places the previous period immediately before the current one', () => {
      expect(windows.previousMonth.to.toISOString()).toBe(windows.month.from.toISOString());
      expect(windows.previousWeek.to.toISOString()).toBe(windows.week.from.toISOString());
      expect(windows.week.from.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    });
  });
});
