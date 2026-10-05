import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ConfirmRemoveModal } from './ConfirmRemoveModal';

function setup(onConfirm: () => Promise<string | null>, onClose = jest.fn()) {
  render(
    <ConfirmRemoveModal isOpen title="Remove coach" description="They will be removed." confirmLabel="Remove coach" onClose={onClose} onConfirm={onConfirm} />,
  );
  return { onClose };
}

describe('ConfirmRemoveModal', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmRemoveModal isOpen={false} title="t" description="d" confirmLabel="Remove" onClose={jest.fn()} onConfirm={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the title/description and calls onConfirm when confirmed', async () => {
    const onConfirm = jest.fn().mockResolvedValue(null);
    setup(onConfirm);

    expect(screen.getByRole('dialog', { name: 'Remove coach' })).toHaveTextContent('They will be removed.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove coach' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('shows the returned error inline and stays open', async () => {
    const { onClose } = setup(jest.fn().mockResolvedValue('Could not remove.'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove coach' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes via Cancel', () => {
    const { onClose } = setup(jest.fn());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });
});
