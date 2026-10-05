import { render, screen } from '@testing-library/react';

import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('renders an accessible svg with a line and an area path', () => {
    const { container } = render(
      <Sparkline
        label="New users per day, last 30 days"
        points={[
          { date: '2026-10-02', value: 1 },
          { date: '2026-10-03', value: 5 },
          { date: '2026-10-04', value: 3 },
        ]}
      />,
    );

    expect(screen.getByRole('img', { name: /new users per day/i })).toBeInTheDocument();
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('draws the maximum at the top and the minimum at the bottom', () => {
    const { container } = render(
      <Sparkline
        label="trend"
        points={[
          { date: '2026-10-03', value: 0 },
          { date: '2026-10-04', value: 10 },
        ]}
      />,
    );

    const line = container.querySelectorAll('path')[1]?.getAttribute('d');
    expect(line).toBe('M2 26 L98 2');
  });

  it('draws a flat series as a centred line without NaN', () => {
    const { container } = render(
      <Sparkline
        label="flat"
        points={[
          { date: '2026-10-03', value: 0 },
          { date: '2026-10-04', value: 0 },
        ]}
      />,
    );

    const line = container.querySelectorAll('path')[1]?.getAttribute('d');
    expect(line).not.toContain('NaN');
    expect(line).toBe('M2 14 L98 14');
  });

  it('renders nothing when there are fewer than two points', () => {
    const { container } = render(<Sparkline label="empty" points={[{ date: '2026-10-04', value: 1 }]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
