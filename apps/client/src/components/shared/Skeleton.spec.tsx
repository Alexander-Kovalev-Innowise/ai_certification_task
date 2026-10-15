import { render } from '@testing-library/react';

import { SkeletonCard, SkeletonGridCell, SkeletonRow } from './Skeleton';

describe('Skeleton primitives', () => {
  it('SkeletonRow renders a single decorative placeholder element', () => {
    const { container } = render(<SkeletonRow />);
    const el = container.firstElementChild;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el?.className).toContain('animate-pulse');
  });

  it('SkeletonCard renders a title line and a body line inside a card shell', () => {
    const { container } = render(<SkeletonCard />);
    const card = container.firstElementChild;
    expect(card).toHaveAttribute('aria-hidden', 'true');
    expect(card?.children).toHaveLength(2);
  });

  it('SkeletonGridCell renders a single decorative placeholder element', () => {
    const { container } = render(<SkeletonGridCell />);
    const el = container.firstElementChild;
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards a custom className alongside the base skeleton styles', () => {
    const { container } = render(<SkeletonRow className="my-extra-class" />);
    expect(container.firstElementChild?.className).toContain('my-extra-class');
  });
});
