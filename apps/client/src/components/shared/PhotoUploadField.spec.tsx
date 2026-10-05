import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PhotoUploadField } from './PhotoUploadField';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function makeFile(name = 'me.png', type = 'image/png', sizeBytes = 1024): File {
  return new File(['x'.repeat(sizeBytes)], name, { type });
}

describe('PhotoUploadField', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads a chosen file to POST /storage/photo and reports the photo URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { url: 'http://localhost:3000/uploads/photo-abc.webp', thumbnailUrl: 'http://localhost:3000/uploads/photo-abc-thumb.webp' }),
    );
    const onChange = jest.fn();

    render(<PhotoUploadField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [makeFile()] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('http://localhost:3000/uploads/photo-abc.webp'));
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/storage/photo');
    expect(options.method).toBe('POST');
  });

  it('accepts a dropped file', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(201, { url: 'http://x/uploads/photo-1.webp', thumbnailUrl: 'http://x/uploads/photo-1-thumb.webp' }));
    const onChange = jest.fn();

    render(<PhotoUploadField value="" onChange={onChange} />);
    fireEvent.drop(screen.getByTestId('photo-dropzone'), { dataTransfer: { files: [makeFile('drop.jpg', 'image/jpeg')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('http://x/uploads/photo-1.webp'));
  });

  it('accepts SVG', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(201, { url: 'http://x/uploads/photo-2.webp', thumbnailUrl: 't' }));
    const onChange = jest.fn();

    render(<PhotoUploadField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [makeFile('a.svg', 'image/svg+xml')] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('rejects an unsupported type without calling the API', () => {
    const onChange = jest.fn();

    render(<PhotoUploadField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [makeFile('a.gif', 'image/gif')] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/unsupported file type/i);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a file over 2MB without calling the API', () => {
    render(<PhotoUploadField value="" onChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [makeFile('big.png', 'image/png', 2 * 1024 * 1024 + 1)] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/larger than 2MB/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows an error and keeps the value when the upload fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(400, { errorCode: 'VALIDATION_ERROR', message: 'bad' }));
    const onChange = jest.fn();

    render(<PhotoUploadField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [makeFile()] } });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('previews the current photo via its thumbnail and removes it', () => {
    const onChange = jest.fn();

    render(<PhotoUploadField value="http://localhost:3000/uploads/photo-abc.webp" onChange={onChange} />);

    expect(screen.getByRole('img', { name: /photo preview/i })).toHaveAttribute('src', 'http://localhost:3000/uploads/photo-abc-thumb.webp');
    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows initials when there is no photo', () => {
    render(<PhotoUploadField value="" onChange={jest.fn()} initials="AK" />);

    expect(screen.getByText('AK')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove photo/i })).not.toBeInTheDocument();
  });

  describe('"Use image URL" (upload or URL)', () => {
    it('reports a typed https image link as-is, without calling the API', () => {
      const onChange = jest.fn();

      render(<PhotoUploadField value="" onChange={onChange} />);
      fireEvent.change(screen.getByLabelText('Or use an image URL'), { target: { value: '  https://images.example.com/me.jpg?w=256  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use image URL' }));

      expect(onChange).toHaveBeenCalledWith('https://images.example.com/me.jpg?w=256');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Or use an image URL')).toHaveValue('');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each(['http://images.example.com/me.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', 'https://user:pw@example.com/a.png'])(
      'rejects %s with an error and does not report it',
      (bad) => {
        const onChange = jest.fn();

        render(<PhotoUploadField value="" onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Or use an image URL'), { target: { value: bad } });
        fireEvent.click(screen.getByRole('button', { name: 'Use image URL' }));

        expect(screen.getByRole('alert')).toHaveTextContent(/valid image link starting with https/i);
        expect(onChange).not.toHaveBeenCalled();
      },
    );

    it('pressing Enter applies the URL and does not submit the surrounding form', () => {
      const onChange = jest.fn();
      const onSubmit = jest.fn((event: { preventDefault: () => void }) => event.preventDefault());

      render(
        <form onSubmit={onSubmit}>
          <PhotoUploadField value="" onChange={onChange} />
        </form>,
      );
      const input = screen.getByLabelText('Or use an image URL');
      fireEvent.change(input, { target: { value: 'https://images.example.com/me.png' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).toHaveBeenCalledWith('https://images.example.com/me.png');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('disables the button until something is typed and previews an external image link as given', () => {
      render(<PhotoUploadField value="https://images.example.com/me.jpg" onChange={jest.fn()} />);

      expect(screen.getByRole('button', { name: 'Use image URL' })).toBeDisabled();
      expect(screen.getByRole('img', { name: /photo preview/i })).toHaveAttribute('src', 'https://images.example.com/me.jpg');
    });
  });
});
