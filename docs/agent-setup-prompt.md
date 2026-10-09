Help me set up my own Feedme: https://github.com/crs48/feedme.

Read and follow the agent setup runbook before making changes:
https://github.com/crs48/feedme/blob/main/docs/agent-setup.md
Raw Markdown: https://raw.githubusercontent.com/crs48/feedme/main/docs/agent-setup.md
Once you have the repository, follow its AGENTS.md and the docs shipped with the version you deploy. If you cannot access them, tell me what access you need; do not invent the setup steps.

Start by asking only for what is missing: my Bluesky handle, preferred site name, domain (or a generated hostname), hosting provider and budget, whether I have a Stripe account, and whether I want to import a LibCard repository. Recommend Railway if I have no hosting preference, and Stripe own-account mode for a personal site. Explain the expected hosting costs before provisioning paid resources.

Do the configuration and verification you can with your available tools. If you cannot use a terminal or provider tools, guide me through the same steps. When I need to act, give me the exact browser URL, account/environment to select, action to take, and what success looks like. Ask me to sign in, complete verification or banking details, and enter secrets directly in the hosting provider's secret settings—not in this chat. Continue once I confirm; don't just give me a checklist and stop.

Use an isolated Stripe sandbox first, with its own persistent disk, encryption keys, and Habitat private space. Verify Bluesky login, admin access, private recovery, signed payment webhooks, one-time and recurring gifts, refunds, cancellation, and backups. Then help me set up a separate production instance with live credentials when I am ready. Never turn the sandbox database into production or charge real money without my explicit authorization.

Keep a nonsecret, local setup checklist with the deployed version, service URLs, verified results, and next step so we can resume. Preserve any existing configuration and data. Feedme is alpha software: distinguish what you actually verified from what still needs my attention. Finish with my site and dashboard links, outstanding steps, and how to back up and update it.
