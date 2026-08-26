import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddProfileForm } from './AddProfileForm';

describe('AddProfileForm', () => {
  it('rejects malformed email input before submitting', () => {
    const onSubmit = vi.fn();

    render(<AddProfileForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('addProfile.emailLabel'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'addProfile.create' }).closest('form')!
    );

    expect(screen.getByText('addProfile.invalidEmail')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits edited fields and routes cancellation to the caller', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<AddProfileForm onSubmit={onSubmit} onCancel={onCancel} />);

    fireEvent.change(screen.getByLabelText('addProfile.emailLabel'), {
      target: { value: ' new@example.com ' },
    });
    fireEvent.change(screen.getByLabelText('addProfile.displayNameLabel'), {
      target: { value: ' New profile ' },
    });
    fireEvent.change(screen.getByLabelText('addProfile.themeLabel'), {
      target: { value: 'dark' },
    });
    fireEvent.change(screen.getByLabelText('addProfile.colorLabel'), {
      target: { value: '#ff0000' },
    });
    fireEvent.click(screen.getByRole('option', { name: '🚀' }));
    fireEvent.click(screen.getByRole('button', { name: 'addProfile.create' }));

    expect(onSubmit).toHaveBeenCalledWith(
      'new@example.com',
      'New profile',
      'dark',
      '#ff0000',
      '🚀'
    );

    fireEvent.click(screen.getByRole('button', { name: 'addProfile.cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
