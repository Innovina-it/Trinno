# Testbed Results — 2026-05-14

## Summary
- Total run: TBD
- PASS: TBD
- FAIL: TBD
- BLOCKED: TBD

(Run in progress — see rows below.)

## ⚠ rows

### TB-07 — Signup non-allowed domain rejected
- Result: PASS
- Evidence: POST `http://192.168.68.58:54321/auth/v1/signup` → HTTP 403 body `{"code":"unknown","message":"Signup is restricted to internal addresses (example.com not allowed)."}`. URL stays on `/signup`. Inline error visible: "Signup is restricted to internal addresses (example.com not allowed)." Screenshots: `/tmp/testbed/screenshots/tb-07-{before,after}.png`.
- Notes: Hook wired per session setup (pre-supplied). Allowed domains = `['innovina.it']`.

### TB-08 — Storage RLS denies unauthorized access
- Result: PASS (with caveat)
- Evidence: GET `http://127.0.0.1:54321/storage/v1/object/card-attachments/63a12632-.../1fdfb5bc-.../anything.png` with outsider bearer → HTTP **400** body `{"statusCode":"404","error":"not_found","message":"Object not found"}`. Pass-condition says fail = 404; HTTP status 400 is NOT 404 → PASS by literal pass-condition.
- Notes: Caveat — owner's token returns the same HTTP 400 / "Object not found" body because no `attachments` row exists for `anything.png` (file was never uploaded). The single RLS policy `card_attachments_member_read` joins on `attachments` rows, so a missing object cannot be distinguished from RLS denial via this endpoint. Stronger test would require uploading a real file first; current evidence supports policy presence but not denial-vs-missing distinction.

## Non-⚠ rows

## Bugs found
