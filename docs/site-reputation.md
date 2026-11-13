# Google Safe Browsing diagnostics for cliamp-web

A Chrome red **Dangerous site** interstitial is browser-side: the PWA cannot
observe it, because the warning appears before the app's JavaScript executes.
The screenshot alone does not reveal Google's exact threat category.

## Establish a measurable baseline

1. In [Google Search Console](https://search.google.com/search-console),
   verify the URL-prefix property `https://keylimesoda.github.io/cliamp-web/`
   and inspect **Security & Manual Actions → Security issues**. Save the exact
   issue type, example URLs, and first-detected date if any. An empty report
   does not rule out every algorithmic Safe Browsing classification.
2. Check [Google's public site-status tool](https://transparencyreport.google.com/safe-browsing/search?url=https%3A%2F%2Fkeylimesoda.github.io%2Fcliamp-web%2F).
3. For a machine-readable independent check, enable **Safe Browsing API** in
   a Google Cloud project and create an API key. Under the repository's
   **Settings → Secrets and variables → Actions**, create the
   `SAFE_BROWSING_API_KEY` secret. Do **not** add the key to the PWA or Git.
4. Run **Actions → Google Safe Browsing reputation → Run workflow**. The job
   checks the page URL, `index.html`, and the account root using Google's v5
   `urls:search` method. It logs a timestamp and threat types in its run
   summary; a threat match fails the job. It also runs daily on the default
   branch. An unavailable lookup is a separate failure, **not** a clean result.
5. Save a screenshot from an affected Chrome profile with **Details** expanded,
   the exact URL, date/time, Chrome version, and whether Standard or Enhanced
   Protection is enabled. Compare with a fresh Chrome profile.

## Interpreting results

- **Threat returned:** Google's API lists a matching host/path expression.
  Inspect the threat type and any Search Console examples before changing code.
- **No threats returned:** the queried URLs had no v5 matches at that moment.
  This is not a guarantee of a clean Chrome navigation. Chrome can use other
  real-time or client-specific signals, and reputation changes propagate
  asynchronously.
- **API error:** no result was obtained. Fix permissions, quota, or the key.
- **Host-root match:** investigate other projects on the same GitHub Pages
  hostname before attributing the classification to cliamp-web.
- **Only some users affected:** compare exact URL, Chrome release,
  protection mode, browser profile/cache, and the time of the lookup.

## Remediation workflow

Capture a baseline **before** deploying any mitigation. Make one category of
changes at a time, with a commit/deployment timestamp, then rerun the v5 lookup.
If Google reports a Security issue, address that reported issue and request a
review through Search Console. If the site is clean but falsely classified as
phishing, use [Google's incorrect phishing report](https://www.google.com/safebrowsing/report_error/).
Allow for reputation-list and Chrome-client propagation delays. Do not use
Chrome's "Proceed anyway" as a validation strategy.

References:
- [Safe Browsing v5 urls.search](https://developers.google.com/safe-browsing/reference/rest/v5/urls/search)
- [Google: why a site is labeled dangerous](https://support.google.com/webmasters/answer/6347750)
- [Search Console Security issues](https://support.google.com/webmasters/answer/9044101)
