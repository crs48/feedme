# Connect crs.tips to Feedme

The Feedme server is already deployed on Railway. These DNS records route `crs.tips` to it; `crs.land` stays on its existing LibCard host.

## 1. Open Vercel DNS

Open [Vercel](https://vercel.com/), select the account that owns the domain, then **Domains → crs.tips → DNS Records** (under the domain’s advanced settings).

Keep the existing Vercel nameservers. You do not need a new Vercel project.

## 2. Add these two records

| Type | Name | Value |
| --- | --- | --- |
| **ALIAS** | Root / blank | `p8vce8v6.up.railway.app` |
| **TXT** | `_railway-verify` | `railway-verify=aff4bbf256681592d1664af1f249b20caa330bdc8ca31884957789c69abd0382` |

For the ALIAS, leave **Name** blank to mean `crs.tips` itself; if the form represents the root as `@`, use that. Set TTL to the default. Do not include `https://` in either value.

**Vercel uses ALIAS for the root domain.** Railway labels the destination “CNAME,” but Vercel’s equivalent at the root is ALIAS. See [Vercel’s record types](https://vercel.com/docs/domains/working-with-dns).

Replace conflicting custom **root** A/AAAA/ALIAS records. Vercel’s built-in defaults may be read-only; a custom root record overrides them. Preserve email/MX, other TXT, and subdomain records. [Vercel DNS instructions](https://vercel.com/docs/domains/managing-dns-records).

## 3. Check it

Open the [Railway service](https://railway.com/project/20a3c02a-2960-458b-9e67-187bef03bd43/service/5b273103-7f29-45aa-a5e5-6a97a0ba3860?environmentId=da0ff641-b2cf-4ee4-af5e-a41777b80e44), then **Settings → Networking → crs.tips**. Wait for DNS verification and an active HTTPS certificate.

Then open:

- [crs.tips](https://crs.tips/) — your real LibCard catalog.
- [Health check](https://crs.tips/api/health) — JSON containing `"ok": true`.

DNS caches can delay the change. A successful TXT check alone does not mean the root record is correct. If Railway still says the target needs updating, check that the ALIAS is on the root, not `www` or a literal subdomain named `@`.

From the Feedme repository, the final integration check is:

```sh
pnpm check:libcard-origin https://crs.tips
```

This completes routing. Stripe onboarding, private Habitat storage, and LibCard tip opt-ins are separate setup steps; see [the deployment notes](crs-tips.md).
