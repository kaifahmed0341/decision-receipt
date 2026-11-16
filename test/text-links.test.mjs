import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, decodeEntities, adfToText } from '../src/lib/text.js';
import { pageIdFromGlobalId, pageIdFromUrl, confluencePagesFromLinks, linkTarget } from '../src/lib/links.js';

test('entities decode', () => {
  assert.equal(decodeEntities('&#39;&#x41;&unknown;&amp;'), "'A&unknown;&");
});

test('sentences split on end punctuation but keep lines and abbreviations whole', () => {
  assert.deepEqual(splitSentences('First one. Second one! Third?\nHeading line'), [
    'First one.',
    'Second one!',
    'Third?',
    'Heading line',
  ]);
  assert.deepEqual(splitSentences('Use e.g. The v2 API. Then stop.'), ['Use e.g. The v2 API.', 'Then stop.']);
  assert.deepEqual(splitSentences('Decision: go. Raise the limit.'), ['Decision: go. Raise the limit.']);
});

test('ADF text extraction keeps paragraphs apart', () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] };
  assert.equal(adfToText(adf), 'One\nTwo');
});

test('page ids come from globalId or the common URL shapes', () => {
  assert.equal(pageIdFromGlobalId('appId=abc-123&pageId=98765'), '98765');
  assert.equal(pageIdFromGlobalId('system=http://x&id=1'), null);
  assert.equal(pageIdFromUrl('https://s.atlassian.net/wiki/spaces/DR/pages/123/Some+Title'), '123');
  assert.equal(pageIdFromUrl('https://s.atlassian.net/wiki/pages/viewpage.action?pageId=456'), '456');
  assert.equal(pageIdFromUrl('https://s.atlassian.net/wiki/x/AbCd'), null);
});

test('links to other sites, unreadable links and duplicates are not fetched', () => {
  const site = 'demo.atlassian.net';
  const links = [
    { id: 1, globalId: 'appId=a&pageId=10', application: { type: 'com.atlassian.confluence' }, object: { url: `https://${site}/wiki/spaces/D/pages/10` } },
    { id: 2, globalId: 'appId=a&pageId=10', application: { type: 'com.atlassian.confluence' }, object: { url: `https://${site}/wiki/spaces/D/pages/10` } },
    { id: 3, object: { url: 'https://other.atlassian.net/wiki/spaces/D/pages/11' } },
    { id: 4, object: { url: `https://${site}/wiki/x/AbCd` } },
    { id: 5, object: { url: 'https://github.com/org/repo' } },
    { id: 6, object: { url: `https://${site}/wiki/pages/viewpage.action?pageId=12` } },
  ];
  const r = confluencePagesFromLinks(links, site);
  assert.deepEqual(r.pages.map((p) => p.pageId), ['10', '12']);
  assert.equal(r.otherSite, 1);
  assert.equal(r.unreadable, 1);
  assert.equal(r.skipped, 0);
});

test('absolute links are not fetched when the site is unknown', () => {
  const r = confluencePagesFromLinks([{ object: { url: 'https://a.atlassian.net/wiki/spaces/D/pages/10' } }], null);
  assert.equal(r.pages.length, 0);
  assert.equal(r.otherSite, 1);
});

test('at most maxPages pages are checked', () => {
  const links = Array.from({ length: 4 }, (_, i) => ({ globalId: `pageId=${i + 1}`, application: { type: 'com.atlassian.confluence' }, object: { url: '/wiki/spaces/D/pages/' + (i + 1) } }));
  const r = confluencePagesFromLinks(links, 'x.atlassian.net', 3);
  assert.equal(r.pages.length, 3);
  assert.equal(r.skipped, 1);
});

test('links without a proper host, or whose ids disagree, are not trusted', () => {
  const site = 's.atlassian.net';
  assert.equal(linkTarget('//evil.example/phish', site), 'bad');
  assert.equal(linkTarget('/\\evil.example/wiki/x', site), 'bad');
  assert.equal(linkTarget('javascript:alert(1)//wiki/', site), 'bad');
  assert.equal(linkTarget('/wiki/spaces/A/pages/1', site), 'site');
  assert.equal(linkTarget('https://s.atlassian.net/wiki/x', site), 'site');
  assert.equal(linkTarget('https://evil.example.atlassian.net.example/x', site), 'other');
  const conf = { type: 'com.atlassian.confluence' };
  const r = confluencePagesFromLinks(
    [
      { application: conf, globalId: 'appId=x&pageId=100', object: { url: '//evil.example/phish' } },
      { application: conf, globalId: 'appId=x&pageId=100', object: { url: 'https://s.atlassian.net/wiki/spaces/A/pages/999/Other' } },
      { application: conf, globalId: 'appId=x&pageId=101', object: { url: 'javascript:alert(1)//wiki/' } },
      { application: conf, globalId: 'appId=x&pageId=102', object: { url: 'https://s.atlassian.net/wiki/spaces/A/pages/102' } },
    ],
    site
  );
  assert.deepEqual(r.pages.map((p) => p.pageId), ['102']);
  assert.equal(r.unreadable, 3);
  assert.equal(r.pages[0].url, undefined, 'the Jira link URL is not carried to the panel');
});
