import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useRef, useState } from 'react';

import { Modal } from './Modal';

function Harness({
  dismissible,
  closeOnBackdrop,
  useInitialRef = false,
}: {
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  useInitialRef?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const secondRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          labelledBy="t-heading"
          onClose={() => setOpen(false)}
          dismissible={dismissible}
          closeOnBackdrop={closeOnBackdrop}
          initialFocusRef={useInitialRef ? secondRef : undefined}
        >
          <h2 id="t-heading">Dialog title</h2>
          <input aria-label="First" />
          <input aria-label="Second" ref={secondRef} />
          <button type="button">Last</button>
        </Modal>
      )}
    </div>
  );
}

function openDialog() {
  const opener = screen.getByRole('button', { name: 'Open' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('Modal', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders role=dialog, aria-modal and is labelled by its heading', () => {
    render(<Harness />);
    openDialog();
    const dialog = screen.getByRole('dialog', { name: 'Dialog title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness />);
    openDialog();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('moves focus to the first focusable control on open', () => {
    render(<Harness />);
    openDialog();
    expect(screen.getByLabelText('First')).toHaveFocus();
  });

  it('focuses the provided initialFocusRef instead', () => {
    render(<Harness useInitialRef />);
    openDialog();
    expect(screen.getByLabelText('Second')).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside the dialog', () => {
    render(<Harness />);
    openDialog();
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByLabelText('First')).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('pulls focus back in when it was outside the dialog', () => {
    render(<Harness />);
    const opener = openDialog();
    opener.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByLabelText('First')).toHaveFocus();
  });

  it('closes on Escape and returns focus to the opener', () => {
    render(<Harness />);
    const opener = openDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes when the backdrop is clicked, but not when the panel is', () => {
    render(<Harness />);
    openDialog();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores backdrop clicks with closeOnBackdrop={false} but still closes on Escape', () => {
    render(<Harness closeOnBackdrop={false} />);
    openDialog();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores Escape and backdrop clicks when dismissible={false}', () => {
    render(<Harness dismissible={false} />);
    openDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on close', () => {
    render(<Harness />);
    openDialog();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('only the topmost of two stacked dialogs reacts to Escape', () => {
    const outerClose = jest.fn();
    const innerClose = jest.fn();
    render(
      <>
        <Modal labelledBy="a" onClose={outerClose}>
          <h2 id="a">Outer</h2>
          <button type="button">outer</button>
        </Modal>
        <Modal labelledBy="b" onClose={innerClose}>
          <h2 id="b">Inner</h2>
          <button type="button">inner</button>
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});
