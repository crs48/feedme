// Native popovers escape scrolling table containers. Without support or JavaScript,
// the same markup remains an ordinary details disclosure.
let active: { close: () => void; place: () => void; element: HTMLDetailsElement } | undefined;
let listening = false;

export const initAdminPopovers = (root: ParentNode = document) => {
  if (!('showPopover' in HTMLElement.prototype)) return;
  if (active && !active.element.isConnected) active.close();
  if (!listening) {
    listening = true;
    window.addEventListener('resize', () => active?.place());
    document.addEventListener('keydown', event => { if (event.key === 'Escape') active?.close(); });
    document.addEventListener('pointerdown', event => {
      if (event.target instanceof Node && !active?.element.contains(event.target)) active?.close();
    });
    document.addEventListener('scroll', (event) => {
      // Scrolling a long breakdown stays local; moving its table closes it.
      if (event.target instanceof Node && active?.element.contains(event.target)) return;
      active?.close();
    }, true);
  }
  root.querySelectorAll<HTMLDetailsElement>('[data-admin-popover]').forEach(details => {
    if (details.hasAttribute('data-enhanced')) return;
    const trigger = details.querySelector('summary')!;
    const panel = details.querySelector<HTMLElement>('.admin-popover-panel')!;
    let preview = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelClose = () => clearTimeout(timer);
    const close = () => {
      cancelClose();
      if (panel.contains(document.activeElement)) trigger.focus({ preventScroll: true });
      if (panel.matches(':popover-open')) panel.hidePopover();
      details.open = false;
      preview = false;
      if (active?.element === details) active = undefined;
    };
    const place = () => {
      if (!details.isConnected) { close(); return; }
      const rect = trigger.getBoundingClientRect();
      const gutter = 12, gap = 6;
      const below = window.innerHeight - rect.bottom - gutter - gap;
      const above = rect.top - gutter - gap;
      const openBelow = below >= Math.min(panel.scrollHeight, 240) || below >= above;
      panel.style.maxHeight = `${Math.max(80, Math.min(420, openBelow ? below : above))}px`;
      const top = openBelow ? rect.bottom + gap : rect.top - panel.offsetHeight - gap;
      panel.style.top = `${Math.max(gutter, Math.min(top, window.innerHeight - panel.offsetHeight - gutter))}px`;
      panel.style.left = `${Math.max(gutter, Math.min(rect.left, window.innerWidth - panel.offsetWidth - gutter))}px`;
    };
    const open = (hover: boolean) => {
      cancelClose();
      if (active?.element !== details) active?.close();
      preview = hover;
      details.open = true;
      panel.showPopover();
      active = { close, place, element: details };
      place();
    };
    const leave = () => {
      cancelClose();
      if (preview) timer = setTimeout(() => {
        if (!details.contains(document.activeElement)) close();
      }, 160);
    };
    panel.setAttribute('popover', 'manual');
    details.dataset.enhanced = '';
    trigger.addEventListener('click', event => {
      event.preventDefault();
      if (preview) { preview = false; cancelClose(); }
      else if (details.open) close();
      else open(false);
    });
    trigger.addEventListener('pointerenter', event => {
      cancelClose();
      if (event.pointerType === 'mouse' && !details.open) open(true);
    });
    trigger.addEventListener('pointerleave', leave);
    panel.addEventListener('pointerenter', cancelClose);
    panel.addEventListener('pointerleave', leave);
    details.addEventListener('focusout', () => {
      requestAnimationFrame(() => { if (!details.contains(document.activeElement)) close(); });
    });
    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open') && details.open) close();
    });
  });
};
