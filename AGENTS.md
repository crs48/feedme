# Working on Feedme

- Prefer functional, declarative TypeScript. Keep protocol adapters separate from domain logic.
- Use pnpm. Render with Astro and ordinary forms; add browser JavaScript only when it improves an interaction.
- Never write private support records into a public repository. Public records must use explicit allowlists.
- Never treat a Checkout redirect as proof of payment.
- Add Mermaid diagrams to architecture documents when useful. Check off plan items only after verification.
- Commit frequently with conventional commit titles and detailed bulleted descriptions.
- Before shipping: `pnpm check`, `pnpm test`, `pnpm build`.
- When helping an operator install/configure their own instance, follow [the agent setup runbook](docs/agent-setup.md). Keep setup progress local and secret-free; verify each provider connection before marking it complete.
