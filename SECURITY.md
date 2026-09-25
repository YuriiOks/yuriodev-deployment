# Security policy

## Reporting a vulnerability

Please report security problems privately by email to
**yurii.oksamytnyi@yuriodev.co.uk**. If this repository shows a "Report a
vulnerability" button under its Security tab, that private channel works too.
Please do not open a public issue or pull request for a security problem.

A useful report says what is affected (URL, file or workflow), how to
reproduce it, and what an attacker could do with it. I aim to acknowledge a
report within 7 days and to tell you what I will do about it once I have
looked into it.

## Scope

In scope:

- the live site, `https://yuriodev.co.uk`, and its public API under `/api/`;
- this repository: application code, container images, the nginx proxy
  configuration, the deploy scripts and the GitHub Actions workflows.

Out of scope:

- `dev.yuriodev.co.uk` and `stage.yuriodev.co.uk` beyond their access control
  (they are password-protected previews of the same code);
- third-party services the site relies on (Cloudflare, GitHub, social
  platforms): please report those to the vendor;
- denial-of-service or load testing, social engineering, and automated scanner
  output without a demonstrated impact.

Please test only against your own requests, do not access or change data that
is not yours, and stop and report as soon as you find something.

## No bounty

This is a personal site: there is no bug bounty and no payment for reports.
With your permission, I am happy to credit you once the issue is fixed.
