import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModelPricingDisplayData } from '../types';
import { PricesModal } from './PricesModal';

const sampleModels: ModelPricingDisplayData[] = [
  {
    modelId: 'composer-2.5',
    displayName: 'Composer 2.5',
    provider: 'Cursor',
    inputPer1M: 0.5,
    outputPer1M: 2.5,
    parameters: [{ id: 'fast', value: 'false' }],
  },
  {
    modelId: 'composer-2.5-fast',
    displayName: 'Composer 2.5 Fast',
    provider: 'Cursor',
    inputPer1M: 0.5,
    outputPer1M: 2.5,
    parameters: [{ id: 'fast', value: 'true' }],
  },
  {
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    provider: 'OpenAI',
    inputPer1M: 1.25,
    outputPer1M: 10,
    parameters: [{ id: 'reasoning', value: 'extended' }],
  },
];

describe('PricesModal', () => {
  it('renders Your Active Models section when enabled models are provided', () => {
    render(
      <PricesModal
        models={sampleModels}
        enabledModels={[sampleModels[1]!]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Your Active Models' })).toBeInTheDocument();
    expect(screen.getAllByText('Composer 2.5 Fast').length).toBeGreaterThan(0);
  });

  it('does not render a Variant column header', () => {
    render(<PricesModal models={sampleModels} onClose={vi.fn()} />);

    expect(screen.queryByRole('columnheader', { name: 'Variant' })).not.toBeInTheDocument();
  });

  it('renders dynamic filter pills for discovered dimensions', () => {
    render(<PricesModal models={sampleModels} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Fast/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reasoning/i })).toBeInTheDocument();
  });

  it('filters models when a filter option is selected', () => {
    render(<PricesModal models={sampleModels} onClose={vi.fn()} />);

    expect(screen.getByText('Composer 2.5 Fast')).toBeInTheDocument();
    expect(screen.getByText('GPT-5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Fast/i }));
    fireEvent.click(screen.getByRole('option', { name: 'true' }));

    expect(screen.getByText('Composer 2.5 Fast')).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'Composer 2.5' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'GPT-5' })).not.toBeInTheDocument();
  });

  it('shows empty state when no models match filters', () => {
    render(<PricesModal models={sampleModels} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Reasoning/i }));
    fireEvent.click(screen.getByRole('option', { name: 'extended' }));
    fireEvent.click(screen.getByRole('button', { name: /Fast: true/i }));
    fireEvent.click(screen.getByRole('option', { name: 'false' }));

    expect(
      screen.getByText('No models match the selected filters.')
    ).toBeInTheDocument();
  });

  it('keeps header controls visible in the fixed header area', () => {
    render(<PricesModal models={sampleModels} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    const header = dialog.querySelector('.prices-modal-header');

    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole('heading', {
        name: 'Cursor Model Pricing',
      })
    ).toBeInTheDocument();
    expect(
      within(header as HTMLElement).getByRole('button', { name: 'Close' })
    ).toBeInTheDocument();
  });
});
