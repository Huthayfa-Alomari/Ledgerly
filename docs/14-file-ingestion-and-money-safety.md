# File ingestion, JOD precision and local recovery safeguards

Checked on 2026-10-21. This document describes the current implementation branch; CI must pass before merge.

## Untrusted file ingestion

All supported financial files are parsed client-side. The UI validates extensions and applies a 50 MiB file limit before parsing. Workbook parsing limits row expansion to 250,000 data rows, 256 columns and 2,000,000 cells; worksheets are checked against their declared range before being materialized as arrays. Formula extraction, cell HTML and style parsing are disabled for the import path.

PDF reconciliation imports are bounded to 500 pages, 100,000 text items per page and 500,000 text items across the document. OCR is limited to 100 pages, 16 million rendered pixels per page and 100 million pixels for the full OCR job. OCR canvases are released after each page. These are resource-safety controls, not proof that every malformed PDF, workbook or CSV is safe; keep parsers updated and test representative files after upgrades.

## Jordanian dinar precision

The helper `src/lib/jod-money.mjs` represents amounts as integer fils at calculation boundaries (1 JOD = 1,000 fils), rejects values outside JavaScript's safe integer-fils range, and formats amounts to three decimal places. Trial-balance totals, differences, and the default equality tolerance now use fils arithmetic; the default tolerance is 0.001 JOD. The bank-to-ledger matcher already compares amounts in fils.

**Scope limitation:** this does not yet migrate every persisted local object or every money field to integer-fils storage. Some existing fields are still stored as JavaScript numbers or strings. Do not describe this as a complete integer-money data-model migration. A future versioned data migration should convert money fields and test compatibility with old JSON backups before persistent schema changes.

## Local data recovery

The local database loader distinguishes empty storage from invalid JSON and malformed top-level collection shapes. If loading fails, local persistence is disabled so the startup fallback cannot overwrite the original value with an empty database. The recovery screen lets the user download the raw local value, restore a validated JSON backup, or explicitly reinitialize only after requesting the raw export.

A raw export preserves bytes/text but does not repair or decrypt corrupted data. A browser download action cannot guarantee the user successfully saved the file, so the screen asks for explicit confirmation before reinitialization. LocalStorage is not encrypted at application level and must not hold unprotected sensitive client audit data on shared or unmanaged devices.

## Tests and remaining release checks

- Unit tests cover fils conversion, three-decimal formatting, tolerance boundaries, file-size and worksheet dimensions, PDF/OCR limits, and local-storage corruption handling.
- CI additionally runs the full migration replay and authorization tests against disposable PostgreSQL.
- Before using real client evidence, complete an end-to-end storage/isolation test with two real test accounts and separate firms. The production Supabase project currently has no firms or app users, so real-account cross-firm isolation has not yet been exercised.
