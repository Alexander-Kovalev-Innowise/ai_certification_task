import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LogoUploadField } from './LogoUploadField';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function makeFile(name = 'logo.png', type = 'image/png', sizeBytes = 1024): File {
  const file = new File(['x'.repeat(sizeBytes)], name, { type });
  return file;
}

// api §4.1 — "Multipart or two-step (POST logo to shared/storage first, then
// this PATCH with the resulting URL)". This component owns exactly the
// pre-upload step (`POST /storage/logo`) and hands the resulting
// (pre-resize) `logoUrl` back to the caller via `onUploaded` — the caller
// (BrandingPage's form) is the one that includes it in the follow-up
// `PATCH /trainers/:id/branding`. Task 17.1.
describe('LogoUploadField', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads the selected file to POST /storage/logo and reports the returned logoUrl', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { logoUrl: 'https://cdn.example.com/logo-abc.png' }),
    );
    const onUploaded = jest.fn();

    render(<LogoUploadField currentLogoUrl={null} onUploaded={onUploaded} />);

    const input = screen.getByLabelText(/logo/i);
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('https://cdn.example.com/logo-abc.png'));

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/storage/logo');
    expect(options.method).toBe('POST');
  });

  it('shows a processing placeholder immediately after a successful upload, using the pre-resize URL optimistically', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { logoUrl: 'https://cdn.example.com/logo-abc.png' }),
    );

    render(<LogoUploadField currentLogoUrl={null} onUploaded={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/logo/i), { target: { files: [makeFile()] } });

    await waitFor(() =>
      expect(screen.getByRole('img', { name: /logo/i })).toHaveAttribute('src', 'https://cdn.example.com/logo-abc.png'),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/processing/i);
  });

  it('shows an inline error and does not call onUploaded when the upload fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(400, { errorCode: 'VALIDATION_ERROR', message: 'bad' }));
    const onUploaded = jest.fn();

    render(<LogoUploadField currentLogoUrl={null} onUploaded={onUploaded} />);

    fireEvent.change(screen.getByLabelText(/logo/i), { target: { files: [makeFile()] } });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('renders the current logo when provided and no upload is in progress', () => {
    render(<LogoUploadField currentLogoUrl="https://cdn.example.com/existing.png" onUploaded={jest.fn()} />);

    expect(screen.getByRole('img', { name: /logo/i })).toHaveAttribute('src', 'https://cdn.example.com/existing.png');
  });
});
