# Ledgerly release readiness and security gates

## Included in the current draft branch

- Local workspace storage in IndexedDB encrypted with AES-GCM-256; the vault key is derived from a user passphrase with PBKDF2-SHA-256. The passphrase is not stored by Ledgerly.
- Evidence attachments are encrypted before being stored locally. The data-only JSON export does not contain the attachment blobs.
- Selected JOD values are serialized as integer fils in the encrypted vault payload; UI/runtime values remain in JOD with three decimal places.
- A local SHA-256 linked event sequence provides tamper evidence within the retained local log. It is not a server-authoritative or immutable audit log and cannot reveal an entire log deletion without an external trusted anchor.
- Workpaper local approval transitions require a separately named reviewer and prevent the preparer from approving their own workpaper. In local mode, this name is not a verified identity.
- Journal screening and Benford descriptive analysis, reproducible random/systematic/MUS sample selection, evidence-to-workpaper lineage, manual account-to-statement mapping, bilingual draft Word outputs, print-to-PDF, office time/fee ledger, bank header mapping profiles, confirmation tracker, local fieldwork notes/photos/signature, PBC request checklist with click-through WhatsApp links, UBL XML local parser, PWA shell and archive UI lock.
- Member invitation UI is disabled by default; server-side invitation feature gate remains independently required.

## Release blockers — do not use live client files before these pass

1. **End-to-end cloud encryption and key management.** Cloud workspace snapshot push/restore is deliberately hidden in the UI. A secure firm key distribution and recovery design must be implemented and independently tested before enabling cloud sync.
2. **Live multi-firm isolation testing.** Use real staging accounts for two separate firms, verify every REST/RPC/Storage/Edge Function path and prove negative cross-firm tests. Migration replay tests alone are not enough.
3. **Backup and disaster recovery.** Perform documented backup/restore drills, key-loss/recovery checks, retention/deletion tests and version compatibility tests.
4. **Malware scanning and upload safety.** The draft has local file limits and XML entity/DOCTYPE rejection. It does not include a server-side malware scanning pipeline or a client upload portal. Do not accept client uploads from external parties until this gate is implemented.
5. **Immutable audit trail.** The local hash chain is tamper-evident only. Production requires a trusted server-side append-only log, user identity from verified auth claims, trusted timestamps, access controls and externally anchored integrity checks.
6. **Independent review.** Perform a professional accounting-methodology review, privacy/legal retention review and independent penetration test before commercial use.
7. **Financial statements and auditor report.** Current Word/PDF outputs are drafts and rely on manual mappings. They are not complete IFRS financial statements, a regulator-approved Jordanian form, or a release-ready ISA 700 report. A partner must complete disclosure requirements, wording, basis for opinion, signatures and the applicable current standards.
8. **Jordan e-invoicing (JoFotara).** The current XML reader only parses selected UBL fields locally. It does not authenticate to, submit to, or validate acceptance from the national system. Any integration must be verified against current official technical documentation and credentials/permissions before implementation.
9. **Mobile fieldwork.** PWA local capture exists as a draft. Geolocation is requested only after a user action; field signatures are drawings and are not legally authenticated signatures. Encrypted multi-device sync is not enabled.
10. **Office onboarding and invitations.** Keep member invitations disabled until role-based authorization and cross-firm isolation tests pass in live staging.

## Interpretation of screening results

Journal tests, duplicate indicators, rounded-amount flags, weekend/out-of-hours flags, Benford distributions, and sample selections are investigative aids. They are not evidence of fraud or error by themselves. The auditor determines population completeness, risk, sample design, materiality, evidence sufficiency and conclusions.

## Test status

The CI pipeline should run unit tests, TypeScript/production build, and disposable-PostgreSQL migration/firm-isolation tests on each PR change. The current latest code must pass that run before producing a new Windows installer. A prior installer artifact does not contain these latest changes.
