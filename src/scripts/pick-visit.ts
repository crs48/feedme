import { splitUnits } from '../lib/pick-allocation';
import { withDefaultPick } from '../lib/pick-selection';

const cents = (value: string) => {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) return;
  const [whole, decimal = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return amount >= 100 && amount <= 100_000 ? amount : undefined;
};
const dollars = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
export const enhancePickVisits = () => document.querySelectorAll<HTMLFormElement>('[data-pick-visit]').forEach(form => {
  if (form.dataset.pickEnhanced) return;
  form.dataset.pickEnhanced = 'true';
  const rows = [...form.querySelectorAll<HTMLElement>('[data-pick-row]')];
  const inputs = rows.map(row => row.querySelector<HTMLInputElement>('[data-pick-input]')!);
  const amount = form.querySelector<HTMLInputElement>('[data-pick-total]')!;
  const status = form.querySelector<HTMLElement>('[data-pick-status]')!;
  const undo = form.querySelector<HTMLElement>('[data-pick-undo]')!;
  let previousPicks: { projectId: string; count: number }[] = JSON.parse(form.dataset.previousPicks || '[]');
  const clearUndo = () => { previousPicks = []; undo.hidden = true; };
  const text = (selector: string, value: string) => { form.querySelector<HTMLElement>(selector)!.textContent = value; };
  const update = (announce = false, expand = false) => {
    const picks = withDefaultPick(rows.flatMap((row, i) => Number(inputs[i].value) > 0 ? [{ projectId: row.dataset.pickRow!, count: Number(inputs[i].value) }] : []));
    inputs.forEach((input, i) => input.value = String(picks.find(pick => pick.projectId === rows[i].dataset.pickRow)?.count || 0));
    const total = picks.reduce((n, pick) => n + pick.count, 0);
    const price = cents(amount.value);
    const shares = new Map(total ? splitUnits(1000, picks).map(p => [p.projectId, p.amount / 10]) : []);
    const parts = new Map(total && price !== undefined ? splitUnits(price, picks).map(p => [p.projectId, p.amount]) : []);
    const frequency = form.querySelector<HTMLInputElement>('[name=frequency]:checked')!.value;
    const suffix = frequency === 'monthly' ? ' / month' : frequency === 'yearly' ? ' / year' : '';
    const summary = picks[0]?.projectId === 'creator' ? `No preference — just ${form.dataset.creatorName}` : `${total} ${total === 1 ? 'pick' : 'picks'} across ${picks.length} ${picks.length === 1 ? 'thing' : 'things'}`;
    rows.forEach((row, i) => {
      const count = Number(inputs[i].value);
      row.dataset.selected = String(count > 0);
      const creatorChoice = row.querySelector<HTMLButtonElement>('[data-pick-creator]');
      if (creatorChoice) {
        creatorChoice.setAttribute('aria-pressed', String(count > 0));
        creatorChoice.textContent = count ? 'Selected' : 'Choose';
        return;
      }
      row.querySelector<HTMLElement>('[data-pick-start]')!.hidden = count > 0;
      row.querySelector<HTMLElement>('[data-pick-stepper]')!.hidden = count === 0;
      row.querySelector<HTMLOutputElement>('[data-pick-count]')!.textContent = String(count);
      row.querySelector<HTMLButtonElement>('[data-pick-add]')!.disabled = count >= 9;
      row.querySelector<HTMLOutputElement>('[data-pick-share]')!.textContent = count ? `${shares.get(row.dataset.pickRow!)}%` : '';
      if (expand && count) { const group = row.closest<HTMLDetailsElement>('[data-pick-group]'); if (group) group.open = true; }
    });
    form.querySelectorAll<HTMLElement>('[data-split-id]').forEach(row => {
      const pick = picks.find(p => p.projectId === row.dataset.splitId);
      row.hidden = !pick;
      row.querySelector<HTMLElement>('[data-split-count]')!.textContent = pick && pick.count > 1 ? `×${pick.count}` : '';
      row.querySelector<HTMLElement>('[data-split-amount]')!.textContent = price === undefined ? '—' : dollars(parts.get(row.dataset.splitId!) || 0);
    });
    form.querySelector<HTMLElement>('[data-pick-empty]')!.hidden = total > 0;
    text('[data-pick-summary]', total ? summary : 'One amount, split across your picks');
    text('[data-mobile-summary]', total ? summary : 'Choose what you’d like more of');
    text('[data-total-label]', `Total${suffix}`);
    text('[data-total-amount]', price === undefined ? '—' : dollars(price));
    text('[data-mobile-total]', price === undefined ? 'Choose an amount' : `${dollars(price)}${suffix}`);
    const submit = form.querySelector<HTMLButtonElement>('[data-pick-submit]')!;
    submit.disabled = total === 0 || price === undefined;
    submit.textContent = !total ? 'Pick something to begin' : price === undefined ? 'Enter an amount from $1 to $1,000' : 'Review your tip';
    if (announce) status.textContent = `${summary}. ${price === undefined ? 'Enter a valid amount.' : `${dollars(price)}${suffix} in total.`}`;
    form.querySelectorAll<HTMLButtonElement>('[data-pick-amount]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.pickAmount) === price)));
  };
  rows.forEach((row, i) => {
    row.querySelector<HTMLElement>('[data-pick-input-label]')!.hidden = true;
    inputs[i].hidden = true;
    row.querySelector<HTMLElement>('[data-pick-controls]')!.hidden = false;
    const creatorChoice = row.querySelector<HTMLButtonElement>('[data-pick-creator]');
    if (creatorChoice) {
      creatorChoice.addEventListener('click', event => {
        event.preventDefault();
        const selected = rows.flatMap((item, index) => item.dataset.pickRow !== 'creator' && Number(inputs[index].value) > 0 ? [{ projectId: item.dataset.pickRow!, count: Number(inputs[index].value) }] : []);
        if (selected.length) previousPicks = selected;
        inputs.forEach(input => input.value = '0'); update(true);
        undo.hidden = !previousPicks.length;
        if (previousPicks.length) status.textContent += ' Your previous picks were cleared. Undo is available.';
      });
      return;
    }
    const start = row.querySelector<HTMLButtonElement>('[data-pick-start]')!;
    const add = row.querySelector<HTMLButtonElement>('[data-pick-add]')!;
    start.addEventListener('click', () => { clearUndo(); inputs[i].value = '1'; update(true); add.focus(); });
    add.addEventListener('click', () => { clearUndo(); inputs[i].value = String(Math.min(9, Number(inputs[i].value) + 1)); update(true); if (Number(inputs[i].value) === 9) row.querySelector<HTMLButtonElement>('[data-pick-remove]')!.focus(); });
    row.querySelector('[data-pick-remove]')!.addEventListener('click', () => { clearUndo(); inputs[i].value = String(Math.max(0, Number(inputs[i].value) - 1)); update(true); if (!Number(inputs[i].value)) start.focus(); });
  });
  form.querySelector('[data-pick-restore]')!.addEventListener('click', event => {
    event.preventDefault();
    if (!previousPicks.length) return;
    inputs.forEach((input, i) => input.value = String(previousPicks.find(pick => pick.projectId === rows[i].dataset.pickRow)?.count || 0));
    clearUndo(); update(true, true);
    status.textContent = `Your previous picks were restored. ${status.textContent}`;
    form.querySelector<HTMLButtonElement>('[data-pick-creator]')!.focus();
  });
  form.querySelectorAll<HTMLButtonElement>('[data-pick-shortcut]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault(); clearUndo(); inputs.forEach(input => input.value = '1'); update(true, true);
  }));
  form.querySelectorAll<HTMLButtonElement>('[data-pick-amount]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); amount.value = (Number(button.dataset.pickAmount) / 100).toFixed(2); update(true); }));
  form.querySelectorAll<HTMLInputElement>('[name=frequency]').forEach(input => input.addEventListener('change', () => update(true)));
  amount.addEventListener('input', () => update());
  form.querySelector('[data-pick-jump]')?.addEventListener('click', () => form.querySelector<HTMLElement>('#libcard-gift')?.focus({ preventScroll: true }));
  update();
});
