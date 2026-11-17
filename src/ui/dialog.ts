import { escapeAttr, escapeHtml } from './shared';

/**
 * The shell every new dialog shares: its backdrop, its box, a title with an optional line under it, its body, and its
 * buttons in a row at the bottom (closing is one of them; there is no corner ×). `className` sizes and styles this
 * dialog's own parts; `stacked` puts it over another dialog (the Integrations manager). `body` and `actions` are HTML.
 */
export function renderDialog(options: {
  className: string;
  title: string;
  note?: string;
  body: string;
  actions: string;
  stacked?: boolean;
}): string {
  return `
    <div class="modal-backdrop${options.stacked ? ' modal-backdrop-stacked' : ''}" role="presentation">
      <section class="dialog dialog-shell ${escapeAttr(options.className)}" role="dialog" aria-modal="true" aria-label="${escapeAttr(options.title)}">
        <header class="dialog-shell-header">
          <h2 class="dialog-shell-title">${escapeHtml(options.title)}</h2>
          ${options.note ? `<p class="dialog-note dialog-shell-note">${escapeHtml(options.note)}</p>` : ''}
        </header>
        <div class="dialog-shell-body">${options.body}</div>
        <div class="dialog-actions">${options.actions}</div>
      </section>
    </div>`;
}
