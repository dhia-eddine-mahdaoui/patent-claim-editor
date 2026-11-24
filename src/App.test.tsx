import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { STORAGE_KEY } from './domain/storage';

const SENSOR_ACCEPT = 'Accept: Use "a" to introduce "the sensor" at its first mention.';
const PERIOD_REJECT = 'Reject: End the claim with a period.';

describe('suggestion accept / reject flow', () => {
  it('shows the sample with live issues on first open', () => {
    render(<App />);
    expect(screen.getByLabelText('Claim 5 text')).toHaveValue(
      'A method of detecting a leak, comprising: vibrating a resonant body at a natural frequency; and reading a signal from the sensor',
    );
    expect(screen.getByRole('status')).toHaveTextContent('error(s)');
  });

  it('accepts a single antecedent fix, then undoes it', () => {
    render(<App />);
    const textarea = screen.getByLabelText('Claim 5 text') as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole('button', { name: SENSOR_ACCEPT }));
    expect(textarea.value).toContain('reading a signal from a sensor');
    expect(screen.queryByRole('button', { name: SENSOR_ACCEPT })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(textarea.value).toContain('reading a signal from the sensor');
    expect(screen.getByRole('button', { name: SENSOR_ACCEPT })).toBeInTheDocument();
  });

  it('rejects a suggestion without changing the text, and can restore it', () => {
    render(<App />);
    const textarea = screen.getByLabelText('Claim 5 text') as HTMLTextAreaElement;
    const before = textarea.value;

    fireEvent.click(screen.getByRole('button', { name: PERIOD_REJECT }));
    expect(screen.queryByRole('button', { name: PERIOD_REJECT })).toBeNull();
    expect(textarea.value).toBe(before);

    fireEvent.click(screen.getByRole('button', { name: /Show \d+ dismissed/ }));
    expect(screen.getByRole('button', { name: PERIOD_REJECT })).toBeInTheDocument();
  });

  it('persists edits to localStorage', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Claim 2 text'), {
      target: { value: 'The apparatus of claim 1, wherein the sensor is a strain gauge.' },
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('strain gauge');
  });

  it('undoes an edit with Ctrl+Z', () => {
    render(<App />);
    const textarea = screen.getByLabelText('Claim 2 text') as HTMLTextAreaElement;
    const original = textarea.value;
    fireEvent.change(textarea, { target: { value: 'Changed.' } });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(textarea.value).toBe(original);
  });
});
