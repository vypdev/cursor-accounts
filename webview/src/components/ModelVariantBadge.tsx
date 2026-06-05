import type { ModelPricingParameter } from '../types';

interface BadgeConfig {
  icon?: string;
  color: string;
  displayValue: string;
  show: boolean;
}

function getBadgeConfig(param: ModelPricingParameter): BadgeConfig {
  switch (param.id) {
    case 'thinking':
      return {
        icon: '🧠',
        color: 'blue',
        displayValue: '',
        show: param.value === 'true',
      };
    case 'fast':
      return {
        icon: '🏃',
        color: 'orange',
        displayValue: param.value === 'true' ? '' : param.value,
        show: param.value === 'true',
      };
    case 'context':
      return {
        color: 'purple',
        displayValue: param.value,
        show: true,
      };
    case 'effort':
      return {
        color: 'green',
        displayValue: param.value,
        show: true,
      };
    case 'reasoning':
      return {
        color: 'teal',
        displayValue: param.value,
        show: true,
      };
    default:
      return {
        color: 'gray',
        displayValue: param.value,
        show: true,
      };
  }
}

interface ModelVariantBadgeProps {
  parameter: ModelPricingParameter;
}

export function ModelVariantBadge({ parameter }: ModelVariantBadgeProps) {
  const config = getBadgeConfig(parameter);

  if (!config.show) {
    return null;
  }

  return (
    <span
      className={`variant-badge variant-badge-${config.color}`}
      title={`${parameter.id}: ${parameter.value}`}
    >
      {config.icon ? (
        <span className="variant-badge-icon" aria-hidden="true">
          {config.icon}
        </span>
      ) : null}
      {config.displayValue ? (
        <span className="variant-badge-text">{config.displayValue}</span>
      ) : null}
    </span>
  );
}

interface ModelVariantBadgesProps {
  parameters: readonly ModelPricingParameter[];
}

export function ModelVariantBadges({ parameters }: ModelVariantBadgesProps) {
  if (!parameters || parameters.length === 0) {
    return null;
  }

  return (
    <div className="variant-badges-row">
      {parameters.map((parameter, index) => (
        <ModelVariantBadge
          key={`${parameter.id}-${parameter.value}-${index}`}
          parameter={parameter}
        />
      ))}
    </div>
  );
}
