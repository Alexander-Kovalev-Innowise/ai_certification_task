import { render, screen } from '@testing-library/react';
import { configureAxe } from 'jest-axe';

import { ForgotPasswordForm } from '../components/auth/ForgotPasswordForm';
import { LoginForm } from '../components/auth/LoginForm';
import { mockStats, renderWithQuery, seedSession } from '../components/dashboard/dashboardTestUtils';
import { StatCard } from '../components/dashboard/StatCard';
import { TrainerDashboardShell } from '../components/dashboard/TrainerDashboardShell';
import { ChildProfileForm } from '../components/player/ChildProfileForm';
import { ProfileCardGrid } from '../components/player/ProfileCardGrid';
import { AccountProfileForm } from '../components/shared/AccountProfileForm';
import { CreateTrainerModal } from '../components/super-admin/CreateTrainerModal';
import { DeactivateConfirmModal } from '../components/super-admin/DeactivateConfirmModal';
import { UsersTable, type UserDirectoryRow } from '../components/super-admin/UsersTable';
import type { UserSummaryDto } from '../types/auth';

// Spec §13 (WCAG 2.1 AA): automated axe checks on the main screens/components.
// Fragments are rendered without page landmarks, so the page-level rules
// (region / one h1 / landmark-one-main) are switched off here and covered by
// the Playwright axe suite (apps/e2e/tests/40-accessibility.spec.ts) against
// the real pages. Colour contrast needs real layout (jsdom has none) and is
// covered there too.
const axe = configureAxe({
  rules: {
    region: { enabled: false },
    'page-has-heading-one': { enabled: false },
    'landmark-one-main': { enabled: false },
    'color-contrast': { enabled: false },
  },
});

// next/link updates state on idle callbacks (prefetch visibility), which spams
// act() warnings in a synchronous axe run: render a plain anchor instead.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/dashboard',
}));

const trainerUser: UserSummaryDto = {
  id: 'trainer-user-1',
  email: 'tia@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Tia',
  lastName: 'Trainer',
  mustChangePassword: false,
};

const users: UserDirectoryRow[] = Array.from({ length: 3 }, (_, index) => ({
  id: `user-${index}`,
  email: `user${index}@example.com`,
  role: 'PLAYER_PARENT',
  status: 'ACTIVE',
  firstName: `First${index}`,
  lastName: `Last${index}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
}));

describe('accessibility (axe)', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('login form has no violations', async () => {
    const { container } = render(<LoginForm />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('forgot-password form has no violations', async () => {
    const { container } = render(<ForgotPasswordForm />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('users table has no violations', async () => {
    const { container } = render(<UsersTable items={users} hasMore={false} onLoadMore={jest.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('empty users table has no violations', async () => {
    const { container } = render(<UsersTable items={[]} hasMore={false} onLoadMore={jest.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('stat card and profile card grid have no violations', async () => {
    const { container } = render(
      <div>
        <StatCard label="Connected players" value={12} hint="Active connections" icon="users" />
        <ProfileCardGrid
          profiles={[
            { id: 'p1', name: 'Priya', isSelf: true, trainerCount: 2, photoUrl: null },
            { id: 'p2', name: 'Alex', isSelf: false, trainerCount: 1, photoUrl: null },
          ]}
          canAddChild
          onAddChild={jest.fn()}
        />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('create-trainer modal has no violations', async () => {
    const { container } = render(<CreateTrainerModal isOpen onClose={jest.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('confirm modal has no violations', async () => {
    const { container } = render(
      <DeactivateConfirmModal isOpen action="deactivate" userId="user-1" onClose={jest.fn()} onSuccess={jest.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('child profile modal (with trainer prompt) has no violations', async () => {
    const { container } = render(
      <ChildProfileForm isOpen onClose={jest.fn()} onCreated={jest.fn()} availableTrainers={[{ id: 't1', businessName: 'Ace Tennis' }]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('account profile form has no violations', async () => {
    const { container } = render(
      <AccountProfileForm
        accountType="ADULT"
        profile={{ firstName: 'Alex', lastName: 'Kovalev', phone: null, photoUrl: null, notificationPrefs: null }}
        onSaved={jest.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('trainer dashboard has no violations', async () => {
    seedSession(trainerUser);
    mockStats({ status: 500 });
    const { container } = renderWithQuery(
      <TrainerDashboardShell
        ctx={{
          role: 'TRAINER',
          user: trainerUser,
          trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis Academy' },
          branding: { logoUrl: null, primaryColorHex: null },
          coachCount: 3,
          activePlayerCount: 27,
        }}
      />,
    );
    await screen.findByRole('alert');
    expect(await axe(container)).toHaveNoViolations();
  });
});
