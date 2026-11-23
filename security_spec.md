# MOVIX Firestore Security Specification (Phase 0)

## 1. Data Invariants

1. **Owner-Only Identity Isolation**: Every `/users/{userId}`, `/users/{userId}/private/{docId}`, and `/users/{userId}/favorites/{favoriteId}` document belongs exclusively to `userId == request.auth.uid`, and its internal `uid` field MUST match `request.auth.uid` and `userId`.
2. **PII Split-Collection Isolation**: Email addresses and auth provider metadata are strictly stored in `/users/{userId}/private/info` and are NEVER stored in `/users/{userId}` nor readable by any non-owner.
3. **Master Gate Relational Sync**: Every subcollection write under `/users/{userId}/private/{docId}` or `/users/{userId}/favorites/{favoriteId}` verifies parent `/users/{userId}` existence via `exists(...)` or `get(...)`.
4. **Verified Email Requirement**: All standard write operations require `request.auth.token.email_verified == true`.
5. **Strict Key Allowlisting (Anti-Shadow-Write)**: Create operations enforce exact `hasAll` + `hasOnly` key sets; update operations enforce `affectedKeys().hasOnly(...)` per named action or verified admin validation.
6. **Temporal Integrity & Immortality**: `createdAt` and `updatedAt` MUST equal `request.time` on create; `createdAt` and `uid` (or `id`/`listId`) are immutable on update, and `updatedAt` MUST equal `request.time`.
7. **Path Variable Hardening**: Every single-document path variable (`userId`, `docId`, `favoriteId`, `ticketId`, `configId`, `adId`, `listId`, `movieId`, `seriesId`, `mediaId`, `adminId`) is validated with `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
8. **Terminal State Locking**: Once a `/supportTickets/{ticketId}` document reaches `status == 'resolved'`, non-admin updates are permanently rejected.
9. **Admin-Only Global Config, Ads, Catalog & Media Persistence**: `/systemConfig/public`, `/publicAds/{adId}`, `/publicCatalogLists/{listId}`, `/publicMovies/{movieId}`, `/publicSeries/{seriesId}`, and `/publicMedia/{mediaId}` contain zero user PII and are writable exclusively by verified admins (`isAdmin()`), with strict schema key/type/size validation and `updatedBy == request.auth.uid` + `updatedAt == request.time`.
10. **Strict List Query Enforcement**: Public list queries on `/publicAds` are restricted to `resource.data.status == 'active'`; public list queries on `/publicMovies` and `/publicSeries` are restricted to `resource.data.published == true`; `/publicCatalogLists` and `/publicMedia` forbid `list` completely (`allow list: if false;`) and allow `get` only by exact valid document ID.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Target Path | Adversarial Payload / Action | Expected Result |
|---|---|---|---|---|
| 1 | Unauthenticated Read | `/users/userA` | `get()` with `auth == null` | `PERMISSION_DENIED` |
| 2 | Cross-User PII Read | `/users/userA/private/info` | `get()` as `userB` (verified) | `PERMISSION_DENIED` |
| 3 | Identity Spoofing | `/users/userA` | `create` with `{ uid: "userB", ... }` as `userA` | `PERMISSION_DENIED` |
| 4 | Unverified Email Spoof | `/users/userA` | `create` with `auth.token.email_verified == false` | `PERMISSION_DENIED` |
| 5 | Shadow / Privilege Field Injection | `/users/userA` | `create` with extra field `{ isAdmin: true, role: "admin" }` | `PERMISSION_DENIED` |
| 6 | Client-Forged Timestamp | `/users/userA` | `create` with `createdAt: Timestamp(2020-01-01)` | `PERMISSION_DENIED` |
| 7 | Path ID Poisoning (1.5KB ID) | `/users/userA/favorites/{200-char-invalid-id!@#}` | `create` with oversized/special-char document ID | `PERMISSION_DENIED` |
| 8 | Orphaned Subcollection Write | `/users/userA/favorites/movie_100` | `create` when `/users/userA` parent does not exist | `PERMISSION_DENIED` |
| 9 | Immutable Field Tampering | `/users/userA` | `update` modifying `createdAt` or `uid` | `PERMISSION_DENIED` |
| 10 | Value Poisoning (Oversized String / Invalid Enum) | `/users/userA` | `update` setting `preferredLanguage: "klingon"` or `displayName` > 80 chars | `PERMISSION_DENIED` |
| 11 | Terminal State Bypass | `/supportTickets/t1` | `update` on ticket where `existing.status == 'resolved'` as non-admin | `PERMISSION_DENIED` |
| 12 | Cross-User List Scraping | `/supportTickets` | `list()` without `where('uid', '==', auth.uid)` as non-admin | `PERMISSION_DENIED` |
| 13 | Non-Admin Maintenance Mode Hijack | `/systemConfig/public` | `update` setting `maintenanceMode: true` as regular verified user | `PERMISSION_DENIED` |
| 14 | Draft Ad Scraping by Non-Admin | `/publicAds` | `list()` returning `status == 'draft'` or `'paused'` as regular user | `PERMISSION_DENIED` |
| 15 | Non-Admin Catalog Injection | `/publicCatalogLists/banners` | `create` or `update` banners as regular verified user | `PERMISSION_DENIED` |
| 16 | Unpublished Movie Scraping | `/publicMovies` | `list()` returning `published == false` as regular user | `PERMISSION_DENIED` |
| 17 | Media Collection Scraping | `/publicMedia` | `list()` enumerating uploaded media assets | `PERMISSION_DENIED` |
| 18 | Invalid Media Scheme / Oversized Upload | `/publicMedia/bad_media` | `create` with `dataUrl: "javascript:alert(1)"` as admin | `PERMISSION_DENIED` |
