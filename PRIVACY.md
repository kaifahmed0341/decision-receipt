# Privacy policy

Decision receipt is a Forge app for Jira and Confluence. This policy says what it reads, what it keeps and where.

## What it reads

When someone opens the Decision receipt panel on a Jira issue, or asks the Decision receipt agent in Rovo, the app reads, with that person's own Atlassian permissions:

- the issue's key, summary and change history (to find earlier keys);
- the issue's remote links;
- the Confluence pages those links point to on the same site.

It reads nothing a person could not open themselves. Pages they cannot open are not shown in any form.

## What it keeps

Only when a person selects **Record this check**, the app stores one record for that person and that issue in Forge storage, which Atlassian hosts for the app. The record holds:

- the site's cloud id, the issue id and the person's Atlassian account id, as the record's key;
- for each linked page: its page id, whether it could be read, its version number and the result the rules gave;
- a short hash of the issue summary, the rules version, counts of links that could not be read, the time recorded and the overall result.

It holds no page text, no page titles, no issue text and no names. Records are never shown to anyone except the person who made them.

## Where data goes

Nowhere outside Atlassian. The app runs on Atlassian's Forge platform, declares no outside network access and calls no outside service or model. Rovo, when used, runs on the customer's own Atlassian site under Atlassian's terms.

## How long, and deletion

Records stay until the app is uninstalled from the site, when Forge storage for the installation is removed. To have a record removed earlier, open an issue at https://github.com/kaifahmed0341/decision-receipt/issues.

## Contact

https://github.com/kaifahmed0341/decision-receipt/issues
