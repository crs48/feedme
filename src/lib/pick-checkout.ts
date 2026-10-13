import { randomUUID } from 'node:crypto';
import type { APIContext } from 'astro';
import { config } from './config';
import { cookieOptions, currentUser, digest, randomToken } from './auth';
import { getDb, getKv, setKv } from './db';
import { centsFromInput, type Visibility } from './model';
import { billingFrequency, type BillingFrequency } from './billing-frequency';
import { allocatePicks, picksFromForm, picksSchema, type Pick as TargetPick } from './picks';
import { libcardSnapshot, libcardTargets } from './libcard';
import { sourceKey } from './libcard-schema';
import { withDefaultPick } from './pick-selection';

export type PickValues = { amount: number; picks: TargetPick[]; frequency: BillingFrequency; visibility: Visibility; note: string; announceAnonymously: boolean };
export type PickReview = PickValues & { binding: string; source: string; creatorName: string; supporterDid?: string };
type PickForm = { binding: string; source: string; ids: string[]; previousPicks?: TargetPick[] };
export const createPickForm = (context: Pick<APIContext, 'cookies'>, ids: string[], previousPicks?: TargetPick[]) => {
  const source = config().libcard; if (!source) throw new Error('LibCard is disabled.');
  const binding = context.cookies.get('feedme_checkout')?.value || randomToken();
  context.cookies.set('feedme_checkout', binding, { ...cookieOptions(), maxAge: 365 * 86400 });
  const id = randomUUID();
  setKv(getDb(), 'pick-form', id, { binding: digest(binding), source: sourceKey(source), ids, previousPicks } satisfies PickForm, 3600_000);
  return id;
};
const bound = (context: Pick<APIContext, 'cookies'>, value: { binding: string; source: string } | undefined) => {
  const browser = context.cookies.get('feedme_checkout')?.value;
  const source = config().libcard;
  if (!value || !browser || value.binding !== digest(browser) || !source || value.source !== sourceKey(source)) throw new Error('This form expired. Please start again.');
  return value;
};
export const oneField = (form: FormData, name: string) => {
  const values = form.getAll(name);
  if (values.length > 1 || (values[0] !== undefined && typeof values[0] !== 'string')) throw new Error('Submit each form field once.');
  return String(values[0] || '');
};
export const pickFormState = (context: APIContext, form: FormData): { values: PickValues; previousPicks?: TargetPick[] } => {
  const token = getKv<PickForm>(getDb(), 'pick-form', oneField(form, 'requestId'));
  bound(context, token);
  const action = oneField(form, 'intent');
  if (!['', 'review', 'all', 'creator', 'undo', ...config().tipAmounts.map(n => `amount-${n}`)].includes(action)) throw new Error('Unknown pick action.');
  const parsed = picksFromForm(form, token!.ids);
  const ids = libcardTargets().map(p => p.id);
  if (token!.ids.some(id => !ids.includes(id))) throw new Error('The target list changed. Reload and review your picks.');
  if (action === 'undo' && !token!.previousPicks?.length) throw new Error('There are no previous picks to restore.');
  const picks = withDefaultPick(action === 'all' ? ids.map(projectId => ({ projectId, count: 1 })) : action === 'creator' ? [] : action === 'undo' ? token!.previousPicks! : parsed);
  const selected = parsed.filter(pick => pick.projectId !== 'creator');
  const previousPicks = action === 'creator' && selected.length ? selected : action !== 'undo' && picks[0].projectId === 'creator' ? token!.previousPicks : undefined;
  const visibility = oneField(form, 'visibility') || 'anonymous';
  if (!['anonymous', 'private', 'public'].includes(visibility)) throw new Error('Choose a valid privacy setting.');
  const note = oneField(form, 'note').trim(); if (note.length > 500) throw new Error('Keep your note to 500 characters.');
  return { previousPicks, values: { amount: action.startsWith('amount-') ? Number(action.slice(7)) : centsFromInput(oneField(form, 'amount')), picks, frequency: billingFrequency(oneField(form, 'frequency')),
    visibility: visibility as Visibility, note, announceAnonymously: visibility === 'anonymous' && oneField(form, 'announceAnonymously') === 'yes' } };
};
export const pickFormValues = (context: APIContext, form: FormData): PickValues => pickFormState(context, form).values;
export const createPickReview = (context: APIContext, values: PickValues) => {
  const snapshot = libcardSnapshot(); if (!snapshot) throw new Error('LibCard is unavailable.');
  if (!values.picks.length) throw new Error('Pick at least one thing before giving.');
  const picks = picksSchema.parse(values.picks).toSorted((a, b) => a.projectId < b.projectId ? -1 : 1);
  allocatePicks(values.amount, picks);
  const id = randomUUID();
  const review: PickReview = { ...values, picks, source: sourceKey(snapshot.source), creatorName: snapshot.document.profile.name,
    binding: digest(context.cookies.get('feedme_checkout')!.value),
    ...(values.visibility !== 'anonymous' && currentUser(context) ? { supporterDid: currentUser(context)!.did } : {}) };
  setKv(getDb(), 'pick-review', id, review, 3600_000);
  return id;
};
export const readPickReview = (context: Pick<APIContext, 'cookies'>, id: string) => {
  const value = getKv<PickReview>(getDb(), 'pick-review', id);
  bound(context, value); return value!;
};
// A privacy change creates a new reviewed intent; never mutate a frozen checkout.
export const changePickReviewVisibility = (context: APIContext, id: string, visibility: Visibility) => {
  if (!['anonymous', 'private', 'public'].includes(visibility)) throw new Error('Choose a valid privacy setting.');
  const original = readPickReview(context, id);
  const { amount, picks, frequency, note } = original;
  const ids = new Set(libcardTargets().map(p => p.id));
  if (picks.some(p => !ids.has(p.projectId))) throw new Error('A selected target is no longer available. Edit and review your gift again.');
  if (visibility === original.visibility) return id;
  return createPickReview(context, { amount, picks, frequency, note, visibility, announceAnonymously: false });
};
// Capture identity after OAuth before rendering the final review, never at payment submission.
export const identifyPickReview = (context: APIContext, id: string) => {
  const draft = readPickReview(context, id); const user = currentUser(context);
  if (draft.visibility !== 'anonymous' && !draft.supporterDid && user) {
    const identified = { ...draft, supporterDid: user.did };
    // Preserve the original expiry when attaching the newly verified identity.
    const row = getDb().prepare("SELECT expires FROM kv WHERE namespace='pick-review' AND key=?").get(id) as { expires: number };
    setKv(getDb(), 'pick-review', id, identified, Math.max(1, row.expires - Date.now())); return identified;
  }
  return draft;
};
export const validatePickReview = (context: APIContext, draft: PickReview) => {
  const ids = new Set(libcardTargets().map(p => p.id));
  if (draft.picks.some(p => !ids.has(p.projectId))) throw new Error('A selected target is no longer accepting picks. Edit and review your gift again.');
  if (draft.visibility !== 'anonymous' && (!draft.supporterDid || draft.supporterDid !== currentUser(context)?.did)) throw new Error('Sign in with the Bluesky or AT Protocol account used to review this gift.');
  return allocatePicks(draft.amount, draft.picks);
};
