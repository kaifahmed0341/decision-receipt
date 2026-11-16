/**
 * The Decision receipt issue panel, built with UI Kit.
 *
 * It asks the resolver for a receipt and renders it. The frontend does no checking of
 * its own; every verdict and every word of evidence comes from the resolver.
 */
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Link,
  List,
  ListItem,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const pageBox = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'border.radius',
  padding: 'space.150',
});

const quoteBox = xcss({
  borderLeftColor: 'color.border.bold',
  borderLeftStyle: 'solid',
  borderLeftWidth: 'border.width.selected',
  paddingLeft: 'space.150',
});

const KIND_APPEARANCE = { conflict: 'removed', support: 'success', mention: 'default' };

/** One excerpt, quoted exactly, with the reason it was picked. */
const Excerpt = ({ excerpt }) => (
  <Box xcss={quoteBox}>
    <Stack space="space.050">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={KIND_APPEARANCE[excerpt.kind]} maxWidth={280}>{excerpt.kindLabel}</Lozenge>
        {excerpt.truncated ? <Text size="small">Cut at 400 characters</Text> : null}
      </Inline>
      <Text>"{excerpt.text}"</Text>
      <Text size="small">{excerpt.why}</Text>
    </Stack>
  </Box>
);

/** The evidence block for one linked page. */
const PageEvidence = ({ page, index }) => {
  if (page.status !== 'ok') {
    return (
      <Box xcss={pageBox}>
        <Stack space="space.100">
          <Inline space="space.100" alignBlock="center">
            <Text>Linked page {index + 1}</Text>
            <Lozenge appearance={page.verdictAppearance}>{page.verdictLabel}</Lozenge>
          </Inline>
          <Text>{page.message}</Text>
          <Text size="small">{page.provenance}</Text>
        </Stack>
      </Box>
    );
  }
  return (
    <Box xcss={pageBox}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Link href={page.url} openNewTab>
            {page.title}
          </Link>
          <Lozenge appearance={page.verdictAppearance} isBold maxWidth={280}>
            {page.verdictLabel}
          </Lozenge>
        </Inline>
        <Text size="small">{page.provenance}</Text>
        {page.emptyNote ? <Text>{page.emptyNote}</Text> : null}
        {page.excerpts.map((excerpt, i) => (
          <Excerpt key={i} excerpt={excerpt} />
        ))}
        {page.hiddenExcerpts ? (
          <Text size="small">{page.hiddenExcerpts} more matching sentences are on the page.</Text>
        ) : null}
      </Stack>
    </Box>
  );
};

/** Whether this reviewer's recorded check still matches the pages, and the record button. */
const RecordBanner = ({ record, onRecord, recording, note, canRecord }) => (
  <Box xcss={pageBox}>
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center" spread="space-between">
        <Lozenge appearance={record.appearance} isBold maxWidth={360}>
          {record.label}
        </Lozenge>
        {canRecord ? (
          <LoadingButton appearance="primary" isLoading={recording} onClick={onRecord}>
            {record.state === 'stale' ? 'Record a fresh check' : 'Record this check'}
          </LoadingButton>
        ) : null}
      </Inline>
      <Text>{record.detail}</Text>
      {record.changes.length ? (
        <List type="unordered">
          {record.changes.map((change, i) => (
            <ListItem key={i}>{change}</ListItem>
          ))}
        </List>
      ) : null}
      {note ? <Text>{note}</Text> : null}
      <Text size="small">
        A recorded check keeps page versions and results for you only. It holds no page text.
      </Text>
    </Stack>
  </Box>
);

const App = () => {
  const [state, setState] = useState({ loading: true });
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState(null);

  const interrupted = {
    ok: false,
    message:
      'The check was interrupted before it finished, for example by a timeout or a lost connection. Nothing was recorded. Select Check again.',
  };

  const check = useCallback(() => {
    setState({ loading: true });
    setNote(null);
    invoke('getReceipt')
      .then((result) => setState({ loading: false, result }))
      .catch(() => setState({ loading: false, result: interrupted }));
  }, []);

  const record = useCallback(() => {
    if (!state.result?.ok) return;
    setRecording(true);
    invoke('recordCheck', { fingerprintHash: state.result.fingerprintHash })
      .then((result) => {
        setState({ loading: false, result });
        setNote(result.ok && !result.recorded ? result.message : null);
      })
      .catch(() => setNote('Recording was interrupted, so nothing was recorded. Select Record this check again.'))
      .finally(() => setRecording(false));
  }, [state]);

  useEffect(() => {
    check();
  }, [check]);

  if (state.loading) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" label="Checking linked decision pages" />
        <Text>Reading the linked decision pages as you...</Text>
      </Inline>
    );
  }

  const { result } = state;
  if (!result.ok) {
    return (
      <Stack space="space.150">
        <SectionMessage appearance="warning" title="Decision receipt could not run">
          <Text>{result.message}</Text>
        </SectionMessage>
        <Button onClick={check}>Check again</Button>
      </Stack>
    );
  }

  const { receipt, record: recordState } = result;
  return (
    <Stack space="space.200">
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" spread="space-between">
          <Inline space="space.100" alignBlock="center">
            <Heading size="small">{receipt.issue.key}</Heading>
            <Lozenge appearance={receipt.overallAppearance} isBold maxWidth={360}>
              {receipt.overallLabel}
            </Lozenge>
          </Inline>
          <Button appearance="subtle" onClick={check}>
            Check again
          </Button>
        </Inline>
        <Text>{receipt.overallDetail}</Text>
        <Text size="small">
          Checked {receipt.pages.length} linked {receipt.pages.length === 1 ? 'page' : 'pages'} with your permissions
          at {receipt.checkedAtLabel}. Nothing in Jira or Confluence is changed.
        </Text>
      </Stack>
      <RecordBanner record={recordState} onRecord={record} recording={recording} note={note} canRecord={result.canRecord !== false} />
      {receipt.notes.map((linkNote, i) => (
        <SectionMessage key={i} appearance="information">
          <Text>{linkNote}</Text>
        </SectionMessage>
      ))}
      {receipt.pages.map((page, i) => (
        <PageEvidence key={i} page={page} index={i} />
      ))}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
