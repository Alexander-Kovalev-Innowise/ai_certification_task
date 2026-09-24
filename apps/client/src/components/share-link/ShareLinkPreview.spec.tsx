import { render, screen } from '@testing-library/react';

import { ShareLinkPreview } from './ShareLinkPreview';

describe('ShareLinkPreview', () => {
  it("renders the trainer's display name and falls back to the platform default logo/color when null", () => {
    render(<ShareLinkPreview trainerDisplayName="Coach Lisa" logoUrl={null} primaryColorHex={null} />);

    expect(screen.getByText('Join Coach Lisa')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/default_logo.svg');
  });

  it('renders the trainer-supplied logo when present', () => {
    render(<ShareLinkPreview trainerDisplayName="Coach Lisa" logoUrl="https://cdn.example.com/logo.png" primaryColorHex="#FF00AA" />);

    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('renders children (the branch-specific form region)', () => {
    render(
      <ShareLinkPreview trainerDisplayName="Coach Lisa" logoUrl={null} primaryColorHex={null}>
        <div>branch form</div>
      </ShareLinkPreview>,
    );

    expect(screen.getByText('branch form')).toBeInTheDocument();
  });
});
