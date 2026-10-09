import { allocateAmount } from '../../src/lib/allocation';
import { money, netSupport, supportParts, type Project, type Support } from '../../src/lib/model';
import { reportQuery, selectedPayments, summarizePayments, earningsSeries, projectPerformance, supporterPerformance, recurringSummary, paymentsCsv, displayDate, paymentDate } from '../../src/lib/analytics';
import type { Subscription } from '../../src/lib/recurring';

type Tip = { amount: number; frequency: string; visibility: string; allocations: { projectId: string; amount: number }[] };
type State = { projects?: Record<string, Project>; forms?: Record<string, Record<string, string>>; follows?: Record<string, boolean>; tip?: Tip; stopped?: boolean };
const key = 'feedme-static-demo-v1';
const fixture = JSON.parse(document.getElementById('demo-data')?.textContent || '{}') as { projects: Project[]; payments: Support[]; subscriptions: Subscription[] };
const screen = document.body.dataset.demoScreen || '/';
let state: State = {};
try { state = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { /* Browsing works with storage blocked. */ }
const notify = (message: string) => { const box = document.getElementById('demo-notice'); if (box) { box.textContent = message; box.hidden = false; box.focus({ preventScroll: true }); } };
const save = () => { try { sessionStorage.setItem(key, JSON.stringify(state)); return true; } catch { notify('Browser storage is unavailable. This preview works, but changes cannot survive navigation.'); return false; } };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
const formValues = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, String(value)]));
const projects = () => fixture.projects.map((p) => state.projects?.[p.id] || p).concat(Object.values(state.projects || {}).filter((p) => !fixture.projects.some((seed) => seed.id === p.id)));
const projectEditUrl = (id: string) => fixture.projects.some((p) => p.id === id) ? `/demo/studio/projects/${id}/` : `/demo/studio/projects/new/?draft=${encodeURIComponent(id)}`;
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
const identity = (did?: string) => {
  const node = element('div', '', 'admin-person');
  if (did) { const img = element('img'); img.src = `/demo/avatars/${avatars[did.split(':').at(-1)?.[0] || ''] || '12'}.jpg`; img.width = 32; img.height = 32; img.alt = ''; img.style.borderRadius = '50%'; node.append(img); }
  node.append(element('span', person(did))); return node;
};
const table = (headings: string[], rows: (string | Node)[][]) => {
  const scroll = element('div', '', 'admin-table-scroll'), table = element('table', '', 'admin-table');
  const head = element('thead'), heading = element('tr'), body = element('tbody');
  const columnClass = (index: number) => ['Gross', 'Refunds', 'Disputes', 'Net', 'Net support'].includes(headings[index]) ? 'numeric' : '';
  headings.forEach((value, index) => heading.append(element('th', value, columnClass(index)))); head.append(heading);
  rows.forEach((values) => { const row = element('tr'); values.forEach((value, index) => { const cell = element('td', '', columnClass(index)); cell.append(value); row.append(cell); }); body.append(row); });
  table.append(head, body); scroll.append(table); return scroll;
};
const paymentTable = (records: Support[]) => table(['Supporter / payment', 'Project', 'Status', 'Net support'], records.map((s) => {
  const who = element('div'); who.append(identity(s.visibility === 'anonymous' ? undefined : s.supporterDid), element('span', `${displayDate(paymentDate(s))} · ${s.visibility}`, 'admin-caption'));
  const details = element('details'); details.append(element('summary', 'Payment details'), element('p', `Fictional ID: ${s.id}`), element('p', `Gross: ${money(s.amount)} · Refunded: ${money(s.refundedAmount)}`));
  if (s.note) details.append(element('p', `Fictional private note: ${s.note}`)); who.append(details);
  const allocation = element('div'); supportParts(s).forEach((p) => { const row = element('div'); row.append(link(projectName(p.projectId), `/demo/studio/projects/${p.projectId}/`), element('span', money(netSupport(p)), 'admin-caption')); allocation.append(row); });
  const status = element('span', s.status, 'status-pill'); status.dataset.status = s.status;
  const amount = element('div'); amount.append(element('strong', money(netSupport(s))), element('span', s.frequency || 'once', 'admin-caption'));
  return [who, allocation, status, amount];
}));
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
      projectPerformance(reportRecords, projects()).filter((p) => !query.project || p.id === query.project).forEach((p) => {
        const row = element('div', '', 'admin-progress-row'), heading = element('div'), track = element('div', '', 'progress'), bar = element('span');
        heading.append(link(p.title, projectEditUrl(p.id)), element('strong', money(p.net))); bar.style.width = `${stats.net ? p.net / stats.net * 100 : 0}%`; track.append(bar);
        row.append(heading, track, element('p', `${p.count} confirmed contributions`, 'admin-help')); performance.append(row);
      });
    }
    const health = card('Payment health');
    health?.querySelectorAll('dd').forEach((node, index) => { node.textContent = [money(stats.refunded), money(stats.disputed), String(stats.pending), String(stats.failed), String(recurring.pastDue), String(recurring.ending)][index]; });
    const recent = card('Recent payments'); if (recent) recent.replaceChildren(cardHeading('Recent payments', link('View payment history →', '/demo/studio/payments/')), paymentTable(reportRecords.slice(0, 5)));
  } else if (screen === '/studio/payments') {
    const payments = cards[0]; payments?.replaceChildren(cardHeading(`${reportRecords.length} payments · ${money(stats.net)} net`), paymentTable(reportRecords));
  } else if (screen === '/studio/supporters') {
    const supporters = supporterPerformance(reportRecords);
    cards[0]?.replaceChildren(cardHeading(`${supporters.length} named supporters`), table(['Supporter', 'Projects supported', 'First / latest', 'Net support'], supporters.map((s) => [identity(s.did), s.projects.map(projectName).join(' · '), `${displayDate(s.first)} / ${displayDate(s.last)}`, `${money(s.net)} · ${s.count} payments`])));
    const anonymous = summarizePayments(reportRecords.filter((s) => s.visibility === 'anonymous' || !s.supporterDid));
    const caption = cards[1]?.querySelector('.admin-help'); if (caption) caption.textContent = `${anonymous.anonymousPayments} tips · ${money(anonymous.net)} net support`;
  }
};
const renderProjects = () => {
  const list = document.querySelector('.admin-project-row')?.parentElement; if (!list || screen !== '/studio/projects') return;
  list.replaceChildren();
  projects().forEach((p) => {
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
  if (projectForm) { const id = draftId || field(projectForm, 'id')?.value; const p = id ? state.projects?.[id] : undefined; if (p) showDraft(p); }
  if (state.projects) renderProjects();
  const filter = document.querySelector<HTMLFormElement>('.admin-filters:has(select[name="range"])'); if (filter) { restore(filter, Object.fromEntries(new URLSearchParams(location.search))); applyReport(filter); }
  if (state.tip && screen === '/thanks') {
    const block = document.querySelector('[data-demo-breakdown]');
    if (block) { const list = element('ul'); state.tip.allocations.forEach((part) => { const row = element('li', '', 'demo-tip-row'); row.append(link(projectName(part.projectId), `/demo/support/${part.projectId}/`), element('strong', money(part.amount))); list.append(row); }); block.replaceChildren(element('h2', 'Your simulated support breakdown', 'section-title'), list, element('p', `Total: ${money(state.tip.amount)} · ${state.tip.frequency}`, 'demo-tip-total')); }
    const card = document.querySelector<HTMLElement>('.support-share'); if (card && state.tip.visibility !== 'public') card.hidden = true;
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
