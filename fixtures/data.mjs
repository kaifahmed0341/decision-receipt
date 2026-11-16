/**
 * The demonstration data: one Jira project, one Confluence space, five issues and
 * five decision pages. Every name, team and date here is fictional.
 *
 * scripts/fixtures.mjs creates this data on a site. test/fixtures.test.mjs runs the
 * rule set over the same page text, so the expected verdicts below are checked on
 * every test run.
 */

export const PROJECT = { key: 'DREC', name: 'Decision Receipt Demo' };
export const SPACE = { key: 'DRDEMO', name: 'Decision Receipt Demo' };

/**
 * Pages, keyed by a short local id. `trash: true` pages are created and then moved to
 * the trash, to show how the panel treats a linked page that no longer exists.
 */
export const PAGES = {
  exportDecision: {
    title: 'Decision: retire the v1 CSV export endpoint',
    body: [
      '<h2>Context</h2>',
      '<p>The v1 CSV export endpoint duplicates the v2 export and has had no traffic from paying accounts since September.</p>',
      '<h2>Decision</h2>',
      '<p>Approved on 4 November 2026 by the platform group: we remove the v1 CSV export endpoint in release 4.2 (DREC-1).</p>',
      '<p>Customers on v1 get two release notes and an email before the removal.</p>',
      '<h2>Status</h2>',
      '<p>Status: Decided</p>',
    ].join(''),
  },
  rendererDecision: {
    title: 'Decision: invoice PDF renderer',
    body: [
      '<h2>Decision</h2>',
      '<p>The billing team agreed to move invoice PDFs to the new renderer from release 4.2 (DREC-2).</p>',
      '<p>The old renderer stays available behind a setting for one release.</p>',
    ].join(''),
  },
  releaseReview: {
    title: 'Release review: 4.2 readiness',
    body: [
      '<h2>Findings</h2>',
      '<p>Accessibility testing of the new invoice renderer found tables that screen readers cannot follow.</p>',
      '<p>We will not switch invoice PDFs to the new renderer until the accessibility fixes ship.</p>',
      '<p>The v1 CSV export removal can go ahead as planned.</p>',
    ].join(''),
  },
  platformSync: {
    title: 'Platform sync notes, 10 November',
    body: [
      '<h2>Notes</h2>',
      "<p>We looked at last week's API rate limit alerts; most came from one test account.</p>",
      '<p>Raising the public API rate limit to 600 requests per minute came up, and the group wants load test results first.</p>',
      '<h2>Actions</h2>',
      '<ul><li>Share the load test results by Friday.</li></ul>',
    ].join(''),
  },
  webhookNotes: {
    title: 'Webhook queue retirement notes',
    trash: true,
    body: '<p>Approved: archive the legacy webhook queue (DREC-4).</p>',
  },
};

/**
 * Issues, in creation order. `links` names pages from PAGES. `expected` is the overall
 * verdict the panel should show, and `pageVerdicts` the verdict for each readable page.
 */
export const ISSUES = [
  {
    summary: 'Remove the v1 CSV export endpoint',
    description: 'Fixture: one linked decision page that supports the task.',
    links: ['exportDecision'],
    expected: 'all-support',
    pageVerdicts: { exportDecision: 'supports' },
  },
  {
    summary: 'Switch invoice PDFs to the new renderer',
    description: 'Fixture: one linked page supports the task and another conflicts with it.',
    links: ['rendererDecision', 'releaseReview'],
    expected: 'conflict',
    pageVerdicts: { rendererDecision: 'supports', releaseReview: 'conflicts' },
  },
  {
    summary: 'Raise the public API rate limit to 600 requests per minute',
    description: 'Fixture: the linked page discusses the topic but states no decision.',
    links: ['platformSync'],
    expected: 'missing',
    pageVerdicts: { platformSync: 'missing' },
  },
  {
    summary: 'Archive the legacy webhook queue',
    description: 'Fixture: the only linked page has been moved to the trash.',
    links: ['webhookNotes'],
    expected: 'unchecked',
    pageVerdicts: {},
  },
  {
    summary: 'Rename the staging cluster',
    description: 'Fixture: no decision page is linked.',
    links: [],
    expected: 'no-links',
    pageVerdicts: {},
  },
];
