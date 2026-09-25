import { fireEvent, render, screen } from '@testing-library/react';

import { ColorPicker } from './ColorPicker';

// fe §8 — "native color input + hex text field kept in sync, live-previews
// against BrandingLivePreview". Task 17.1. Both inputs are controlled by the
// same `value` prop/`onChange` callback pair so the caller (the branding
// form) is the single source of truth — this component has no internal
// state duplicating the parent's.
describe('ColorPicker', () => {
  it('renders both the native color input and the hex text field with the current value', () => {
    render(<ColorPicker value="#6EE7B7" onChange={jest.fn()} />);

    expect(screen.getByLabelText(/color swatch/i)).toHaveValue('#6ee7b7');
    expect(screen.getByLabelText(/hex/i)).toHaveValue('#6EE7B7');
  });

  it('calls onChange with the native color input value on change', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="#6EE7B7" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/color swatch/i), { target: { value: '#000000' } });

    expect(onChange).toHaveBeenCalledWith('#000000');
  });

  it('calls onChange as the hex text field is typed', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="#6EE7B7" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/hex/i), { target: { value: '#123abc' } });

    expect(onChange).toHaveBeenCalledWith('#123abc');
  });

  it('shows a validation error message when provided', () => {
    render(<ColorPicker value="#ZZZZZZ" onChange={jest.fn()} error="Enter a valid hex color, e.g. #6EE7B7." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid hex color, e.g. #6EE7B7.');
  });
});
