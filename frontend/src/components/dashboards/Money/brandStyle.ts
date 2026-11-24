import type React from 'react';
import { brandOf } from '../../../services/dashboards/providerBrand';

/** The CSS custom properties a bank's colours travel in: its brand pair, or none (the neutral card takes over in the stylesheet). */
export function brandStyle(provider: string): React.CSSProperties | undefined {
  const brand = brandOf(provider);
  return brand ? ({ '--bank-bg': brand.bg, '--bank-fg': brand.fg } as React.CSSProperties) : undefined;
}
