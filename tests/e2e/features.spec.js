// Browser tests for Tailor, fitting on pages and importing a CV. They run as a guest, so they pass both
// against scripts/serve.mjs (no API) and against the Docker container (with the API, signed out).
import { test, expect } from '@playwright/test';

const expectedNoise = msg => /profile\.local\.js|Failed to load resource.*40[14]/.test(msg);

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('craftfolio.ui', '{"form":true,"coach":true}'));
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

const JOB_AD = 'Senior Product Designer, Design Systems (Remote) at Contoso. You lead research-driven redesigns, own our component library and design system, run usability testing and partner with engineering. Requirements: Figma, design systems, accessibility (WCAG), user research, prototyping.';
const CV_TEXT = 'Alex Morgan\nBackend Engineer\nalex.morgan@example.com\n\nExperience\nSenior Backend Engineer\nParcelly\n2021 - Present\n- Built a shipment-tracking API\n\nSkills\nGo, Python, Redis';
const cvFile = () => ({ name: 'alex.txt', mimeType: 'text/plain', buffer: Buffer.from(CV_TEXT) });

async function loadSamples(page) {
  await page.goto('/#documents');
  await page.locator('[data-act="samples"]').click();
  await expect(page.locator('.doc-card')).toHaveCount(2);
}

/** A made-up AI answer for the sample CV: a reordered first job, a skill order, a three-paragraph letter. */
async function sampleAnswer(page, cvId) {
  const jobs = await page.evaluate(async id => (await import('/js/store.js')).store.get(id).experience.map(e => ({ id: e.id, bullets: e.bullets.split('\n') })), cvId);
  return JSON.stringify({
    job: { company: 'Contoso', role: 'Senior Product Designer' },
    headline: 'Senior Product Designer',
    summary: 'Product designer with **7 years** of experience in B2B SaaS, leading research-driven redesigns and design systems.',
    experience: [{ id: jobs[0].id, bullets: [...jobs[0].bullets].reverse() }],
    skills: ['Design Systems', 'Accessibility', 'Figma'],
    cover_letter: {
      greeting: 'Dear Hiring Manager,',
      paragraphs: [
        'I am applying for the Senior Product Designer role at Contoso, after 7 years of designing B2B SaaS products.',
        'At Brightline Analytics I built a component library of 120+ components that 4 product teams use.',
        'I would be glad to talk about the role. Thank you for your time.',
      ],
      closing: 'Kind regards,',
    },
    matched_keywords: ['design systems'],
    missing_keywords: ['WCAG audits at scale'],
    notes: ['Led with the design system'],
  });
}

test.describe('tailor', () => {
  test('job text, an AI website, the pasted answer, the review: a tailored CV and a one-page letter', async ({ page, context }) => {
    test.setTimeout(90_000);
    // The AI websites are not opened for real.
    await context.route(/https:\/\/(chatgpt\.com|claude\.ai|gemini\.google\.com)\/.*/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>AI</title>' }));
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loadSamples(page);
    await page.locator('.nav a[href="#tailor"]').click();
    await expect(page.getByRole('heading', { name: /Tailor your CV/ })).toBeVisible();
    const cvId = await page.locator('[data-role="t-doc"]').inputValue();
    const generate = page.locator('[data-act="t-generate"]');
    await expect(generate).toBeDisabled(); // no job ad yet
    // As a guest the connected AIs say why they are off, and Quick tailor (no AI) is chosen.
    for (const id of ['claude', 'openai', 'gemini']) {
      await expect(page.locator(`[data-role="state-${id}"]`)).toHaveText(/Needs the Craftfolio server|Sign in to use it|Needs an API key/);
    }
    await expect(page.locator('input[name="t-ai"][value="quick"]')).toBeChecked();
    await page.locator('.t-ai[data-ai="web-chatgpt"]').click();

    await page.locator('[data-role="t-job"]').fill(JOB_AD);
    await expect(page.locator('[data-role="t-status"]')).toContainText('words');
    await page.locator('[data-role="t-cv-tpl"]').selectOption('signature-one');
    await page.locator('[data-role="t-letter-tpl"]').selectOption('classic');
    await expect(generate).toBeEnabled();
    const [site] = await Promise.all([context.waitForEvent('page'), generate.click()]);
    expect(site.url()).toBe('https://chatgpt.com/');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('Contoso');
    expect(prompt).not.toContain('jordan.rivera@example.com');
    await expect(page.locator('[data-role="t-paste"]')).toBeVisible();

    await page.locator('[data-role="t-reply"]').fill(await sampleAnswer(page, cvId));
    await expect(page.locator('.t-review')).toBeVisible();
    await expect(page.locator('.t-change')).toHaveCount(4); // summary, first job, skills order, letter
    await expect(page.locator('[data-role="t-company"]')).toHaveValue('Contoso'); // read from the ad by the AI
    await page.locator('[data-act="t-save"]').click();
    await expect(page.locator('.t-made')).toHaveCount(2);
    const made = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { pageCount } = await import('/js/fit.js');
      const cv = store.docs.find(d => d.type !== 'cover' && d.tags.includes('Tailored'));
      const letter = store.docs.find(d => d.type === 'cover' && d.tags.includes('Tailored'));
      return { cvTemplate: cv.templateId, cvTags: cv.tags, letterTemplate: letter.templateId, letterTitle: letter.title, letterPages: pageCount(letter) };
    });
    expect(made).toEqual({ cvTemplate: 'signature-one', cvTags: ['Tailored', 'Contoso'], letterTemplate: 'classic', letterTitle: 'Cover Letter - Contoso', letterPages: 1 });
  });

  test('a link pasted as a guest explains how to go on', async ({ page }) => {
    await loadSamples(page);
    await page.goto('/#tailor');
    await page.locator('[data-role="t-job"]').fill('https://jobs.example.com/123');
    await expect(page.locator('[data-role="t-status"]')).toContainText('paste the job ad');
  });

  test('every document card has Tailor; a letter starts from its CV', async ({ page }) => {
    await loadSamples(page);
    const cvId = await page.evaluate(async () => (await import('/js/store.js')).store.docs.find(d => d.type !== 'cover').id);
    for (const card of await page.locator('.doc-card').all()) {
      await expect(card.locator(`a[href="#tailor-${cvId}"]`)).toBeVisible();
    }
  });
});

test.describe('quick tailor', () => {
  test('no AI: reorders by the job keywords at once, writes a template letter, makes both documents', async ({ page }) => {
    await loadSamples(page);
    await page.goto('/#tailor');
    await page.locator('[data-role="t-job"]').fill(JOB_AD);
    await page.locator('[data-role="t-company"]').fill('Contoso');
    await page.locator('[data-role="t-role"]').fill('Senior Product Designer');
    await page.locator('.t-ai[data-ai="quick"]').click();
    await expect(page.locator('[data-act="t-generate"]')).toHaveText(/now \(no AI\)/);
    await page.locator('[data-act="t-generate"]').click();
    await expect(page.locator('.t-review')).toBeVisible();
    const labels = await page.locator('.t-change .t-pick strong').allTextContents();
    expect(labels).toContain('Skills order');
    expect(labels).toContain('Cover letter');
    await expect(page.locator('.t-letter')).toContainText('Senior Product Designer position at Contoso');
    await expect(page.locator('.t-rejected')).toHaveCount(0);
    await page.locator('[data-act="t-save"]').click();
    await expect(page.locator('.t-made')).toHaveCount(2);
  });
});

test.describe('fit on pages', () => {
  test('Fit on 2 pages tightens a three-page CV to two; Undo restores the spacing', async ({ page }) => {
    await loadSamples(page);
    // Find a length that takes three pages at the default spacing and two at a tighter one.
    const id = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const { pageCount } = await import('/js/fit.js');
      await document.fonts.ready;
      const cv = store.docs.find(d => d.type !== 'cover');
      const line = i => `Delivered result number ${i} for a product team, working with design and engineering each week`;
      for (let n = 10; n < 120; n += 2) {
        cv.experience[0].bullets = Array.from({ length: n }, (_, i) => line(i + 1)).join('\n');
        const tight = { ...cv, theme: { ...cv.theme, spacing: 1, margin: 1 } };
        if (pageCount(cv) === 3 && pageCount(tight) === 2) break;
      }
      store.update(cv);
      return cv.id;
    });
    await page.goto(`/#edit-${id}`);
    await page.locator('[data-menu="layout"] > summary').click();
    const count = page.locator('[data-role="page-count"]');
    await expect(count).toHaveText('now 3 pages');
    await page.locator('[data-act="fit"][data-pages="2"]').click();
    await expect(page.locator('.toast')).toContainText('Now on 2 pages');
    await expect(count).toHaveText('now 2 pages');
    const theme = () => page.evaluate(async id => { const t = (await import('/js/store.js')).store.get(id).theme; return [t.spacing, t.margin]; }, id);
    const fitted = await theme();
    expect(fitted[0] < 3 || fitted[1] < 4).toBe(true);
    await page.locator('[data-menu="layout"] > summary').click();
    await page.locator('[data-act="undo"]').click();
    await expect.poll(theme).toEqual([3, 4]);
  });
});

test.describe('import a CV', () => {
  test('from a template card it opens in that template', async ({ page }) => {
    await page.goto('/#templates');
    await page.locator('input[data-act="import"][data-tpl="horizon"]').setInputFiles(cvFile());
    await expect(page.locator('.editor')).toBeVisible();
    const doc = await page.evaluate(async () => (await import('/js/store.js')).store.get(location.hash.replace('#edit-', '')));
    expect([doc.templateId, doc.personal.name]).toEqual(['horizon', 'Alex Morgan']);
  });

  test('into the open CV, keeping its design; Undo brings the content back', async ({ page }) => {
    await loadSamples(page);
    const id = await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      const cv = store.docs.find(d => d.type !== 'cover');
      Object.assign(cv, { templateId: 'signature', tags: ['Design'] });
      store.update(cv);
      return cv.id;
    });
    await page.goto(`/#edit-${id}`);
    await page.locator('input[data-role="import-into"]').setInputFiles(cvFile());
    await page.locator('.modal [data-ok]').click();
    const read = () => page.evaluate(async id => { const d = (await import('/js/store.js')).store.get(id); return [d.personal.name, d.templateId, d.tags.join()]; }, id);
    await expect.poll(read).toEqual(['Alex Morgan', 'signature', 'Design']);
    await page.locator('[data-act="undo"]').click();
    await expect.poll(read).toEqual(['Jordan Rivera', 'signature', 'Design']);
  });

  test('in Tailor, an imported CV becomes the one to tailor', async ({ page }) => {
    await loadSamples(page);
    await page.goto('/#tailor');
    await page.locator('input[data-act="t-import"]').setInputFiles(cvFile());
    await expect(page.locator('[data-role="t-doc"] option:checked')).toHaveText(/Alex Morgan/);
  });
});

test.describe('editing view matches the PDF', () => {
  test('in every template, the page being edited breaks into the same pages as the printed one', async ({ page }) => {
    const rows = await page.evaluate(async () => {
      const { renderDoc, TEMPLATES } = await import('/js/templates.js');
      const { paginate } = await import('/js/paginate.js');
      const { sampleResume } = await import('/js/data.js');
      await document.fonts.ready;
      // Long enough to run over a page; entries with empty optional fields, as imported CVs have.
      const base = sampleResume();
      base.experience = [...base.experience, ...base.experience, ...base.experience].map((e, i) => ({ ...e, id: `job${i}abc`, location: i % 2 ? '' : e.location }));
      base.education = [...base.education, { ...base.education[0], id: 'edu2abcd', location: '', details: '' }];
      const measure = (doc, editable) => {
        const host = document.body.appendChild(Object.assign(document.createElement('div'), { style: 'position:absolute;left:0;top:0;width:794px' }));
        host.innerHTML = renderDoc(doc, { editable });
        const p = host.querySelector('.page');
        const pages = paginate(p, 1123);
        const cols = [...p.querySelectorAll('.r-main, .r-side')].map(c => Math.round(c.getBoundingClientRect().height));
        host.remove();
        return { pages, cols };
      };
      return TEMPLATES.map(t => {
        const doc = { ...base, templateId: t.id };
        return { id: t.id, print: measure(doc, false), edit: measure(doc, true) };
      });
    });
    for (const r of rows) {
      expect(r.edit.pages, `${r.id}: pages`).toBe(r.print.pages);
      // Editable text boxes round a little differently; anything more than that is a layout difference.
      r.print.cols.forEach((h, i) => expect(Math.abs(r.edit.cols[i] - h), `${r.id}: column ${i + 1} ${r.edit.cols[i]} vs ${h}`).toBeLessThanOrEqual(3));
    }
  });
});
