import { render, screen } from '@testing-library/react';

import { CoachStatusBadge } from './CoachStatusBadge';

// fe §4.4 — CoachStatusBadge: Pending/Accepted/Expired, one of the three
// `CoachRosterRowDto.invitationStatus` values. Task 13.2.
describe('CoachStatusBadge', () => {
  it.each(['Pending', 'Accepted', 'Expired'] as const)('renders the %s status', (status) => {
    render(<CoachStatusBadge status={status} />);

    expect(screen.getByText(status)).toBeInTheDocument();
  });
});
