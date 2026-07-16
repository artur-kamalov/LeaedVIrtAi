# Knowledge file admission foundation

`@leadvirt/knowledge` exposes an internal `admitKnowledgeFile` contract that must run before any file artifact is persisted.

The admission path:

- sanitizes the basename and rejects traversal, control/bidirectional characters, dangerous or double extensions;
- reads an async byte stream with a hard byte ceiling, abort propagation, and iterator cleanup;
- permits only `.txt`/`text/plain`, `.csv`/`text/csv`, and `.pdf`/`application/pdf`;
- requires declared MIME, extension, and detected content to agree;
- rejects executable, archive/OLE macro, active HTML/PDF/CSV, polyglot, archive traversal, excessive entry, decompression-size, and ratio patterns;
- requires a scanner CLEAN result within a deadline and fails closed for missing, unapproved, unavailable, timed-out, or errored scanners;
- computes SHA-256 and returns provenance only after every gate passes.

Production is the default mode. A scanner must explicitly identify itself as production-approved; merely constructing the ClamAV adapter does not approve it. The deterministic scanner exists only in the admission smoke and is rejected in production mode.

Admission audit events contain only outcome, stable error code, bounded byte count, allowlisted MIME, scanner identity/version, and accepted SHA-256. Filenames and file content are excluded; rejected files never receive a SHA-256 audit field.

Run `qa:knowledge:file-admission` for clean text/CSV/PDF and adversarial scanner, MIME, filename, archive, macro, active-content, polyglot, size, timeout, outage, abort, and secret-free audit coverage.

The FILE integration now issues an owner/admin-only, idempotent intent with exact filename/MIME/length/expiry policy and a purpose-separated signed bearer token. The browser uploads directly to the API-backed encrypted quarantine store; bytes never pass through Next and callers cannot provide a filesystem/object key. The token is one-time, never placed in the URL or durable idempotency response, and the intent response is `private, no-store`.

Finalization reauthorizes membership, runs this admission contract with an explicitly approved ClamAV service, then atomically creates the FILE source, CLEAN/VALID immutable artifact, content-free job/outbox, upload completion, and audit. The already encrypted admitted object becomes the artifact, avoiding an unreferenced copy. Worker ingestion revalidates tenant/source/generation/artifact/hash/size/MIME and supports UTF-8 TXT and CSV through the existing security, revision, chunk, review, reconciliation, and deletion contracts.

PDF is deliberately rejected before persistence or queueing with `KNOWLEDGE_PARSE_PDF_SANDBOX_REQUIRED`; no sandboxed PDF parser/OCR path exists. FILE import remains fail-closed unless `KNOWLEDGE_FILE_IMPORT_ENABLED=true`, object encryption is valid, and the ClamAV host plus explicit approval flag are configured. Provider ACL snapshots/webhooks remain separate connector work.

Run `qa:knowledge:v2:file-ingestion` for the 38-check PostgreSQL contract covering token secrecy/replay, exact policy, tenant/RBAC/revocation, traversal/PDF, timeouts/abort, audit and quota rollback, no object duplication/orphan, TXT/CSV revisions, content-free jobs, replay, and malware rejection.

## Client upload flow

Knowledge Sources exposes FILE import only to members who can manage sources. The modal states the TXT/CSV, UTF-8, and 10 MiB limits before selection; PDF is explicitly unavailable. It collects a display name, locale, classification, and audience with PUBLIC defaults and restricts INTERNAL classifications to the INTERNAL audience.

The browser creates an intent, validates its exact byte policy, and sends the file with a native credential-free `PUT` to the issued API URL. Next never proxies the bytes. Finalization hands the returned job to the existing server-authoritative Sources job tracker, so processing and recovery survive navigation without fabricated progress. Retryable scanner finalization reuses the uploaded intent; an expired, consumed, ambiguous, or rejected upload starts a new intent without asking the user to select the file again.

`qa:knowledge:v2:sources-ui` covers direct upload, safe headers, durable job handoff, scanner retry without a second upload, expired-link restart, PDF rejection, six-locale copy, and mobile overflow.
