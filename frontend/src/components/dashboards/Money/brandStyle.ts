import type React from 'react';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { brandFor } from '../../../services/dashboards/providerBrand';

/** The CSS custom properties a bank's colours travel in: its brand pair (the server's, else the table's), or none (the neutral card takes over in the stylesheet). */
export function brandStyle(provider: string, info?: ProviderLogo | null): React.CSSProperties | undefined {
  const brand = brandFor(provider, info);
  return brand ? ({ '--bank-bg': brand.bg, '--bank-fg': brand.fg } as React.CSSProperties) : undefined;
}
