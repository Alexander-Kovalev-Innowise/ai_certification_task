import { render } from '@testing-library/react';

import { PageMetaController, usePageMeta } from './usePageMeta';

let mockPathname = '/users';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function Page({ title }: { title?: string }) {
  usePageMeta({ title });
  return null;
}

function currentIcon(): string | null {
  return document.head.querySelector<HTMLLinkElement>('link[data-page-icon]')?.getAttribute('href') ?? null;
}

describe('PageMetaController / usePageMeta', () => {
  it('sets the tab title and icon from the route registry', () => {
    mockPathname = '/users';
    render(<PageMetaController />);

    expect(document.title).toBe('Users | PracticePerfect');
    expect(currentIcon()).toContain('data:image/svg+xml');
  });

  it('lets a page override the title, and restores the default when it unmounts', () => {
    mockPathname = '/users/abc';
    const { unmount } = render(
      <>
        <PageMetaController />
        <Page title="Edit Ada Lovelace" />
      </>,
    );
    expect(document.title).toBe('Edit Ada Lovelace | PracticePerfect');

    unmount();
    render(<PageMetaController />);
    expect(document.title).toBe('Edit user | PracticePerfect');
  });

  it('keeps a single managed icon link across route changes', () => {
    mockPathname = '/coaches';
    const { rerender } = render(<PageMetaController />);
    mockPathname = '/branding';
    rerender(<PageMetaController />);

    expect(document.head.querySelectorAll('link[data-page-icon]')).toHaveLength(1);
    expect(document.title).toBe('Branding | PracticePerfect');
  });
});
