import { allocateAmount } from '../../src/lib/allocation';
import { money, netSupport, supportParts, type Project, type Support } from '../../src/lib/model';
import { reportQuery, selectedPayments, summarizePayments, earningsSeries, projectPerformance, supporterPerformance, recurringSummary, paymentsCsv, displayDate, paymentDate } from '../../src/lib/analytics';
import type { Subscription } from '../../src/lib/recurring';
import { initAdminPopovers } from '../../src/lib/admin-popovers';
import { enhancePickVisits } from '../../src/scripts/pick-visit';
import { prefillPicks, splitUnits, type Pick } from '../../src/lib/picks';
import { demoPickGift } from './pick-flow';

type Tip = { amount: number; frequency: string; visibility: string; allocations: { projectId: string; amount: number }[]; picks?: Pick[]; note?: string; announceAnonymously?: boolean };
type State = { projects?: Record<string, Project>; forms?: Record<string, Record<string, string>>; follows?: Record<string, boolean>; draft?: Tip; tip?: Tip; stopped?: boolean };
const key = 'feedme-static-demo-v2';
const fixture = JSON.parse(document.getElementById('demo-data')?.textContent || '{}') as { projects: Project[]; payments: Support[]; subscriptions: Subscription[]; sampleGift: Tip };
const screen = document.body.dataset.demoScreen || '/';
let state: State = {};
try { state = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { /* Browsing works with storage blocked. */ }
const notify = (message: string) => { const box = document.getElementById('demo-notice'); if (box) { box.textContent = message; box.hidden = false; box.focus({ preventScroll: true }); } };
const save = () => { try { sessionStorage.setItem(key, JSON.stringify(state)); return true; } catch { notify('Browser storage is unavailable. This preview works, but changes cannot survive navigation.'); return false; } };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
const formValues = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, String(value)]));
const projects = () => fixture.projects.map((p) => state.projects?.[p.id] || p).concat(Object.values(state.projects || {}).filter((p) => !fixture.projects.some((seed) => seed.id === p.id)));
const projectEditUrl = (id: string) => fixture.projects.find(p => p.id === id)?.libcard ? '/demo/studio/projects/#libcard' : fixture.projects.some((p) => p.id === id) ? `/demo/studio/projects/${id}/` : `/demo/studio/projects/new/?draft=${encodeURIComponent(id)}`;
const projectVisitUrl = (id: string) => fixture.projects.find(p => p.id === id)?.libcard ? `/demo/checkout/?${new URLSearchParams({ [id]: '1' })}` : `/demo/support/${id}/`;
const projectName = (id: string) => projects().find((p) => p.id === id)?.title || id;
const link = (text: string, href: string) => { const node = element('a', text, 'admin-link'); node.href = href; return node; };
const cardHeading = (title: string, ...details: Node[]) => {
  const heading = element('div', '', 'admin-card-heading');
  heading.append(element('h2', title), ...details);
  return heading;
};
const names: Record<string, string> = { a: 'Alex Rivers', b: 'Sam Taylor', c: 'Jordan Lee', d: 'Maya Chen', e: 'Jamie Morgan', f: 'Devon Brooks' };
const avatars: Record<string, string> = { a: '12', b: '13', c: '5', d: '47', e: '44', f: '49' };
const person = (did?: string) => names[did?.split(':').at(-1)?.[0] || ''] || 'Anonymous';
const identity = (did?: string, caption = '', fallback = 'Anonymous') => {
  const node = element('div', '', 'admin-person');
  if (did) { const img = element('img'); img.src = `/demo/avatars/${avatars[did.split(':').at(-1)?.[0] || ''] || '12'}.jpg`; img.width = 32; img.height = 32; img.alt = ''; img.style.borderRadius = '50%'; node.append(img); }
  else { const avatar = element('span', fallback.slice(0, 1), 'admin-avatar-placeholder'); avatar.setAttribute('aria-hidden', 'true'); node.append(avatar); }
  const body = element('div'); body.append(element('strong', did ? person(did) : fallback, 'admin-person-name'));
  if (caption) body.append(element('span', caption, 'admin-caption'));
  node.append(body); return node;
};
const table = (headings: string[], rows: (string | Node)[][], ledger = false) => {
  const scroll = element('div', '', 'admin-table-scroll'), table = element('table', '', `admin-table${ledger ? ' admin-ledger' : ''}`);
  scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Report table');
  const head = element('thead'), heading = element('tr'), body = element('tbody');
  const columnClass = (index: number) => ['Gross', 'Refunds', 'Disputes', 'Net', 'Net support'].includes(headings[index]) ? 'numeric' : '';
  headings.forEach((value, index) => { const th = element('th', value === 'Details' ? '' : value, columnClass(index)); if (value === 'Details') th.append(element('span', value, 'sr-only')); heading.append(th); }); head.append(heading);
  rows.forEach((values) => { const row = element('tr'); values.forEach((value, index) => { const cell = element('td', '', headings[index] === 'Details' ? 'admin-row-action' : columnClass(index)); cell.append(value); row.append(cell); }); body.append(row); });
  table.append(head, body); scroll.append(table); return scroll;
};
const popover = (label: string, title: string, total: number, nodes: Node[], iconOnly = false) => {
  const details = element('details', '', `admin-popover${iconOnly ? ' admin-popover-action' : ''}`); details.dataset.adminPopover = '';
  const summary = element('summary'); summary.setAttribute('aria-label', label); if (iconOnly) summary.title = title;
  const chevron = element('span', iconOnly ? '•••' : '⌄', 'admin-popover-chevron'); chevron.setAttribute('aria-hidden', 'true');
  summary.append(element('span', label, iconOnly ? 'sr-only' : ''), chevron);
  const panel = element('div', '', 'admin-popover-panel'); panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', title);
  const heading = element('div', '', 'admin-popover-heading'); heading.append(element('strong', title), element('span', money(total)));
  const body = element('div', '', 'admin-popover-content'); body.tabIndex = 0; body.append(...nodes);
  panel.append(heading, body); details.append(summary, panel); return details;
};
const breakdown = (parts: {projectId: string; amount: number}[], total: number, title = 'Support breakdown', caption = 'Net support after refunds and disputes.') => {
  const list = element('ul', '', 'admin-breakdown-list'); list.setAttribute('aria-label', 'Supported projects');
  parts.forEach(p => { const row = element('li'), name = element('span'); name.append(link(projectName(p.projectId), projectEditUrl(p.projectId))); row.append(name, element('strong', money(p.amount))); list.append(row); });
  return popover(`${parts.length} ${parts.length === 1 ? 'project' : 'projects'}`, title, total, [list, element('p', caption, 'admin-popover-note')]);
};
const paymentTable = (records: Support[]) => records.length ? table(['Supporter', 'Allocation', 'Status', 'Net support', 'Details'], records.map((s) => {
  const did = s.visibility === 'anonymous' ? undefined : s.supporterDid;
  const who = identity(did, `${displayDate(paymentDate(s))} · ${s.visibility}`, s.visibility === 'anonymous' ? 'Anonymous' : 'Guest');
  const meta = element('dl', '', 'admin-detail-list');
  const frequency = s.frequency === 'monthly' ? 'Monthly' : s.frequency === 'yearly' ? 'Yearly' : 'One time';
  const fields = [['Gross', money(s.amount)], ['Refunded', money(s.refundedAmount)], ['Frequency', frequency], ['Visibility', s.visibility], ['Payment ID', s.id], ...(did ? [['Supporter DID', did]] : [])];
  fields.forEach(([name, value]) => { const row = element('div', '', name.endsWith('ID') ? 'admin-detail-id' : ''); row.append(element('dt', name), element('dd', value)); meta.append(row); });
  const nodes: Node[] = [meta];
  if (s.note) { const note = element('div', '', 'admin-detail-note'); note.append(element('strong', 'Private note'), element('p', s.note)); nodes.push(note); }
  if (s.disputed) nodes.push(element('p', 'Disputed payments are excluded from earnings.', 'admin-popover-note'));
  const details = popover(`Payment details for ${did ? person(did) : s.visibility === 'anonymous' ? 'Anonymous' : 'Guest'}, ${displayDate(paymentDate(s))}`, 'Payment details', netSupport(s), nodes, true);
  const allocation = breakdown(supportParts(s).map(p => ({ projectId: p.projectId, amount: netSupport(p) })), netSupport(s));
  const status = element('span', s.disputed ? 'disputed' : s.status, 'status-pill'); status.dataset.status = status.textContent!;
  const amount = element('div'); amount.append(element('strong', money(netSupport(s))), element('span', frequency.toLowerCase(), 'admin-caption'));
  return [who, allocation, status, amount, details];
}), true) : element('p', 'No payments match these filters.', 'admin-empty');
let reportRecords = fixture.payments || [];
const applyReport = (form: HTMLFormElement) => {
  const values = formValues(form), query = reportQuery(new URLSearchParams(values));
  reportRecords = selectedPayments(fixture.payments, query);
  const stats = summarizePayments(reportRecords);
  if (field(form, 'from')) field(form, 'from')!.value = query.from;
  if (field(form, 'to')) field(form, 'to')!.value = query.to;
  const cards = [...document.querySelectorAll<HTMLElement>('.admin-card')];
  const card = (title: string) => cards.find((node) => node.querySelector('h2')?.textContent?.startsWith(title));
  if (screen === '/studio') {
    const recurring = recurringSummary(fixture.payments, fixture.subscriptions, query.project);
    const metrics = [money(stats.net), String(stats.count), String(stats.knownSupporters), money(recurring.monthly)];
    const captions = [`${money(stats.gross)} gross · before fees`, `${money(stats.average)} average net tip`, `+ ${stats.anonymousPayments} anonymous / guest tips`, `${recurring.active} active subscriptions · current run rate`];
    document.querySelectorAll('.admin-kpi').forEach((node, index) => { node.querySelector('strong')!.textContent = metrics[index]; node.querySelector('p')!.textContent = captions[index]; });
    const chart = card('Earnings over time');
    if (chart) {
      const series = earningsSeries(reportRecords, query), max = Math.max(100, ...series.map((s) => s.net));
      const bars = element('div', '', 'demo-chart'); bars.setAttribute('aria-label', `${query.interval === 'month' ? 'Monthly' : 'Weekly'} earnings`);
      series.forEach((s) => { const bar = element('div'); bar.style.height = `${Math.max(2, s.net / max * 100)}%`; bar.title = `${displayDate(s.date)}: ${money(s.net)}`; bars.append(bar); });
      const details = element('details'); details.append(element('summary', 'View earnings table', 'admin-link'), table(['Period starting', 'Gross', 'Refunds', 'Disputes', 'Net'], series.map((s) => [displayDate(s.date), money(s.gross), money(s.refunded), money(s.disputed), money(s.net)])));
      const labels = element('div', '', 'admin-chart-labels'); labels.append(element('span', series[0] ? displayDate(series[0].date) : ''), element('span', series.at(-1) ? displayDate(series.at(-1)!.date) : ''));
      chart.replaceChildren(cardHeading('Earnings over time', element('span', `${query.interval === 'month' ? 'Monthly' : 'Weekly'} · fictional payments`, 'admin-help')), bars, labels, details);
    }
    const performance = card('Project performance');
    if (performance) {
      performance.replaceChildren(cardHeading('Project performance', link('Manage projects →', '/demo/studio/projects/')));
      const ranked = projectPerformance(reportRecords, projects()).filter((p) => !query.project || p.id === query.project);
      const more = element('details', '', 'admin-more'); more.append(element('summary', `Show ${ranked.length - 5} more projects`));
      ranked.forEach((p, index) => {
        const row = element('div', '', 'admin-progress-row'), heading = element('div'), track = element('div', '', 'progress'), bar = element('span');
        heading.append(link(p.title, projectEditUrl(p.id)), element('strong', money(p.net))); bar.style.width = `${stats.net ? p.net / stats.net * 100 : 0}%`; track.append(bar);
        row.append(heading, track, element('p', `${p.count} confirmed contributions · ${stats.net ? Math.round(p.net / stats.net * 100) : 0}% of net support`, 'admin-help')); (index < 5 ? performance : more).append(row);
      });
      if (ranked.length > 5) performance.append(more);
    }
    const health = card('Payment health');
    health?.querySelectorAll('dd').forEach((node, index) => { node.textContent = [money(stats.refunded), money(stats.disputed), String(stats.pending), String(stats.failed), String(recurring.pastDue), String(recurring.ending)][index]; });
    const recent = card('Recent payments'); if (recent) recent.replaceChildren(cardHeading('Recent payments', link('View payment history →', '/demo/studio/payments/')), paymentTable(reportRecords.slice(0, 5)));
  } else if (screen === '/studio/payments') {
    const payments = cards[0]; payments?.replaceChildren(cardHeading(`${reportRecords.length} payments · ${money(stats.net)} net`), paymentTable(reportRecords));
  } else if (screen === '/studio/supporters') {
    const supporters = supporterPerformance(reportRecords);
    const rows = supporters.map(s => {
      const parts = projectPerformance(reportRecords.filter(record => record.visibility !== 'anonymous' && record.supporterDid === s.did), projects()).filter(part => s.projects.includes(part.id)).map(part => ({ projectId: part.id, amount: part.net }));
      const date = element('div'); date.append(element('span', displayDate(s.last), 'admin-date'), element('span', `Since ${displayDate(s.first)}`, 'admin-caption'));
      const amount = element('div'), params = new URLSearchParams(values); params.set('q', s.did); params.set('status', 'paid');
      const payments = link(`${s.count} ${s.count === 1 ? 'payment' : 'payments'} ↗`, `/demo/studio/payments/?${params}`); payments.className = 'admin-caption admin-payment-count';
      amount.append(element('strong', money(s.net)), payments);
      return [identity(s.did), breakdown(parts, s.net, 'Projects supported', 'Net support in the selected period.'), date, amount];
    });
    cards[0]?.replaceChildren(cardHeading(`${supporters.length} named supporters`, element('span', 'Ranked by net support in this period', 'admin-help')), rows.length ? table(['Supporter', 'Allocation', 'Latest support', 'Net support'], rows, true) : element('p', 'No named supporters in this period yet.', 'admin-empty'));
    const anonymous = summarizePayments(reportRecords.filter((s) => s.visibility === 'anonymous' || !s.supporterDid));
    const caption = cards[1]?.querySelector('.admin-help'); if (caption) caption.textContent = `${anonymous.anonymousPayments} tips · ${money(anonymous.net)} net support`;
  }
  initAdminPopovers();
};
const renderProjects = () => {
  const list = document.querySelector('.admin-project-row')?.parentElement; if (!list || screen !== '/studio/projects') return;
  list.replaceChildren();
  projects().filter(p => !p.libcard).forEach((p) => {
    const row = element('article', '', 'admin-project-row'); row.dataset.projectId = p.id;
    const body = element('div'), badge = element('span', p.status === 'active' ? 'published' : p.status, 'status-pill'); badge.dataset.status = p.status;
    const heading = element('h2'); heading.append(link(p.title, projectEditUrl(p.id)));
    const actions = element('div', '', 'admin-actions'); actions.append(link('Edit & preview', (heading.firstChild as HTMLAnchorElement).href));
    const button = element('button', p.status === 'active' ? 'Archive' : 'Publish', 'button secondary'); button.type = 'button';
    button.addEventListener('click', () => { state.projects ||= {}; state.projects[p.id] = { ...p, status: p.status === 'active' ? 'archived' : 'active' }; save(); renderProjects(); notify('Project status updated in this tab only. No site or AT Protocol record was published.'); });
    const duplicate = element('button', 'Duplicate', 'button secondary'); duplicate.type = 'button';
    duplicate.addEventListener('click', () => { const id = `local-${crypto.randomUUID()}`; state.projects ||= {}; state.projects[id] = { ...p, id, title: `${p.title} (copy)`, status: 'draft' }; save(); renderProjects(); notify('A copy was saved as a draft in this tab.'); });
    actions.append(button, duplicate); body.append(badge, heading, element('p', p.summary), actions);
    row.append(body, element('div', `${money(p.target)} aspiration`, 'admin-project-meta')); list.append(row);
  });
};
const savedFormKey = (form: HTMLFormElement) => `${screen}:${field(form, 'action')?.value || ''}`;
const restore = (form: HTMLFormElement, values: Record<string, string>) => {
  Object.entries(values).forEach(([name, value]) => { const control = field(form, name); if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === 'yes'; else if (control && 'value' in control) control.value = value; });
};
const draftId = new URLSearchParams(location.search).get('draft');
const projectForm = document.querySelector<HTMLFormElement>('form:has(input[name="action"][value="project"])');
const showDraft = (p: Project) => {
  if (!projectForm) return;
  restore(projectForm, Object.fromEntries(Object.entries(p).map(([name, value]) => [name, String(name === 'target' ? Number(value) / 100 : value)])));
  const aside = document.querySelector('.admin-editor-grid aside');
  if (aside) aside.replaceChildren(element('h2', p.title), element('p', 'Saved in this tab · text preview. The self-hosted app renders Markdown and media.', 'admin-help'), element('p', p.summary), element('pre', p.description, 'demo-draft-preview'));
};
if (fixture.projects) {
  document.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
    const saved = state.forms?.[savedFormKey(form)]; if (saved) restore(form, saved);
    if (field(form, 'action')?.value === 'follow') {
      const subject = field(form, 'subject')?.value || '';
      if (state.follows?.[subject] !== undefined) { const button = form.querySelector('button'); if (button) { button.textContent = state.follows[subject] ? 'Following ✓ · Unfollow' : 'Follow'; button.setAttribute('aria-label', button.textContent); } }
    }
    form.querySelector<HTMLFieldSetElement>('[data-demo-controls]')?.removeAttribute('disabled');
  });
  document.querySelectorAll<HTMLFormElement>('[data-pick-visit]').forEach(form => {
    const inputs = [...form.querySelectorAll<HTMLInputElement>('[data-pick-input]')];
    const params = new URLSearchParams(location.search);
    // An explicit shared link takes precedence over a draft from this tab.
    const gift = params.size ? prefillPicks(params, inputs.map(input => input.name.slice(5)), Number(field(form, 'amount')!.value) * 100) : state.draft;
    if (gift) {
      field(form, 'amount')!.value = (gift.amount / 100).toFixed(2);
      inputs.forEach(input => input.value = String(gift.picks?.find(p => p.projectId === input.name.slice(5))?.count || 0));
      if ('frequency' in gift) {
        form.querySelectorAll<HTMLInputElement>('[name=frequency]').forEach(input => input.checked = input.value === gift.frequency);
        field(form, 'visibility')!.value = gift.visibility;
        field(form, 'note')!.value = gift.note || '';
        (field(form, 'announceAnonymously') as HTMLInputElement).checked = Boolean(gift.announceAnonymously);
        const options = form.querySelector<HTMLDetailsElement>('.pick-options');
        if (options && (gift.note || gift.announceAnonymously)) options.open = true;
      }
    }
  });
  enhancePickVisits();
  if (screen === '/checkout/review') {
    const gift = state.draft || fixture.sampleGift;
    const review = document.querySelector<HTMLElement>('[data-demo-review]');
    if (review && gift) {
      const text = (selector: string, value: string) => { review.querySelector(selector)!.textContent = value; };
      text('[data-demo-review-amount]', `${money(gift.amount)} to Alex Rivers`);
      text('[data-demo-review-frequency]', `${gift.frequency === 'once' ? 'One-time' : gift.frequency === 'monthly' ? 'Monthly' : 'Yearly'} · ${gift.visibility}`);
      const shares = new Map(gift.picks?.length ? splitUnits(1000, gift.picks).map(p => [p.projectId, p.amount / 10]) : []);
      const list = review.querySelector('[data-demo-review-parts]')!;
      list.replaceChildren(...gift.allocations.map(part => {
        const row = element('li', '', 'border-b border-border py-4 text-sm');
        const heading = element('div', '', 'flex justify-between gap-4'); heading.append(element('strong', projectName(part.projectId)), element('span', money(part.amount)));
        const count = gift.picks?.find(p => p.projectId === part.projectId)?.count || 1;
        const goal = projects().find(p => p.id === part.projectId)?.target;
        row.append(heading, element('p', `${count} ${count === 1 ? 'pick' : 'picks'} · ${shares.get(part.projectId) || 0}%${goal ? ` · ${money(goal)} aspiration` : ''}`, 'muted mt-2'));
        return row;
      }));
      const note = review.querySelector<HTMLElement>('[data-demo-review-note]')!; note.hidden = !gift.note;
      note.querySelector('p:last-child')!.textContent = gift.note || '';
      text('[data-demo-review-privacy]', gift.visibility === 'public' ? 'In a live gift, your name, amount, and picks are public. Your note stays private.' : gift.visibility === 'private' ? 'In a live gift, your name and note are shared only with the creator.' : gift.announceAnonymously ? 'In a live gift, an anonymous thank-you can appear without your amount.' : 'Your gift stays off the public timeline.');
      const recurring = review.querySelector<HTMLElement>('[data-demo-review-recurring]')!; recurring.hidden = gift.frequency === 'once';
      recurring.textContent = `On a live site, ${money(gift.amount)} repeats ${gift.frequency} until canceled. This demo takes no payments.`;
    }
  }
  if (projectForm) { const id = draftId || field(projectForm, 'id')?.value; const p = id ? state.projects?.[id] : undefined; if (p) showDraft(p); }
  if (state.projects) renderProjects();
  const filter = document.querySelector<HTMLFormElement>('.admin-filters:has(select[name="range"])'); if (filter) { restore(filter, Object.fromEntries(new URLSearchParams(location.search))); applyReport(filter); }
  if (state.tip && screen === '/thanks') {
    const block = document.querySelector('[data-demo-breakdown]');
    if (block) { const list = element('ul'); const shares = new Map(state.tip.picks?.length ? splitUnits(1000, state.tip.picks).map(p => [p.projectId, p.amount / 10]) : []); state.tip.allocations.forEach((part) => { const row = element('li', '', 'demo-tip-row'), name = element('span'); name.append(link(projectName(part.projectId), projectVisitUrl(part.projectId))); const count = state.tip!.picks?.find(p => p.projectId === part.projectId)?.count; if (count) name.append(element('small', `${count} ${count === 1 ? 'pick' : 'picks'} · ${shares.get(part.projectId)}%`, 'admin-caption')); row.append(name, element('strong', money(part.amount))); list.append(row); }); block.replaceChildren(element('h2', 'Your simulated support breakdown', 'section-title'), list, element('p', `Total: ${money(state.tip.amount)} · ${state.tip.frequency}`, 'demo-tip-total')); }
    const card = document.querySelector<HTMLElement>('.support-share'); if (card && state.tip.visibility !== 'public') card.hidden = true;
    const publicMessage = document.querySelector<HTMLElement>('[data-demo-public-message]'); if (publicMessage && state.tip.visibility !== 'public') publicMessage.hidden = true;
    const publicForm = document.querySelector<HTMLFormElement>('form:has(input[name="action"][value="post"])'); if (publicForm && state.tip.visibility !== 'public') publicForm.closest('.panel')?.setAttribute('hidden', '');
    document.querySelectorAll('.billing-heading').forEach((node) => { const title = node.querySelector('h2'); if (title) title.textContent = `${money(state.tip!.amount)} · ${state.tip!.frequency}`; });
    document.querySelectorAll('.panel').forEach((node) => { if (node.querySelector('.eyebrow')?.textContent?.includes('Monthly support')) (node as HTMLElement).hidden = true; });
  }
  if (state.stopped && screen === '/billing') { document.querySelector('.billing-heading .tag')!.textContent = 'Stopped · demo'; document.querySelector<HTMLButtonElement>('form[data-demo-action="/api/billing"] button')!.disabled = true; }
}

document.querySelector('[data-demo-reset]')?.addEventListener('click', () => { try { sessionStorage.removeItem(key); } catch { /* Nothing stored. */ } location.assign('/demo/'); });
document.addEventListener('submit', (event) => {
  const form = event.target; if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const values = formValues(form), action = values.action, endpoint = form.dataset.demoAction;
  try {
    if (endpoint === '/api/checkout/review') {
      const ids = [...form.querySelectorAll<HTMLInputElement>('[data-pick-input]')].map(input => input.name.slice(5));
      state.draft = demoPickGift(new FormData(form), ids);
      if (save()) location.assign('/demo/checkout/review/'); return;
    }
    if (endpoint === '/checkout' && screen === '/checkout/review') {
      state.draft ||= fixture.sampleGift;
      if (save()) location.assign('/demo/checkout/'); return;
    }
    if (form.hasAttribute('data-demo-confirm')) {
      state.tip = state.draft || fixture.sampleGift;
      if (save()) location.assign('/demo/thanks/'); return;
    }
    if (endpoint === '/api/checkout') {
      const amount = Math.round(Number(values.amount) * 100);
      const allocation = values.projectId ? [{ projectId: values.projectId, percentage: 100 }] : Object.entries(values).filter(([name]) => name.startsWith('percentage:')).map(([name, value]) => ({ projectId: name.slice(11), percentage: Number(value) }));
      state.tip = { amount, frequency: values.frequency || 'once', visibility: values.visibility || 'anonymous', allocations: allocateAmount(amount, allocation) };
      if (save()) location.assign('/demo/thanks/'); return;
    }
    if (endpoint === '/auth/demo') { location.assign(values.role === 'supporter' ? '/demo/' : '/demo/studio/'); return; }
    if (endpoint === '/auth/logout') { location.assign('/demo/login/'); return; }
    if (form.matches('.admin-filters:has(select[name="range"])')) { applyReport(form); notify('Report updated using fictional payments.'); return; }
    if (endpoint === '/discover') {
      const query = (values.q || '').toLowerCase().replace(/^@/, ''); let count = 0;
      document.querySelectorAll<HTMLElement>('.creator-card').forEach((card) => { card.hidden = !card.textContent?.toLowerCase().includes(query); if (!card.hidden) count++; });
      notify(`${count} sample creators match. Real account lookup is available on a self-hosted instance.`); return;
    }
    if (screen === '/studio/projects' && form.dataset.demoMethod === 'get') {
      document.querySelectorAll<HTMLElement>('.admin-project-row').forEach((row) => { row.hidden = Boolean((values.status && row.querySelector('[data-status]')?.getAttribute('data-status') !== values.status) || (values.q && !row.textContent?.toLowerCase().includes(values.q.toLowerCase()))); }); notify('Project filters applied.'); return;
    }
    if (action === 'project') {
      const id = values.id || draftId || `local-${crypto.randomUUID()}`;
      const p = { ...values, id, target: Math.round(Number(values.target) * 100), createdAt: new Date().toISOString() } as unknown as Project;
      state.projects ||= {}; state.projects[id] = p; save(); showDraft(p);
      if (!field(form, 'id')) { const hidden = element('input'); hidden.type = 'hidden'; hidden.name = 'id'; hidden.value = id; form.append(hidden); }
      notify('Project saved in this tab. Use Projects to preview publishing or archiving. Nothing was published publicly.'); return;
    }
    if (action === 'project-status' || action === 'project-duplicate') {
      const original = projects().find((p) => p.id === values.id); if (!original) return;
      const id = action === 'project-duplicate' ? `local-${crypto.randomUUID()}` : original.id;
      state.projects ||= {}; state.projects[id] = { ...original, id, title: action === 'project-duplicate' ? `${original.title} (copy)` : original.title, status: action === 'project-duplicate' ? 'draft' : values.status as Project['status'] };
      save(); renderProjects(); notify('Project updated in this tab only.'); return;
    }
    if (action === 'follow') {
      state.follows ||= {}; const enabled = !(state.follows[values.subject] ?? values.enabled === 'no'); state.follows[values.subject] = enabled; save();
      const button = form.querySelector('button'); if (button) { button.textContent = enabled ? 'Following ✓ · Unfollow' : 'Follow'; button.setAttribute('aria-label', button.textContent); }
      notify(enabled ? 'Following in this preview. Your real Bluesky account is unchanged.' : 'Unfollowed in this preview.'); return;
    }
    if (endpoint === '/api/billing') { state.stopped = true; save(); const button = form.querySelector('button'); if (button) { button.disabled = true; button.textContent = 'Stopped · demo'; } document.querySelector('.billing-heading .tag')!.textContent = 'Stopped · demo'; notify('Simulated renewals stopped. No real subscription exists.'); return; }
    if (['stripe','space','sync','profile-import','link-post'].includes(action)) { notify('This connects to a real provider on your own server. Read “Set up your own” for the configuration steps.'); return; }
    if (action === 'profile') { state.forms ||= {}; state.forms[savedFormKey(form)] = { ...values, discoverable: values.discoverable || 'no' }; save(); notify('Profile form saved in this tab. Public demo pages retain the sample creator.'); return; }
    if (['post-update','post','recommend','friend'].includes(action)) {
      const preview = element('article', '', 'notice demo-local-post'); preview.append(element('strong', 'Local preview · not published'), element('p', values.text || values.publicText || values.note || values.description || 'Recommendation removed.'));
      form.after(preview); notify('Preview created here. No message or recommendation was sent to AT Protocol.'); return;
    }
    notify('This screen previews the self-hosted app. Live connections require your own server.');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not update this preview.'); }
}, true);
document.addEventListener('click', (event) => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href="#demo-export"]'); if (!anchor) return;
  event.preventDefault(); const url = URL.createObjectURL(new Blob([paymentsCsv(reportRecords, fixture.projects)], { type: 'text/csv;charset=utf-8' }));
  const download = link('', url); download.download = 'feedme-fictional-payments.csv'; download.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
