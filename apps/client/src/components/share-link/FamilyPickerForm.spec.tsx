import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FamilyPickerForm } from './FamilyPickerForm';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('FamilyPickerForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /player-profiles and renders "Me" plus each child', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, [
        { id: 'p-self', name: 'Sarah', isSelf: true },
        { id: 'p-child-1', name: 'Alex', isSelf: false },
      ]),
    );

    render(<FamilyPickerForm trainerDisplayName="Coach Lisa" onSubmit={jest.fn()} />);

    expect(await screen.findByText('Who will train with Coach Lisa?')).toBeInTheDocument();
    expect(screen.getByText('Me')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  it('submits the checked profile ids as subjectProfileIds', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, [
        { id: 'p-self', name: 'Sarah', isSelf: true },
        { id: 'p-child-1', name: 'Alex', isSelf: false },
      ]),
    );
    const onSubmit = jest.fn();

    render(<FamilyPickerForm trainerDisplayName="Coach Lisa" onSubmit={onSubmit} />);
    await screen.findByText('Me');

    fireEvent.click(screen.getByLabelText('Me'));
    fireEvent.click(screen.getByLabelText('Alex'));
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(onSubmit).toHaveBeenCalledWith({ subjectProfileIds: ['p-self', 'p-child-1'] });
  });

  it('disables submit until at least one profile is selected', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, [{ id: 'p-self', name: 'Sarah', isSelf: true }]));

    render(<FamilyPickerForm trainerDisplayName="Coach Lisa" onSubmit={jest.fn()} />);
    await screen.findByText('Me');

    expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled();
  });

  it('shows an error state when the family profiles fail to load', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    render(<FamilyPickerForm trainerDisplayName="Coach Lisa" onSubmit={jest.fn()} />);

    expect(await screen.findByText("Couldn't load your family profiles. Please try again.")).toBeInTheDocument();
  });

  it('shows a submitError passed from the parent', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, [{ id: 'p-self', name: 'Sarah', isSelf: true }]));

    render(<FamilyPickerForm trainerDisplayName="Coach Lisa" onSubmit={jest.fn()} submitError="Connection failed." />);

    await waitFor(() => expect(screen.getByText('Connection failed.')).toBeInTheDocument());
  });
});
