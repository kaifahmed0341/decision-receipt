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
  auditDecision: {
    title: 'Decision: audit log retention',
    body: '<p>The security group agreed to move audit logs to cold storage after 90 days (DREC-6).</p>',
  },
  // Restricted so only the account that runs the fixture script can read it.
  // The Jira link gets a neutral title so the link itself does not reveal the page title.
  auditRestricted: {
    title: 'Legal hold review: audit logs',
    restrictToOwner: true,
    linkTitle: 'Confluence page',
    body: '<p>Legal has not approved moving audit logs to cold storage while the contract review is open (DREC-6).</p>',
  },
  // Edited by scripts/edit-page.mjs to show a recorded check going stale.
  ssoDecision: {
    title: 'Decision: admin console sign-in',
    body: '<p>Approved: the admin console moves to single sign-on in release 4.3 (DREC-7).</p>',
    editedBody: '<p>Deferred: single sign-on for the admin console waits for release 4.4 (DREC-7).</p>',
  },
  // The three pages below use the storage shapes Confluence itself produces for its
  // decision items, status lozenges, task lists and page-properties tables
  // (see test/storage-samples). The panel used to show "Decision not found" for them.
  onboardingDecision: {
    title: 'DACI: archive the old onboarding emails',
    body: [
      '<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table data-layout="default"><tbody>',
      '<tr><th><p><strong>Status</strong></p></th><td><p><ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="title">DECIDED</ac:parameter><ac:parameter ac:name="colour">Green</ac:parameter></ac:structured-macro></p></td></tr>',
      '<tr><th><p><strong>Driver</strong></p></th><td><p>Lifecycle team</p></td></tr>',
      '</tbody></table></ac:rich-text-body></ac:structured-macro>',
      '<h2>Outcome</h2>',
      '<ac:adf-extension><ac:adf-node type="decision-list"><ac:adf-attribute key="local-id">dl-onb</ac:adf-attribute><ac:adf-node type="decision-item"><ac:adf-attribute key="local-id">di-onb</ac:adf-attribute><ac:adf-attribute key="state">DECIDED</ac:adf-attribute><ac:adf-content>Archive the old onboarding emails after the March send (DREC-8)</ac:adf-content></ac:adf-node></ac:adf-node><ac:adf-fallback><ul class="decision-list"><li>Archive the old onboarding emails after the March send (DREC-8)</li></ul></ac:adf-fallback></ac:adf-extension>',
      '<p><ac:placeholder>Summarize the outcome.</ac:placeholder></p>',
    ].join(''),
  },
  webhookSync: {
    title: 'Integrations sync, 12 November',
    body: [
      '<h2>DREC-9 legacy webhook signatures</h2>',
      '<p>Status: <ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="title">DEFERRED</ac:parameter><ac:parameter ac:name="colour">Yellow</ac:parameter></ac:structured-macro></p>',
      '<p>Two partners still verify the old signature format.</p>',
      '<h2>DREC-11 partner rate limits</h2>',
      '<p>Status: <ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="title">APPROVED</ac:parameter><ac:parameter ac:name="colour">Green</ac:parameter></ac:structured-macro></p>',
    ].join(''),
  },
  searchLog: {
    title: 'Platform decision log',
    body: [
      '<table data-layout="default"><tbody>',
      '<tr><th><p>Issue</p></th><th><p>Decision</p></th><th><p>Status</p></th></tr>',
      '<tr><td><p>DREC-10</p></td><td><p>Upgrade the search cluster to version 9</p></td><td><p><ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="title">APPROVED</ac:parameter><ac:parameter ac:name="colour">Green</ac:parameter></ac:structured-macro></p></td></tr>',
      '<tr><td><p>DREC-12</p></td><td><p>Move build agents to arm64</p></td><td><p><ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="title">REJECTED</ac:parameter><ac:parameter ac:name="colour">Red</ac:parameter></ac:structured-macro></p></td></tr>',
      '</tbody></table>',
      '<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body><span class="placeholder-inline-tasks">Approve DREC-10 upgrade window</span></ac:task-body></ac:task></ac:task-list>',
      '<p><del>DREC-10 rejected by ops.</del></p>',
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
 * verdict the panel should show the fixture owner, and `pageVerdicts` the verdict for
 * each readable page. `expectedForOthers` is the overall verdict for a user who cannot
 * read the restricted page, where that differs.
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
  {
    summary: 'Move audit logs to cold storage after 90 days',
    description: 'Fixture: one open page supports the task; a second page, restricted to its owner, conflicts.',
    links: ['auditDecision', 'auditRestricted'],
    expected: 'conflict',
    expectedForOthers: 'incomplete',
    pageVerdicts: { auditDecision: 'supports', auditRestricted: 'conflicts' },
  },
  {
    summary: 'Turn on single sign-on for the admin console',
    description: 'Fixture: the linked page supports the task until scripts/edit-page.mjs edits it.',
    links: ['ssoDecision'],
    expected: 'all-support',
    expectedAfterEdit: 'conflict',
    pageVerdicts: { ssoDecision: 'supports' },
  },
  {
    summary: 'Archive the old onboarding emails',
    description: 'Fixture: a DACI-style page with a DECIDED status lozenge and a native decision item.',
    links: ['onboardingDecision'],
    expected: 'all-support',
    pageVerdicts: { onboardingDecision: 'supports' },
  },
  {
    summary: 'Turn off the legacy webhook signatures',
    description: 'Fixture: meeting notes with one status per issue section; this issue is deferred, another is approved.',
    links: ['webhookSync'],
    expected: 'conflict',
    pageVerdicts: { webhookSync: 'conflicts' },
  },
  {
    summary: 'Upgrade the search cluster to version 9',
    description: 'Fixture: a decision log table row with an APPROVED lozenge, a done approval task and a struck-out note.',
    links: ['searchLog'],
    expected: 'all-support',
    pageVerdicts: { searchLog: 'supports' },
  },
];
