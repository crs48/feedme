import { accountIdentifier } from './identity-settings';

export const blueskyProfileUrl = (actor: string): string | undefined => {
  try {
    // Bluesky's profile route expects the DID's literal colons. Validation
    // limits this path segment to an account identifier, without URL delimiters.
    return `https://bsky.app/profile/${accountIdentifier(actor)}`;
  } catch {
    return undefined;
  }
};
