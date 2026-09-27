import { putSocialRecord } from './social-repo';

// The account resolved from @feedme.fund, pinned independently of mutable handles.
export const PROTOCOL_AUTHORITY = 'did:plc:vbaugrge5ekw4tlghov4ydhi';
const files = import.meta.glob<{ default: { id: string; lexicon: number; defs: Record<string, unknown> } }>('../../lexicons/fund.feedme.*.json', { eager: true });
export const protocolSchemas = Object.values(files).map((file) => file.default).sort((a,b) => a.id.localeCompare(b.id));
export const publishProtocol = async (actor: string) => {
  if (actor !== PROTOCOL_AUTHORITY) throw new Error('Sign in as @feedme.fund to publish the official schemas.');
  for (const schema of protocolSchemas) await putSocialRecord(actor, 'com.atproto.lexicon.schema', schema.id, { $type: 'com.atproto.lexicon.schema', ...schema });
  return protocolSchemas.length;
};
