import { DEV_MAILBOX_CAPACITY, DevMailAdapter } from './dev-mail.adapter';

describe('DevMailAdapter', () => {
  it('stores mails newest-last, filters by recipient case-insensitively and clears', async () => {
    const adapter = new DevMailAdapter();
    await adapter.send({ to: 'A@x.com', subject: 's1', html: '<p>1</p>', text: '1', links: ['http://l/1'], templateId: 'T' });
    await adapter.send({ to: 'b@x.com', subject: 's2' });
    await adapter.send({ to: 'a@x.com', subject: 's3' });

    expect(adapter.list().map((m) => m.subject)).toEqual(['s1', 's2', 's3']);
    const forA = adapter.list('a@X.com');
    expect(forA.map((m) => m.subject)).toEqual(['s1', 's3']);
    expect(forA[0]).toMatchObject({ to: 'A@x.com', templateId: 'T', html: '<p>1</p>', text: '1', links: ['http://l/1'] });
    expect(new Date(forA[0].sentAt).toString()).not.toBe('Invalid Date');

    adapter.clear();
    expect(adapter.list()).toEqual([]);
  });

  it(`keeps only the last ${DEV_MAILBOX_CAPACITY} mails`, async () => {
    const adapter = new DevMailAdapter();
    for (let i = 0; i < DEV_MAILBOX_CAPACITY + 5; i += 1) {
      await adapter.send({ to: 'a@x.com', subject: `s${i}` });
    }
    const all = adapter.list();
    expect(all).toHaveLength(DEV_MAILBOX_CAPACITY);
    expect(all[0].subject).toBe('s5');
    expect(all[all.length - 1].subject).toBe(`s${DEV_MAILBOX_CAPACITY + 4}`);
  });
});
