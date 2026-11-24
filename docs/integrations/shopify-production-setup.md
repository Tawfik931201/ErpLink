# ErpLink Shopify app setup

Created on 2026-11-21 through Shopify CLI in the existing ErpLink organization.

- Organization ID: `225551401`
- App ID: `450350350337`
- Client ID: `d06554dc4b298108a0cfdd6c4336ae08` (public OAuth identifier)
- Dashboard: <https://dev.shopify.com/dashboard/225551401/apps/450350350337>
- Released on 2026-11-21: [erplink-4](https://dev.shopify.com/dashboard/225551401/apps/450350350337/versions/1260921487361)

## Configuration

Deploy the repository's `shopify.app.toml`. The production alias in this checkout targets the same client ID.
Validate the canonical file before release:

```sh
shopify app config validate --config shopify.app.toml
```

The standalone application URL is `https://erplink.bizsahla.com/api/shopify/connect`.
The signed launch resumes after ErpLink login and requests an authorization code.
The registered redirect is `https://erplink.bizsahla.com/api/shopify/callback`.
The app uses the 2026-10 webhook API, with merchant-selected sync subscriptions
registered after authorization. Older order history requires separate approval.
## Private credentials and hosting

The ignored `.env.production.local` contains the new client's credentials,
production URLs and API version. `SHOPIFY_WEBHOOK_SECRET` is the same app client
secret used to sign Shopify deliveries. No secret is in the TOML or this file.

These values were saved locally, not installed on Hostinger. Apply them to the
production process and restart/redeploy it before attempting OAuth or accepting
deliveries for this new app. Shopify CLI deploy publishes app configuration;
it does not deploy the Next.js backend. No store was installed or synchronized.

## Public distribution and customer data

Public distribution was selected at the user's request. Shopify redirects the
distribution setup to Partner App Store registration, which displayed a
one-time US$19 fee. Registration and payment were not completed.

The customer-data usage draft records the actual Store management purpose.
Protected customer fields and the nine data-protection answers were not
completed, and no public-app data review was submitted. Development setup and
an active configuration version do not establish approval for production
customer data. Complete those requirements before public merchant onboarding.

References:

- <https://shopify.dev/docs/apps/launch/protected-customer-data>
- <https://shopify.dev/docs/apps/launch/distribution/select-distribution-method>
- <https://shopify.dev/docs/apps/build/webhooks/subscribe>
