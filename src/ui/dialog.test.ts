import { describe, expect, it } from 'vitest';
import { renderDialog } from './dialog';

describe('the shared dialog shell', () => {
  it('puts the title, its note, the body, and the buttons in place, escaping the title and note', () => {
    const html = renderDialog({ className: 'example-dialog', title: 'Get <there>', note: 'What “it” does.', body: '<p class="example-body">Body</p>', actions: '<button type="button">Done</button>', stacked: true });
    expect(html).toContain('class="modal-backdrop modal-backdrop-stacked"');
    expect(html).toContain('class="dialog dialog-shell example-dialog" role="dialog" aria-modal="true" aria-label="Get &lt;there&gt;"');
    expect(html).toContain('<h2 class="dialog-shell-title">Get &lt;there&gt;</h2>');
    expect(html).toContain('<p class="dialog-note dialog-shell-note">What “it” does.</p>');
    expect(html.indexOf('example-body')).toBeLessThan(html.indexOf('dialog-actions'));
  });

  it('leaves the note out when there is none', () => {
    expect(renderDialog({ className: 'example-dialog', title: 'Done', body: '', actions: '' })).not.toContain('dialog-shell-note');
  });
});
