import { useEffect, useRef } from 'react';
import { formatDimensionLabel } from './pricesModalFilters';

interface PricesFilterPillProps {
  dimension: string;
  selectedValue?: string;
  options: readonly string[];
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (value: string | undefined) => void;
  onClose: () => void;
}

export function PricesFilterPill({
  dimension,
  selectedValue,
  options,
  isOpen,
  onToggle,
  onSelect,
  onClose,
}: PricesFilterPillProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const label = formatDimensionLabel(dimension);
  const buttonLabel = selectedValue
    ? `${label}: ${selectedValue}`
    : label;

  return (
    <div className="prices-filter-pill-container" ref={containerRef}>
      <button
        type="button"
        className={`prices-filter-pill${selectedValue ? ' active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span>{buttonLabel}</span>
        <span className="prices-filter-pill-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="prices-filter-dropdown" role="listbox" aria-label={label}>
          <button
            type="button"
            className={`prices-filter-option${selectedValue === undefined ? ' selected' : ''}`}
            role="option"
            aria-selected={selectedValue === undefined}
            onClick={() => onSelect(undefined)}
          >
            All
          </button>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`prices-filter-option${selectedValue === option ? ' selected' : ''}`}
              role="option"
              aria-selected={selectedValue === option}
              onClick={() => onSelect(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
