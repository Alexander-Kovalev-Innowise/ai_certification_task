import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AddSelfProfileModal } from './AddSelfProfileModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('AddSelfProfileModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts isSelf: true with name, date of birth and gender (adult age allowed)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(201, { id: 'self-1', isSelf: true }));
    const onCreated = jest.fn();

    render(<AddSelfProfileModal isOpen defaultName="Priya Parent" onClose={jest.fn()} onCreated={onCreated} />);
    expect(screen.getByLabelText(/^name/i)).toHaveValue('Priya Parent');
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '1985-05-05' } });
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'FEMALE' } });
    fireEvent.click(screen.getByRole('button', { name: /add myself/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/player-profiles');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Priya Parent', dateOfBirth: '1985-05-05', gender: 'FEMALE', isSelf: true });
  });

  it('shows a message on 409 (already has a self profile)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(409, { errorCode: 'CONFLICT' }));

    render(<AddSelfProfileModal isOpen defaultName="Priya" onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '1985-05-05' } });
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'FEMALE' } });
    fireEvent.click(screen.getByRole('button', { name: /add myself/i }));

    expect(await screen.findByText(/already have a player profile/i)).toBeInTheDocument();
  });
});
