import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';

/** The last four digits of a card: shown as "•••• 4417", spoken as "ending in 4417" (the dots are never read out as bullets). */
const Last4: React.FC<{ mask: string }> = ({ mask }) => {
  const { t } = useDashboardLang();
  return (
    <span role="img" aria-label={`${t.money.endingIn} ${mask}`}>
      {`•••• ${mask}`}
    </span>
  );
};

export default Last4;
