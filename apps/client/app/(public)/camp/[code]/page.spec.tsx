import { render, screen } from '@testing-library/react';

import CampSignupPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/camp/my-code',
}));

describe('CampSignupPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ valid: true, type: 'PLAYER_STATIC', trainerDisplayName: 'Coach Lisa' }),
      headers: new Headers(),
    } as unknown as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the stand-in sign-up for the [code] param', async () => {
    render(await CampSignupPage({ params: Promise.resolve({ code: 'my-code' }) }));

    expect(screen.getByRole('heading', { name: 'Camp / evaluation sign-up (Epic-08 stand-in)' })).toBeInTheDocument();
    expect(await screen.findByLabelText("Player's age")).toBeInTheDocument();
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/share-links/my-code');
  });
});
