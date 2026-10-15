import { render, screen } from '@testing-library/react';

import { ScrollArea } from './ScrollArea';

describe('ScrollArea', () => {
  it('hides the native scrollbar and forwards viewport props', () => {
    render(
      <ScrollArea role="region" aria-label="List" className="overflow-auto max-h-40">
        <p>content</p>
      </ScrollArea>,
    );

    const viewport = screen.getByRole('region', { name: 'List' });
    expect(viewport).toHaveClass('scroll-hide-native', 'overflow-auto');
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('draws no overlay thumb when nothing overflows (jsdom has no layout)', () => {
    const { container } = render(
      <ScrollArea>
        <p>short</p>
      </ScrollArea>,
    );

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('draws a vertical overlay thumb outside the content flow when the content overflows', () => {
    const originals = {
      scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
      clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    };
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 200 });

    try {
      const { container } = render(
        <ScrollArea insetTop={44}>
          <p>tall</p>
        </ScrollArea>,
      );

      const track = container.querySelector<HTMLElement>('[aria-hidden="true"]');
      expect(track).not.toBeNull();
      expect(track).toHaveClass('absolute', 'right-0');
    } finally {
      if (originals.scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originals.scrollHeight);
      if (originals.clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originals.clientHeight);
    }
  });
});
