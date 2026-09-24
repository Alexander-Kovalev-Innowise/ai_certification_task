import { render, screen } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';

import { CoachDashboardShell } from './CoachDashboardShell';

function bootstrap(overrides: Partial<MeBootstrapResponse> = {}): MeBootstrapResponse {
  const user: UserSummaryDto = {
    id: 'coach-user-1',
    email: 'cory@example.com',
    role: 'COACH',
    accountType: 'ADULT',
    firstName: 'Cory',
    lastName: 'Coach',
    mustChangePassword: false,
  };
  return {
    role: 'COACH',
    user,
    coachProfile: {
      id: 'coach-1',
      userId: 'coach-user-1',
      trainerId: 'trainer-1',
      status: 'ACTIVE',
      bio: null,
      credentials: null,
      certifications: null,
      publicProfile: false,
    },
    employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, primaryColorHex: null },
    availabilitySet: true,
    ...overrides,
  };
}

// fe §4.5 — CoachDashboardShell: `GET /me/bootstrap` COACH shape —
// employing trainer card, `availabilitySet` prompt if `false`. Task 15.2.
describe('CoachDashboardShell', () => {
  it('greets the coach by first name', () => {
    render(<CoachDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, cory/i })).toBeInTheDocument();
  });

  it('shows the employing trainer card with business name and logo', () => {
    render(
      <CoachDashboardShell
        ctx={bootstrap({ employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' } })}
      />,
    );

    expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('falls back to the platform default logo when the employing trainer has no logoUrl', () => {
    render(<CoachDashboardShell ctx={bootstrap({ employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, primaryColorHex: null } })} />);

    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', '/default_logo.svg');
  });

  it('shows an availabilitySet prompt linking to /my-times when availabilitySet is false', () => {
    render(<CoachDashboardShell ctx={bootstrap({ availabilitySet: false })} />);

    expect(screen.getByRole('status')).toHaveTextContent(/set your availability/i);
    expect(screen.getByRole('link', { name: /set.*availability/i })).toHaveAttribute('href', '/my-times');
  });

  it('does not show the availabilitySet prompt when availabilitySet is true', () => {
    render(<CoachDashboardShell ctx={bootstrap({ availabilitySet: true })} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
