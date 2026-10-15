import { act, fireEvent, render, screen } from '@testing-library/react';

import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.className = '';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts dark, flips <html data-theme> to light and back, persisting the choice', async () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    await act(async () => {});
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('pp.theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    await act(async () => {});
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('pp.theme')).toBe('dark');
  });

  it('adds the colour cross-fade class only briefly around the flip', async () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveClass('theme-transition');

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(document.documentElement).not.toHaveClass('theme-transition');
  });
});
