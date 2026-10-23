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


## Additional controls in the current development branch

- Trial-balance trust checks distinguish blank or unmapped fields from verified zeroes, test opening, movement and closing totals, verify per-account roll-forward, expose source row numbers, and compare imported row counts/control totals when supplied. JOD comparisons use three decimal places.
- Journal screening flags unparseable numeric cells, counterparty/reference conflicts, reversal wording, and possible below-limit transaction groupings only when an auditor explicitly provides the approval threshold and time window. These are investigation signals, not fraud determinations.
- Evidence lineage refuses to choose arbitrarily when multiple workpapers share a normalized reference. Quality Shield reports duplicate references, missing source snapshots and stale source snapshots.
- Workpaper source fingerprints are local change-detection aids, not cryptographic seals. A snapshot is refreshed only on the existing explicit reviewer approval transition; local reviewer names do not verify identity.


## Ledgerly differentiators added in this branch

- **Data Trust Gate:** three-decimal JOD checks, opening/movement/closing checks when those columns are present, per-account roll-forward checks, missing/unparseable numeric cell alerts, duplicate row/account alerts, source row references, and explicit disclosure when the source format omits a field. Missing source columns are not silently interpreted as zero.
- **Account classification:** the Quality Shield and close gate inspect account mappings used for financial statement drafts. Unclassified accounts are shown as a review item and block administrative closure by default. An office policy can explicitly waive that administrative block; the waiver is not a conclusion that the accounting presentation is appropriate.
- **Journal full-population screening:** users choose the worksheet in a multi-sheet workbook; the selected worksheet is screened locally up to the documented size limits. Rules include invalid numeric values, duplicate-like rows, month-end timing, large relative amounts, reversal wording, counterparty/reference inconsistencies and optional below-approval-limit transaction grouping. The split check runs only when a reviewer enters the office's actual threshold and time window.
- **Evidence lineage:** workpaper references must be unique for automatic linking. Findings can be linked to a workpaper and one or more evidence records; the system flags missing references and evidence/workpaper mismatches rather than selecting a candidate silently.
- **Quality Shield and close gate:** administrative readiness checks flag open review notes, unapproved workpapers, missing/ambiguous evidence links, unclassified accounts, stale workpaper source snapshots and missing/stale report exports. The partner dashboard surfaces close blockers alongside overdue document requests, recorded hours versus planned hours, internal labor cost and invoice values.
- **Report freshness:** exported financial-statement and auditor-report drafts record source-balance, account-mapping and report-configuration fingerprints. Changes to trial-balance values or manual account mappings can mark the prior export stale. The fingerprints are deterministic change indicators, not cryptographic signatures; draft outputs still require professional review.
- **Source-grounded assistant:** references returned from the minimized AI summary are matched to the provided issue IDs and can display the corresponding account code/source row when that information is available. The assistant does not read the original workbook or evidence files, and must not invent file names or page references.
- **Client-document requests:** the internal PBC list can mark a request as required for closure, tracks due/overdue status, exports the required flag, and generates editable rule-based suggestions from open risk areas (e.g., bank, revenue, inventory, receivables, payables, payroll and fixed assets). Suggested requests keep a reference to their source risk and are not automatically marked mandatory. There is **no external client upload portal** in this branch; cloud sync and third-party upload remain disabled until the separate security gates above are implemented and tested.

These controls help organize and prioritize work. They do not establish that evidence is sufficient, that fraud occurred, that statements comply with IFRS, or that a report is compliant with all applicable ISA or Jordanian legal requirements.
