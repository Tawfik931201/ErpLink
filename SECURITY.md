# Security policy

ERP Link connects systems that may contain financial and personal data. Please report vulnerabilities responsibly.

## Supported versions

The project does not yet publish a formal supported-version matrix or a stable public release. Security reports against the current main branch are welcome. This policy is not a guarantee of support or a response-time SLA.

## Reporting a vulnerability

Use the repository's [Security Advisories page](https://github.com/Tawfik931201/ErpLink/security/advisories) and choose **Report a vulnerability** if private reporting is enabled.

If the private reporting option is not available, contact the repository owner via an available private contact channel. You may open a public issue requesting a private reporting channel, but do not include vulnerability details, credentials, customer records or exploit instructions in that issue.

Include the affected commit or version, a concise description, impact, and safe reproduction steps using a test environment. Redact any sensitive information.

Do not test against production deployments, third-party stores, other tenants or real ERP databases without explicit authorization. Avoid accessing or modifying data that is not yours. Coordinate public disclosure with maintainers.

## Areas of particular concern

- Authentication, authorization, tenant isolation and cross-workspace routing.
- Webhook verification, replay protection, idempotency and queue settlement.
- Secret storage, token rotation and accidental credential disclosure.
- Financial data integrity and unintended external writes.

If you discover a leaked credential, notify the owner privately so it can be revoked and rotated. Deleting it from the latest commit alone does not remove it from Git history.
