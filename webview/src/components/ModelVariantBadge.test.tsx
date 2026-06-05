import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelVariantBadge, ModelVariantBadges } from './ModelVariantBadge';

describe('ModelVariantBadge', () => {
  it('renders thinking badge only when enabled', () => {
    const { rerender } = render(
      <ModelVariantBadge parameter={{ id: 'thinking', value: 'true' }} />
    );

    expect(screen.getByText('🧠')).toBeInTheDocument();
    expect(screen.queryByText('true')).not.toBeInTheDocument();

    rerender(<ModelVariantBadge parameter={{ id: 'thinking', value: 'false' }} />);
    expect(screen.queryByText('🧠')).not.toBeInTheDocument();
  });

  it('renders fast badge only when enabled', () => {
    const { rerender } = render(
      <ModelVariantBadge parameter={{ id: 'fast', value: 'true' }} />
    );

    expect(screen.getByText('🏃')).toBeInTheDocument();

    rerender(<ModelVariantBadge parameter={{ id: 'fast', value: 'false' }} />);
    expect(screen.queryByText('🏃')).not.toBeInTheDocument();
  });

  it('renders context and effort values without prefixes', () => {
    render(
      <ModelVariantBadges
        parameters={[
          { id: 'context', value: '200k' },
          { id: 'effort', value: 'high' },
          { id: 'reasoning', value: 'extended' },
        ]}
      />
    );

    expect(screen.getByText('200k')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('extended')).toBeInTheDocument();
    expect(screen.queryByText(/context=/)).not.toBeInTheDocument();
  });
});
