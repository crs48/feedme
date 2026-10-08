import { config } from './config';
import { libcardProfile } from './libcard';
import { profile } from './repository';

// The site label is presentation, separate from the creator's account identity.
export const siteName = (cfg = config()): string =>
  cfg.siteName || (cfg.demo ? 'Feedme' : libcardProfile(profile()).name);
