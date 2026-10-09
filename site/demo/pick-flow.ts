import { centsFromInput } from '../../src/lib/model';
import { billingFrequency } from '../../src/lib/billing-frequency';
import { allocatePicks, picksFromForm } from '../../src/lib/picks';

// Use the same count validation and integer-cent allocation as real checkout.
// This returns local preview data only; it never creates a provider request.
export const demoPickGift = (form: FormData, ids: string[]) => {
  const amount = centsFromInput(form.get('amount'));
  const picks = picksFromForm(form, ids);
  const frequency = billingFrequency(form.get('frequency'));
  const visibility = String(form.get('visibility') || 'anonymous');
  if (!['anonymous', 'private', 'public'].includes(visibility)) throw new Error('Choose a valid privacy setting.');
  const note = String(form.get('note') || '').trim();
  if (note.length > 500) throw new Error('Keep your note to 500 characters.');
  return { amount, picks, frequency, visibility, note,
    announceAnonymously: visibility === 'anonymous' && form.get('announceAnonymously') === 'yes',
    allocations: allocatePicks(amount, picks) };
};
