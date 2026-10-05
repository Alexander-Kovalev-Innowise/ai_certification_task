import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalStorageAdapter } from './local-storage.adapter';

describe('LocalStorageAdapter', () => {
  let dir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-local-storage-'));
    adapter = new LocalStorageAdapter();
    adapter.uploadsDir = dir;
    adapter.publicBaseUrl = 'http://localhost:3000';
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes under the uploads dir and returns an absolute http URL (never file://)', async () => {
    const result = await adapter.upload({ key: 'logo-1.png', contentType: 'image/png', body: Buffer.from('abc') });

    expect(result.url).toBe('http://localhost:3000/uploads/logo-1.png');
    expect(result.url.startsWith('file:')).toBe(false);
    expect((await readFile(join(dir, 'logo-1.png'))).toString()).toBe('abc');
    expect((await adapter.read('logo-1.png')).toString()).toBe('abc');
  });

  it('delete removes the object and read then rejects', async () => {
    await adapter.upload({ key: 'a.png', contentType: 'image/png', body: Buffer.from('x') });
    await adapter.delete('a.png');
    await expect(adapter.read('a.png')).rejects.toThrow();
  });

  it('rejects keys that could escape the uploads dir', async () => {
    await expect(adapter.upload({ key: '../evil.png', contentType: 'image/png', body: Buffer.from('x') })).rejects.toThrow(
      'Invalid storage key',
    );
    await expect(adapter.read('a/b.png')).rejects.toThrow('Invalid storage key');
  });

  it('keyFromUrl only recognises its own URLs', () => {
    expect(adapter.keyFromUrl('http://localhost:3000/uploads/logo-1.png')).toBe('logo-1.png');
    expect(adapter.keyFromUrl('http://localhost:3000/uploads/logo-1.png?x=1')).toBe('logo-1.png');
    expect(adapter.keyFromUrl('https://example.com/uploads/logo-1.png')).toBeNull();
    expect(adapter.keyFromUrl('http://localhost:3000/uploads/../secret')).toBeNull();
  });
});
