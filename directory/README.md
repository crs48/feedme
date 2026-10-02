# Public directory policy

Instances normally join through their public `fund.feedme.profile/self` record. No repository change is needed. If a relay has not found your repository, a pull request can add your **DID** to `policy.json` → `seeds`. All seeds pass the same PDS, discovery preference, website identity, and public moderation checks; an entry is not approval or proof of ownership.

`suppressed` contains DIDs excluded from the official directory for impersonation, malicious links, spam, or other abuse. Maintainers review changes. [Report a directory issue](https://github.com/crs48/feedme/issues/new) with public information only; never include donor details, credentials, or private messages. Operator suppression does not edit creator records or control other directories.

Do not add names, site URLs, tips, donor identities, or arbitrary crawling targets to this file. Generated observations live in short-retention workflow artifacts and the current public directory export, not Git history. Opting out removes a profile on a subsequent successful scan; public copies already downloaded by others cannot be recalled.
