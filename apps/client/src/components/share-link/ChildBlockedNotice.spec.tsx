import { render, screen } from '@testing-library/react';

import { ChildBlockedNotice } from './ChildBlockedNotice';

describe('ChildBlockedNotice', () => {
  it('renders the mandated copy', () => {
    render(<ChildBlockedNotice />);

    expect(screen.getByText('Ask your parent to register you with this trainer.')).toBeInTheDocument();
  });
});
