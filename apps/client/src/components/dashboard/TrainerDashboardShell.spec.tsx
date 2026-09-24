import { render, screen } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';

import { TrainerDashboardShell } from './TrainerDashboardShell';

function bootstrap(overrides: Partial<MeBootstrapResponse> = {}): MeBootstrapResponse {
  const user: UserSummaryDto = {
    id: 'trainer-user-1',
    email: 'tia@example.com',
    role: 'TRAINER',
    accountType: 'ADULT',
    firstName: 'Tia',
    lastName: 'Trainer',
    mustChangePassword: false,
  };
  return {
    role: 'TRAINER',
    user,
    trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis Academy' },
    branding: { logoUrl: null, primaryColorHex: null },
    coachCount: 3,
    activePlayerCount: 27,
    ...overrides,
  };
}

// fe §4.4 — TrainerDashboardShell: `GET /me/bootstrap` TRAINER shape —
// branding preview, coachCount/activePlayerCount stat tiles, quick links.
// Task 13.4.
describe('TrainerDashboardShell', () => {
  it('greets the trainer by first name', () => {
    render(<TrainerDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, tia/i })).toBeInTheDocument();
  });

  it('shows a branding preview with the business name and logo', () => {
    render(<TrainerDashboardShell ctx={bootstrap({ branding: { logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' } })} />);

    expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('falls back to the platform default logo when branding has no logoUrl', () => {
    render(<TrainerDashboardShell ctx={bootstrap({ branding: { logoUrl: null, primaryColorHex: null } })} />);

    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', '/default_logo.svg');
  });

  it('renders coachCount and activePlayerCount stat tiles', () => {
    render(<TrainerDashboardShell ctx={bootstrap({ coachCount: 3, activePlayerCount: 27 })} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Coaches')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText(/active players/i)).toBeInTheDocument();
  });

  it('renders quick links into Coaches and Share Links', () => {
    render(<TrainerDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('link', { name: /manage coaches/i })).toHaveAttribute('href', '/coaches');
    expect(screen.getByRole('link', { name: /manage share links/i })).toHaveAttribute('href', '/share-links');
  });
});
