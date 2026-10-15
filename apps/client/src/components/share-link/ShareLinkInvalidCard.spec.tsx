import { render, screen } from '@testing-library/react';

import { ShareLinkInvalidCard } from './ShareLinkInvalidCard';

describe('ShareLinkInvalidCard', () => {
  it.each([
    ['NOT_FOUND', "This invitation link doesn't exist."],
    ['EXPIRED', 'This invitation link has expired. Ask your trainer for a new one.'],
    ['EXHAUSTED', 'This invitation link has already been used.'],
    ['REVOKED', 'This invitation link is no longer active.'],
  ] as const)('renders the exact copy for reason=%s', (reason, expectedCopy) => {
    render(<ShareLinkInvalidCard reason={reason} />);

    expect(screen.getByText(expectedCopy)).toBeInTheDocument();
  });

  it('renders generic copy when no reason is given (network-failure fallback)', () => {
    render(<ShareLinkInvalidCard />);

    expect(screen.getByText('Something went wrong loading this invitation link. Please try again.')).toBeInTheDocument();
  });
});
