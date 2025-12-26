import { VoipPage } from '../components/voip';

/**
 * Phone Page - Anonymous VOIP Dialer
 * 
 * This page provides access to the anonymous phone dialer with:
 * - *67 caller ID blocking by default
 * - Instant/permanent call record deletion
 * - Full dialpad with DTMF support
 * - Call history (stored locally only)
 */
export const PhonePage = () => {
  return (
    <div className="h-full">
      <VoipPage />
    </div>
  );
};

export default PhonePage;
