import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { PhoneInput } from './PhoneInput';

function Harness({ initial = '', onValue }: { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneInput
      id="phone"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

describe('PhoneInput', () => {
  it('forces the selected country code and emits E.164', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);

    fireEvent.change(document.getElementById('phone')!, { target: { value: '(415) 555-2671' } });

    expect(onValue).toHaveBeenLastCalledWith('+14155552671');
    expect(screen.getByLabelText('Country calling code')).toHaveValue('US');
  });

  it('strips non-digit characters', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);

    fireEvent.change(document.getElementById('phone')!, { target: { value: 'abc415x' } });

    expect(onValue).toHaveBeenLastCalledWith('+1415');
  });

  it('switches the country when a full international number is pasted', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);

    fireEvent.change(document.getElementById('phone')!, { target: { value: '+44 20 7946 0958' } });

    expect(screen.getByLabelText('Country calling code')).toHaveValue('GB');
    expect(onValue).toHaveBeenLastCalledWith('+442079460958');
  });

  it('keeps the typed national digits when the country changes', () => {
    const onValue = jest.fn();
    render(<Harness initial="+14155552671" onValue={onValue} />);

    fireEvent.change(screen.getByLabelText('Country calling code'), { target: { value: 'GB' } });

    expect(onValue).toHaveBeenLastCalledWith('+444155552671');
  });

  it('emits an empty string when cleared and shows a placeholder example', () => {
    const onValue = jest.fn();
    render(<Harness initial="+14155552671" onValue={onValue} />);

    fireEvent.change(document.getElementById('phone')!, { target: { value: '' } });

    expect(onValue).toHaveBeenLastCalledWith('');
    expect(document.getElementById('phone')).toHaveAttribute('placeholder', expect.stringMatching(/\d/));
  });
});
