// Browser tests: the real app in Chromium, driven the way a person uses it.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { FULL_LETTER_BODY } from '../fixtures.js';

/** One-page letter PDFs must stay under this size (was ~600 KB before indexed encoding). */
const PDF_BUDGET_KB = 200;

// The optional, git-ignored js/profile.local.js is missing on CI; that 404 is expected.
const expectedNoise = msg => /profile\.local\.js|Failed to load resource.*404/.test(msg);

test.beforeEach(async ({ page }, testInfo) => {
  // Most tests fill the complete form, so its panel starts open. The "editing on the page" tests
  // start like a first visit, with both panels closed.
  if (!testInfo.titlePath.includes('editing on the page')) {
    await page.addInitScript(() => localStorage.setItem('craftfolio.ui', '{"form":true,"coach":true}'));
  }
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
    await expect(page.locator('.tpl-card')).toHaveCount(14);
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
    await expect(page.locator('.tpl-card')).toHaveCount(5);
    await page.locator('[data-filter="photo"]').click();
    await expect(page.locator('.tpl-card')).toHaveCount(4);
    await page.locator('[data-filter="all"]').click();
    await expect(page.locator('.tpl-card')).toHaveCount(14);
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
    await page.locator('.ed-form [data-act="add-item"][data-list="experience"]').click();
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
    for (const id of ['profile', 'signature', 'timeline', 'elegant', 'bold', 'corporate', 'studio']) {
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

test.describe('achievements, interests and entries with detail', () => {
  test('they are edited in the form, shown by the Signature template and saved', async ({ page }) => {
    await newCv(page);
    await page.locator('[data-role="template"]').selectOption('signature');
    await page.locator('details[data-group="achievements"]').evaluate(d => { d.open = true; });
    await page.getByRole('button', { name: '+ Add achievement' }).click();
    await field(page, 'achievements.1.title').fill('Load time');
    await field(page, 'achievements.1.date').fill('Jul 2023');
    await field(page, 'achievements.1.description').fill('Cut load time **by 40%** <script>window.__x=1</script>');
    await field(page, 'experience.0.about').fill('Shipping software · 120+ clients');
    await page.locator('details[data-group="extra"]').evaluate(d => { d.open = true; });
    await field(page, 'languages').fill('English | Fluent\nGerman | Elementary');
    await field(page, 'certifications').fill('Solutions Associate | Microsoft | Feb 2019');

    const side = live(page).locator('.r-side');
    await expect(side.locator('[data-sec="achievements"]')).toContainText('Load time');
    await expect(side.locator('[data-sec="achievements"] strong', { hasText: 'by 40%' })).toBeVisible();
    await expect(side.locator('[data-sec="languages"] .r-level')).toHaveCount(2);
    await expect(side.locator('[data-sec="languages"] .r-level i.on')).toHaveCount(5); // 4 + 1
    await expect(side.locator('[data-sec="certifications"]')).toContainText('Microsoft');
    await expect(live(page).locator('.r-about').first()).toHaveText('Shipping software · 120+ clients');
    expect(await page.evaluate(() => window.__x)).toBeUndefined();

    await page.reload();
    await expect(live(page).locator('[data-sec="achievements"]')).toContainText('Jul 2023');
    await page.locator('[data-role="template"]').selectOption('classic'); // content survives a template switch
    await expect(live(page).locator('[data-sec="achievements"]')).toContainText('Load time');
    await expect(live(page).locator('[data-sec="languages"]')).toContainText('German – Elementary');
  });
});

test.describe('editing on the page', () => {
  const onPage = (page, path) => live(page).locator(`[data-edit-field="${path}"]`);
  /** The saved document, read back from the store. `pick` runs here in the test, not in the page. */
  const stored = async (page, pick) => pick(await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    store.flush();
    return store.get(location.hash.replace('#edit-', ''));
  }));
  async function retype(page, locator, text) {
    await locator.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(text);
  }

  test('the page is the editor: no form until it is asked for, and the choice is remembered', async ({ page }) => {
    await newCv(page);
    await expect(page.locator('.ed-form')).toBeHidden();
    await expect(page.locator('#coach')).toBeHidden();
    await expect(page.locator('#rail-score')).toHaveText(/^\d+$/);
    await page.getByRole('button', { name: 'All fields' }).click();
    await expect(field(page, 'personal.name')).toBeVisible();
    await page.getByRole('button', { name: /Coach/ }).click();
    await expect(page.locator('#coach')).toContainText('CV score');
    await page.reload();
    await expect(field(page, 'personal.name')).toBeVisible();
    await page.getByRole('button', { name: 'All fields' }).click();
    await expect(page.locator('.ed-form')).toBeHidden();
  });

  test('text typed on the page is saved, and undo brings the old text back', async ({ page }) => {
    await newCv(page);
    await retype(page, onPage(page, 'personal.name'), 'Alex Morgan');
    await retype(page, onPage(page, 'experience.0.company'), 'Northwind <b>Labs</b>');
    await retype(page, onPage(page, 'experience.0.end'), '2024');
    await page.locator('.ed-preview').click({ position: { x: 5, y: 5 } }); // leave the field
    await expect(onPage(page, 'experience.0.company')).toHaveText('Northwind <b>Labs</b>');
    expect(await stored(page, d => [d.personal.name, d.experience[0].company, d.experience[0].end])).toEqual(['Alex Morgan', 'Northwind <b>Labs</b>', '2024']);
    await page.reload();
    await expect(onPage(page, 'personal.name')).toHaveText('Alex Morgan');

    await retype(page, onPage(page, 'personal.title'), 'Design Lead');
    await page.locator('.ed-preview').click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(onPage(page, 'personal.title')).toHaveText('Senior Product Designer');
  });

  test('bullets are typed on the page: Enter starts a new one, Ctrl+B makes bold', async ({ page }) => {
    await newCv(page);
    const bullets = live(page).locator('[data-edit-lines="experience.1.bullets"]');
    await bullets.locator('li').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Cut build time ');
    await page.keyboard.press('ControlOrMeta+B');
    await page.keyboard.type('by half');
    await page.keyboard.press('ControlOrMeta+B');
    expect((await stored(page, d => d.experience[1].bullets)).split('\n')).toEqual([
      'Designed self-serve billing that reduced support tickets by 31%',
      'Partnered with engineering to cut design-to-dev handoff time in half',
      'Launched accessibility audit bringing core flows to WCAG 2.1 AA',
      'Cut build time **by half**',
    ]);
    await page.locator('.ed-preview').click({ position: { x: 5, y: 5 } });
    await expect(bullets.locator('li')).toHaveCount(4);
    await expect(bullets.locator('li').last().locator('strong')).toHaveText('by half');
  });

  test('pasting into a bullet keeps the text and drops the markup', async ({ page }) => {
    await newCv(page);
    const bullets = live(page).locator('[data-edit-lines="experience.0.bullets"]');
    await bullets.locator('li').first().click();
    await page.keyboard.press('Home');
    await bullets.evaluate(el => {
      const data = new DataTransfer();
      data.setData('text/html', '<span style="color:red;font-size:40px">Styled </span><img src=x onerror="window.__x=1">');
      data.setData('text/plain', 'Styled ');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(bullets.locator('li').first()).toHaveText(/^Styled Led redesign/);
    await expect(bullets.locator('img, span[style]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__x)).toBeUndefined();
  });

  test('entries are added, moved and removed from the page', async ({ page }) => {
    await newCv(page);
    const exp = live(page).locator('[data-sec="experience"]');
    await exp.getByRole('button', { name: 'Add position' }).click();
    await expect(onPage(page, 'experience.2.role')).toBeFocused();
    await page.keyboard.type('Intern');
    await expect(exp.locator('.r-item')).toHaveCount(3);

    const third = exp.locator('.r-item').nth(2);
    await third.hover();
    await third.getByRole('button', { name: 'Move up' }).click();
    expect(await stored(page, d => d.experience.map(e => e.role))).toEqual(['Senior Product Designer', 'Intern', 'Product Designer']);
    const second = exp.locator('.r-item').nth(1);
    await second.hover();
    await second.getByRole('button', { name: 'Remove' }).click();
    expect(await stored(page, d => d.experience.map(e => e.role))).toEqual(['Senior Product Designer', 'Product Designer']);
    await exp.locator('.r-item').first().hover(); // controls show on hover or focus
    await expect(exp.locator('.r-item').first().getByRole('button', { name: 'Move up' })).toBeDisabled();
  });

  test('a new CV can be written from an empty page', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="new-resume"]').first().click();
    await retype(page, onPage(page, 'personal.name'), 'Ada Lovelace');
    await onPage(page, 'summary').click();
    await page.keyboard.type('Engineer who builds reliable billing systems.');
    await live(page).getByRole('button', { name: 'Add position' }).click();
    await page.keyboard.type('Engineer');
    await live(page).locator('[data-edit-lines="experience.0.bullets"]').click();
    await page.keyboard.type('Rebuilt invoicing');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Cut failed payments by 12%');
    expect(await stored(page, d => [d.personal.name, d.summary, d.experience[0].role, d.experience[0].bullets])).toEqual(
      ['Ada Lovelace', 'Engineer who builds reliable billing systems.', 'Engineer', 'Rebuilt invoicing\nCut failed payments by 12%']);
    await page.goto('/#documents'); // the saved card is the plain render: no controls, no placeholders
    await expect(page.locator('.doc-card .page')).toContainText('Rebuilt invoicing');
    await expect(page.locator('.doc-card .page button, .doc-card .page [contenteditable]')).toHaveCount(0);
  });

  test('the pencil opens the form at the right field', async ({ page }) => {
    await newCv(page);
    await live(page).getByRole('button', { name: 'Edit skills' }).click();
    await expect(field(page, 'skills')).toBeFocused();
    await field(page, 'skills').fill('Figma, Research');
    await expect(live(page).locator('[data-sec="skills"]')).toContainText('Research');
    await live(page).getByRole('button', { name: 'Edit contact details and photo' }).click();
    await expect(field(page, 'personal.email')).toBeFocused();
    await live(page).getByRole('button', { name: 'Edit languages' }).click();
    await expect(field(page, 'languages')).toBeFocused();
  });

  test('the downloaded PDF has no editing controls or placeholders', async ({ page }) => {
    await page.goto('/#documents');
    await page.locator('[data-act="new-resume"]').first().click();
    await retype(page, onPage(page, 'personal.name'), 'Ada Lovelace');
    const text = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { buildPdf } = await import('/js/pdf-export.js');
      const { fileToText } = await import('/js/importer.js');
      const { blob } = await buildPdf(store.get(location.hash.replace('#edit-', '')), document.querySelector('#print-area'));
      return (await fileToText(new File([blob], 'cv.pdf', { type: 'application/pdf' }))).replace(/\s+/g, ' ');
    });
    expect(text).toContain('Ada Lovelace');
    for (const word of ['Add position', 'Job title', 'Summary:', 'Add skills']) expect(text).not.toContain(word);
  });
});

test.describe('importing a PDF', () => {
  /** Build a template's sample CV as a PDF, read it back, and parse it — all in the page. */
  const roundTrip = (page, templateId) => page.evaluate(async id => {
    const { sampleResume } = await import('/js/data.js');
    const { buildPdf } = await import('/js/pdf-export.js');
    const { fileToText, parseResumeText } = await import('/js/importer.js');
    const { blob } = await buildPdf(sampleResume(id), document.querySelector('#print-area'));
    return parseResumeText(await fileToText(new File([blob], 'cv.pdf', { type: 'application/pdf' })));
  }, templateId);

  test('a downloaded CV imports back into the same fields, in every template', async ({ page }) => {
    test.setTimeout(120_000);
    const ids = await page.evaluate(async () => (await import('/js/templates.js')).TEMPLATES.map(t => t.id));
    for (const id of ids) {
      const r = await roundTrip(page, id);
      expect.soft(r.personal.name.toLowerCase(), id).toBe('jordan rivera');
      expect.soft(r.personal.title.toLowerCase(), id).toBe('senior product designer');
      expect.soft(r.personal.email, id).toBe('jordan.rivera@example.com');
      expect.soft(r.experience.map(e => [e.role, e.company, e.start, e.end]), id).toEqual([
        ['Senior Product Designer', 'Brightline Analytics', '2021', 'Present'],
        ['Product Designer', 'Northwind Labs', '2018', '2021'],
      ]);
      expect.soft(r.experience[0].bullets.split('\n'), id).toContain('Led redesign of onboarding flow, increasing 7-day activation by 23%');
      expect.soft(r.experience[1].bullets.split('\n').length, id).toBe(3);
      expect.soft(r.education.map(e => e.degree), id).toEqual(['B.A. Interaction Design']);
      expect.soft(r.skills.split(', '), id).toContain('Journey Mapping');
      expect.soft(r.languages, id).toBe('English | Native\nSpanish | Professional working');
      expect.soft(r.interests, id).toBe('Trail running, Letterpress printing');
    }
  });

  test('the Import button turns a PDF into a CV and opens it', async ({ page }) => {
    const pdf = await page.evaluate(async () => {
      const { sampleResume } = await import('/js/data.js');
      const { buildPdf } = await import('/js/pdf-export.js');
      const { blob } = await buildPdf(sampleResume('signature'), document.querySelector('#print-area'));
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await page.goto('/#documents');
    await page.locator('input[data-act="import"]').first().setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
    await expect(page.locator('.editor')).toBeVisible();
    await expect(page.locator('.title-input')).toHaveValue('Jordan Rivera — imported');
    await expect(live(page).locator('[data-edit-field="experience.1.company"]')).toHaveText('Northwind Labs');
    await expect(live(page).locator('[data-edit-field="experience.0.about"]')).toHaveText('Analytics platform for mid-size retailers · 300 employees');
  });

  test('a line that falls across a page break stays in the PDF text', async ({ page }) => {
    const text = await page.evaluate(async () => {
      const { sampleResume } = await import('/js/data.js');
      const { buildPdf } = await import('/js/pdf-export.js');
      const { fileToText } = await import('/js/importer.js');
      const r = sampleResume('classic');
      r.interests = 'Chess'; // in this template the sample ends right on the page edge
      const { blob, pages } = await buildPdf(r, document.querySelector('#print-area'));
      return { pages, text: await fileToText(new File([blob], 'cv.pdf', { type: 'application/pdf' })) };
    });
    expect(text.pages).toBe(2);
    expect(text.text).toContain('Chess');
  });
});
