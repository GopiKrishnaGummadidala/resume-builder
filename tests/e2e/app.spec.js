// Browser tests: the real app in Chromium, driven the way a person uses it.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { FULL_LETTER_BODY } from '../fixtures.js';

/** One-page letter PDFs must stay under this size (was ~600 KB before indexed encoding). */
const PDF_BUDGET_KB = 200;

// The optional, git-ignored js/profile.local.js is missing on CI; that 404 is expected.
const expectedNoise = msg => /profile\.local\.js|Failed to load resource.*404/.test(msg);

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !expectedNoise(m.text())) errors.push(`console: ${m.text()}`); });
  testInfo.errors_seen = errors;
  await page.goto('/');
  await expect(page.locator('.hero h1')).toBeVisible();
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires an object pattern for fixtures
test.afterEach(async ({}, testInfo) => {
  expect(testInfo.errors_seen, 'no script errors during the test').toEqual([]);
});

const field = (page, path) => page.locator(`.ed-form [data-path="${path}"]`);
const live = page => page.locator('#live');

async function newLetter(page) {
  await page.goto('/#documents');
  await page.locator('[data-act="new-cover"]').first().click();
  await expect(page.locator('.editor')).toBeVisible();
  await page.locator('details[data-group="personal"]').evaluate(d => { d.open = true; }); // collapsed when a default profile exists
  await field(page, 'personal.name').fill('Jordan Rivera');
}

test.describe('navigation', () => {
  test('every view opens from the header', async ({ page }) => {
    const nav = page.locator('.nav');
    await nav.getByRole('link', { name: 'Templates' }).click();
    await expect(page.locator('.tpl-card')).toHaveCount(13);
    await nav.getByRole('link', { name: 'ATS Checker' }).click();
    await expect(page.getByRole('heading', { name: 'ATS Resume Checker' })).toBeVisible();
    await nav.getByRole('link', { name: 'Job Matcher' }).click();
    await expect(page.getByRole('heading', { name: 'Resume Job Matcher' })).toBeVisible();
    await nav.getByRole('link', { name: 'My documents' }).click();
    await expect(page.getByRole('heading', { name: 'My documents' })).toBeVisible();
  });

  test('template filters narrow the list', async ({ page }) => {
    await page.goto('/#templates');
    await page.locator('[data-filter="two-col"]').click();
    await expect(page.locator('.tpl-card')).toHaveCount(4);
    await page.locator('[data-filter="photo"]').click();
    await expect(page.locator('.tpl-card')).toHaveCount(3);
    await page.locator('[data-filter="all"]').click();
    await expect(page.locator('.tpl-card')).toHaveCount(13);
  });

  test('an unknown document id shows a not-found message', async ({ page }) => {
    await page.goto('/#edit-doesnotexist');
    await expect(page.getByText('Document not found')).toBeVisible();
  });
});

test.describe('CV editor', () => {
  test('typing updates the preview and survives a reload', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="new-resume"]').first().click();
    await field(page, 'personal.name').fill('Ada Lovelace');
    await field(page, 'summary').fill('Engineer who builds reliable billing systems.');
    await expect(live(page)).toContainText('Ada Lovelace');
    await expect(live(page)).toContainText('reliable billing systems');
    await page.reload();
    await expect(field(page, 'personal.name')).toHaveValue('Ada Lovelace');
    await expect(live(page)).toContainText('reliable billing systems');
  });

  test('add a position, strengthen its bullets, switch template', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="new-resume"]').first().click();
    await page.locator('[data-act="add-item"][data-list="experience"]').click();
    await field(page, 'experience.0.role').fill('Engineer');
    await field(page, 'experience.0.bullets').fill('Responsible for the billing system');
    await page.locator('[data-act="strengthen"]').click();
    await expect(field(page, 'experience.0.bullets')).toHaveValue('Managed the billing system');
    await page.locator('[data-role="template"]').selectOption('classic');
    await expect(live(page).locator('.page')).toHaveClass(/tpl-classic/);
    await expect(live(page)).toContainText('Managed the billing system');
  });

  test('markup typed into a field is shown as text, never run', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', d => { dialogs++; d.dismiss(); });
    await page.goto('/#documents');
    await page.locator('[data-act="new-resume"]').first().click();
    await field(page, 'personal.name').fill('<img src=x onerror=alert(1)>');
    await field(page, 'summary').fill('<script>alert(2)</script>');
    await expect(live(page)).toContainText('<img src=x onerror=alert(1)>');
    await expect(live(page).locator('img')).toHaveCount(0);
    await page.goto('/#documents');
    await expect(page.locator('.doc-card')).toHaveCount(1);
    expect(dialogs).toBe(0);
  });
});

test.describe('cover letter', () => {
  test('"To", greeting and closing are always on the page', async ({ page }) => {
    await newLetter(page);
    await expect(live(page).locator('.b-label')).toHaveText('To');
    await expect(live(page).locator('[data-edit-field="recipient.name"]')).toHaveText('Hiring Manager');
    await expect(live(page)).toContainText('Dear Hiring Manager,');
    await expect(live(page).locator('.b-close')).toContainText('Sincerely,');
    await expect(live(page).locator('.b-close')).toContainText('Jordan Rivera');
  });

  test('editing the recipient on the page updates the greeting, the form and storage', async ({ page }) => {
    await newLetter(page);
    const rec = live(page).locator('[data-edit-field="recipient.name"]');
    await rec.click({ clickCount: 3 });
    await page.keyboard.type('Mr. Brandt');
    await page.keyboard.press('Enter');
    await expect(field(page, 'recipient.name')).toHaveValue('Mr. Brandt');
    await expect(field(page, 'greeting')).toHaveValue('Dear Mr. Brandt,');
    await expect(live(page)).toContainText('Dear Mr. Brandt,');
    await page.reload();
    await expect(live(page).locator('[data-edit-field="recipient.name"]')).toHaveText('Mr. Brandt');
  });

  test('a custom greeting is not overwritten when the recipient changes', async ({ page }) => {
    await newLetter(page);
    await field(page, 'greeting').fill('Hello team,');
    await field(page, 'recipient.name').fill('Ms. Chen');
    await expect(field(page, 'greeting')).toHaveValue('Hello team,');
  });

  test('typing in the page body with Ctrl+B and Enter syncs to the form', async ({ page }) => {
    await newLetter(page);
    await live(page).locator('.l-edit').click();
    await page.keyboard.type('I am applying for the role.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('Key skills');
    await page.keyboard.press('Control+b');
    await page.keyboard.type(' include testing.');
    await expect(field(page, 'body')).toHaveValue('I am applying for the role.\n\n**Key skills** include testing.');
    await field(page, 'date').click(); // leave the page editor: it re-renders from the saved text
    await expect(live(page).locator('.l-edit strong')).toHaveText('Key skills');
  });

  test('pasting formatted text keeps bold and headings but not foreign styling', async ({ page }) => {
    await newLetter(page);
    await field(page, 'body').focus();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p style="font-family:Comic Sans MS;color:red">Over <b>13 years</b> of experience.</p><p><b>Frontend Frameworks</b></p><p>Angular and React.</p>');
      dt.setData('text/plain', 'plain');
      document.querySelector('[data-path="body"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(field(page, 'body')).toHaveValue('Over **13 years** of experience.\n\n# Frontend Frameworks\nAngular and React.');
    await expect(live(page).locator('.l-h')).toHaveText('Frontend Frameworks');
    expect(await live(page).locator('.l-edit').innerHTML()).not.toMatch(/Comic|color/);
  });

  test('"Draft from a CV" writes a body from the selected CV', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="samples"]').click();
    await page.locator('[data-act="letter-from"]').click();
    await field(page, 'job.role').fill('Lead Designer');
    await field(page, 'recipient.company').fill('Acme');
    await page.locator('[data-act="draft"]').click();
    await expect(field(page, 'body')).toHaveValue(/Lead Designer position at Acme/);
  });
});

test.describe('PDF download', () => {
  test('asks for a file name, downloads directly and stays within the size budget', async ({ page }) => {
    let printCalled = false;
    await page.exposeFunction('__printCalled', () => { printCalled = true; });
    await page.addInitScript(() => { window.print = () => window.__printCalled(); });
    await newLetter(page);
    await field(page, 'recipient.name').fill('Mr. Brandt');
    await field(page, 'body').fill(FULL_LETTER_BODY);
    await expect(page.locator('.overflow-warn')).toBeHidden(); // fits one page

    await page.locator('[data-act="download"]').click();
    const input = page.locator('#fn-input');
    await expect(input).toHaveValue('Cover Letter - Mr Brandt'); // named after the recipient
    await input.fill('Cover Letter: Northwind?.pdf'); // illegal characters and a typed extension
    const downloadPromise = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('Cover Letter Northwind.pdf');
    const file = await download.path();
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const kb = bytes.length / 1024;
    test.info().annotations.push({ type: 'pdf-size', description: `${kb.toFixed(0)} KB` });
    expect(kb, `PDF is ${kb.toFixed(0)} KB`).toBeLessThan(PDF_BUDGET_KB);
    expect(kb).toBeGreaterThan(15); // not an empty page
    expect(printCalled, 'the print dialog must not open').toBe(false);
    await expect(page.locator('.toast')).toContainText('Downloaded Cover Letter Northwind.pdf');
  });

  test('the PDF text is selectable: it can be read back out', async ({ page }) => {
    await newLetter(page);
    await field(page, 'recipient.name').fill('Mr. Brandt');
    await field(page, 'body').fill('I build “reliable” systems — and test them.\n\n# Frontend Frameworks\nAngular and React.');
    const text = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { buildPdf } = await import('/js/pdf-export.js');
      const { fileToText } = await import('/js/importer.js');
      const doc = store.get(location.hash.replace('#edit-', ''));
      const { blob, pages } = await buildPdf(doc, document.querySelector('#print-area'));
      return { pages, text: (await fileToText(new File([blob], 'letter.pdf', { type: 'application/pdf' }))).replace(/\s+/g, ' ') };
    });
    expect(text.pages).toBe(1);
    for (const part of ['Jordan Rivera', 'To', 'Mr. Brandt', 'Dear Mr. Brandt,', 'reliable', 'Frontend Frameworks', 'Angular and React.', 'Sincerely,']) {
      expect(text.text).toContain(part);
    }
  });

  test('cancelling the file-name dialog downloads nothing', async ({ page }) => {
    await newLetter(page);
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.locator('[data-act="download"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    await page.locator('[data-act="download"]').click();
    await page.locator('#fn-input').fill('   ');
    await page.keyboard.press('Enter');
    await expect(page.locator('.fn-error')).toBeVisible();
    await page.locator('[data-cancel]').click();
    expect(downloads).toBe(0);
  });
});

test.describe('documents', () => {
  test('duplicate and delete (with confirmation)', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="samples"]').click();
    await expect(page.locator('.doc-card')).toHaveCount(2);
    await page.locator('[data-act="dup"]').first().click();
    await expect(page.locator('.doc-card')).toHaveCount(3);
    await page.locator('[data-act="del"]').first().click();
    await page.locator('.modal [data-cancel]').click();
    await expect(page.locator('.doc-card')).toHaveCount(3);
    await page.locator('[data-act="del"]').first().click();
    await page.locator('.modal [data-ok]').click();
    await expect(page.locator('.doc-card')).toHaveCount(2);
  });

  test('importing a hostile JSON file gives a clean document', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', d => { dialogs++; d.dismiss(); });
    await page.goto('/#documents');
    const hostile = {
      title: 'Imported', type: 'resume', templateId: '"><script>alert(1)</script>',
      theme: { color: 'red;background:url(https://evil.example/x)', font: 'x' },
      personal: { name: '<svg onload=alert(1)>', email: { toString: 'x' } },
      experience: [null, { role: '<b>Dev</b>', bullets: 'Built things' }],
    };
    await page.locator('input[data-act="import"]').first().setInputFiles({ name: 'cv.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(hostile)) });
    await expect(page.locator('.editor')).toBeVisible();
    await expect(live(page).locator('.page')).toHaveClass(/tpl-banner/);
    await expect(live(page)).toContainText('<svg onload=alert(1)>');
    await expect(live(page).locator('svg[onload], script')).toHaveCount(0);
    const style = await live(page).locator('.page').getAttribute('style');
    expect(style).not.toContain('evil.example');
    expect(dialogs).toBe(0);
  });

  test('a file that is not JSON is rejected with a message', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('input[data-act="import"]').first().setInputFiles({ name: 'cv.json', mimeType: 'application/json', buffer: Buffer.from('{ not json') });
    await expect(page.locator('.toast')).toContainText('Import failed');
    await expect(page.locator('.doc-card')).toHaveCount(0);
  });
});

test.describe('two tabs', () => {
  test('documents created, edited and deleted in one tab appear in the other', async ({ context, page }) => {
    const other = await context.newPage();
    await other.goto('/#documents');
    await expect(other.locator('.empty')).toBeVisible();

    await newLetter(page); // tab 1 creates a letter
    await expect(other.locator('.doc-card')).toHaveCount(1); // tab 2 sees it without reloading

    await other.locator('[data-act="new-resume"]').first().click(); // tab 2 creates a CV
    await field(other, 'personal.name').fill('Second Tab');
    await page.goto('/#documents');
    await expect(page.locator('.doc-card')).toHaveCount(2); // neither tab lost the other's document

    await page.locator('.doc-card', { hasText: 'Untitled CV' }).locator('[data-act="del"]').click();
    await page.locator('.modal [data-ok]').click();
    await expect(other.getByText('Document not found')).toBeVisible(); // tab 2 was editing the deleted CV
    await other.goto('/#documents');
    await expect(other.locator('.doc-card')).toHaveCount(1);
  });

  test('an edit in one tab reloads the same document open in another tab', async ({ context, page }) => {
    await newLetter(page);
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(other.locator('.editor')).toBeVisible();
    await field(page, 'recipient.name').fill('Ms. Chen');
    await expect(field(other, 'recipient.name')).toHaveValue('Ms. Chen');
    await expect(other.locator('.toast')).toContainText('changed in another tab');
  });
});

test.describe('tools', () => {
  test('ATS checker scores a saved CV', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="samples"]').click();
    await page.goto('/#ats');
    await page.locator('[data-role="ats-doc"]').selectOption({ index: 1 });
    const score = Number(await page.locator('#ats-result .ring span').textContent());
    expect(score).toBeGreaterThanOrEqual(75);
    await expect(page.locator('#ats-result .checks li')).toHaveCount(16);
  });

  test('job matcher sorts keywords into matched and missing', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="samples"]').click();
    await page.goto('/#match');
    await page.locator('[data-role="m-doc"]').selectOption({ index: 1 });
    await page.locator('[data-role="m-jd"]').fill('Product Designer with Figma, design systems, user research and SQL. Python is a plus.');
    await page.locator('[data-act="m-run"]').click();
    await expect(page.locator('#m-result .kw.ok', { hasText: 'figma' })).toBeVisible();
    await expect(page.locator('#m-result .kw.bad', { hasText: 'sql' })).toBeVisible();
  });
});

test.describe('cover letter name', () => {
  test('fills in from the To details until it is typed by hand', async ({ page }) => {
    await newLetter(page);
    const title = page.locator('.title-input');
    await expect(title).toHaveValue('Untitled cover letter');
    await field(page, 'recipient.name').fill('Mr. Brandt');
    await expect(title).toHaveValue('Cover Letter - Mr. Brandt');
    await field(page, 'recipient.company').fill('Northwind Labs');
    await expect(title).toHaveValue('Cover Letter - Northwind Labs');

    await page.locator('[data-act="download"]').click();
    await expect(page.locator('#fn-input')).toHaveValue('Cover Letter - Northwind Labs');
    await page.keyboard.press('Escape');

    await page.goto('/#documents'); // saved, and shown in the list
    await expect(page.locator('.doc-card h3').first()).toHaveText('Cover Letter - Northwind Labs');
  });

  test('a name typed by hand is kept; clearing the recipient resets an automatic one', async ({ page }) => {
    await newLetter(page);
    const title = page.locator('.title-input');
    await field(page, 'recipient.company').fill('Northwind Labs');
    await field(page, 'recipient.company').fill('');
    await expect(title).toHaveValue('Untitled cover letter');
    await title.fill('Application 2026');
    await field(page, 'recipient.company').fill('Northwind Labs');
    await expect(title).toHaveValue('Application 2026');
  });

  test('editing the recipient on the page also names the letter', async ({ page }) => {
    await newLetter(page);
    const name = live(page).locator('[data-edit-field="recipient.name"]');
    await name.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Ms. Okafor');
    await expect(page.locator('.title-input')).toHaveValue('Cover Letter - Ms. Okafor');
  });
});

test.describe('contact links', () => {
  test('LinkedIn and GitHub open in a new tab from the page, and are clickable in the PDF', async ({ page, context }) => {
    await newLetter(page);
    await field(page, 'personal.linkedin').fill('linkedin.com/in/jordan-rivera');
    await field(page, 'personal.github').fill('github.com/jordanr');
    const linkedin = live(page).locator('a[href="https://linkedin.com/in/jordan-rivera"]');
    const github = live(page).locator('a[href="https://github.com/jordanr"]');
    await expect(linkedin).toHaveAttribute('target', '_blank');
    await expect(github).toHaveAttribute('rel', 'noopener noreferrer');

    await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }));
    const [popup] = await Promise.all([context.waitForEvent('page'), github.click()]);
    expect(popup.url()).toBe('https://github.com/jordanr');
    await popup.close();

    const raw = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { buildPdf } = await import('/js/pdf-export.js');
      const doc = store.get(location.hash.replace('#edit-', ''));
      const { blob } = await buildPdf(doc, document.querySelector('#print-area'));
      return new TextDecoder('latin1').decode(await blob.arrayBuffer());
    });
    expect(raw).toContain('/URI (https://linkedin.com/in/jordan-rivera)');
    expect(raw).toContain('/URI (https://github.com/jordanr)');
  });
});

/** A wide PNG drawn in the page: valid, and not square, so the crop is exercised. */
const widePng = page => page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 80; c.height = 40;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 0, 40, 40);
  ctx.fillStyle = '#2980b9'; ctx.fillRect(40, 0, 40, 40);
  return c.toDataURL('image/png').split(',')[1];
}).then(b64 => Buffer.from(b64, 'base64'));

async function newCv(page) {
  await page.goto('/#documents');
  await page.locator('[data-act="samples"]').click();
  await page.locator('.doc-card', { hasText: 'Sample — Product Designer' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.locator('.editor')).toBeVisible();
}
const pageBox = page => live(page).locator('.page');
const cssVar = (page, name) => pageBox(page).evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

test.describe('layout, fonts and themes', () => {
  test('the Layout menu changes spacing, margins and page size, and saves them', async ({ page }) => {
    await newCv(page);
    await expect(pageBox(page)).toHaveCSS('width', '794px');
    await page.getByText('Layout', { exact: true }).click();
    await page.getByLabel('Content spacing').fill('6');
    await page.getByLabel('Page margins').fill('2');
    await page.getByLabel('US Letter').check();
    expect(await cssVar(page, '--sp')).toBe('1.7');
    expect(await cssVar(page, '--mg')).toBe('0.7');
    await expect(pageBox(page)).toHaveCSS('width', '816px');
    await expect(pageBox(page)).toHaveCSS('min-height', '1056px');

    await page.reload();
    await expect(pageBox(page)).toHaveCSS('width', '816px');
    expect(await cssVar(page, '--sp')).toBe('1.7');
    await page.getByText('Layout', { exact: true }).click();
    await expect(page.getByLabel('Content spacing')).toHaveValue('6');
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expect(pageBox(page)).toHaveCSS('width', '794px');
    await expect(page.getByLabel('Content spacing')).toHaveValue('3');
    await expect(page.getByLabel('A4')).toBeChecked();
  });

  test('a US Letter document downloads as a US Letter PDF', async ({ page }) => {
    await newCv(page);
    await page.getByText('Layout', { exact: true }).click();
    await page.getByLabel('US Letter').check();
    const raw = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { buildPdf } = await import('/js/pdf-export.js');
      const { blob } = await buildPdf(store.get(location.hash.replace('#edit-', '')), document.querySelector('#print-area'));
      return new TextDecoder('latin1').decode(await blob.arrayBuffer());
    });
    expect(raw).toMatch(/\/MediaBox \[0 0 612\.? 792\.?\]/);
  });

  test('Fonts and Themes menus change the page; only one menu is open at a time', async ({ page }) => {
    await newCv(page);
    await page.getByText('Fonts', { exact: true }).click();
    await page.getByRole('button', { name: 'Playfair Display (serif)' }).click();
    await expect(pageBox(page)).toHaveCSS('font-family', /Playfair Display/);
    await page.getByText('Themes', { exact: true }).click();
    await expect(page.locator('[data-menu="fonts"]')).not.toHaveAttribute('open', '');
    await page.getByLabel('Custom colour').fill('#aa3366');
    expect(await cssVar(page, '--accent')).toBe('#aa3366');
    await page.locator('.swatch[data-color="#2563eb"]').click();
    expect(await cssVar(page, '--accent')).toBe('#2563eb');
    await page.locator('.ed-preview').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.tb-menu[open]')).toHaveCount(0);
  });

  test('each new template opens in the editor without errors', async ({ page }) => {
    await newCv(page);
    for (const id of ['profile', 'timeline', 'elegant', 'bold', 'corporate', 'studio']) {
      await page.locator('[data-role="template"]').selectOption(id);
      await expect(live(page).locator(`.tpl-${id}`)).toContainText('Brightline Analytics');
    }
  });
});

test.describe('undo and redo', () => {
  test('steps back and forward through changes, including the toolbar state', async ({ page }) => {
    await newCv(page);
    const undo = page.getByRole('button', { name: 'Undo' });
    const redo = page.getByRole('button', { name: 'Redo' });
    await expect(undo).toBeDisabled();
    await page.locator('[data-role="template"]').selectOption('elegant');
    await field(page, 'personal.name').fill('Alex Morgan');
    await expect(undo).toBeEnabled();

    await undo.click();
    await expect(field(page, 'personal.name')).toHaveValue('Jordan Rivera');
    await expect(live(page).locator('.tpl-elegant')).toContainText('Jordan Rivera');
    await undo.click();
    await expect(live(page).locator('.tpl-banner')).toBeVisible();
    await expect(page.locator('[data-role="template"]')).toHaveValue('banner');
    await expect(undo).toBeDisabled();

    await redo.click();
    await redo.click();
    await expect(live(page).locator('.tpl-elegant')).toContainText('Alex Morgan');
    await expect(redo).toBeDisabled();

    await page.reload(); // the redone state is what was saved
    await expect(field(page, 'personal.name')).toHaveValue('Alex Morgan');
  });
});

test.describe('photo', () => {
  test('an uploaded image is cropped, shown on the page, kept after a reload, and removable', async ({ page }) => {
    await newCv(page);
    await page.locator('[data-role="photo"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await widePng(page) });
    const img = live(page).locator('img.r-photo');
    await expect(img).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    expect(await img.evaluate(el => [el.naturalWidth, el.naturalHeight])).toEqual([320, 320]);
    await page.reload();
    await expect(live(page).locator('img.r-photo')).toBeVisible();

    const size = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { buildPdf } = await import('/js/pdf-export.js');
      return (await buildPdf(store.get(location.hash.replace('#edit-', '')), document.querySelector('#print-area'))).blob.size;
    });
    expect(size).toBeGreaterThan(15 * 1024);

    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(live(page).locator('img.r-photo')).toHaveCount(0);
  });

  test('a file that is not an image is refused with a message', async ({ page }) => {
    await newCv(page);
    await page.locator('[data-role="photo"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('.toast')).toContainText('Choose a JPG, PNG or WebP image.');
    await expect(live(page).locator('img.r-photo')).toHaveCount(0);
  });
});
