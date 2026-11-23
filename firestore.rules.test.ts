/**
 * Payload-First Security Test Suite for MOVIX Firestore Rules.
 * Verifies that all "Dirty Dozen" adversarial payloads are rejected with PERMISSION_DENIED.
 *
 * Run against Firebase Emulator Suite when available:
 *   firebase emulators:exec --only firestore "npx tsx firestore.rules.test.ts"
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated profile read',
    operation: 'get',
    path: '/users/userA',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-user PII read attempt',
    operation: 'get',
    path: '/users/userA/private/info',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity spoofing in profile uid field',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      uid: 'userB',
      displayName: 'Spoofer',
      photoURL: '',
      preferredLanguage: 'pt-BR',
      notificationsEnabled: true,
      termsAccepted: true,
      termsVersion: '2026.1',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Unverified email spoof write',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email: 'gelitontn1@gmail.com', email_verified: false },
    payload: {
      uid: 'userA',
      displayName: 'Unverified User',
      photoURL: '',
      preferredLanguage: 'pt-BR',
      notificationsEnabled: false,
      termsAccepted: true,
      termsVersion: '2026.1',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow privilege escalation field injection',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      uid: 'userA',
      displayName: 'Alice',
      photoURL: '',
      preferredLanguage: 'pt-BR',
      notificationsEnabled: true,
      termsAccepted: true,
      termsVersion: '2026.1',
      isAdmin: true,
      role: 'superadmin',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Forged client timestamp on create',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      uid: 'userA',
      displayName: 'Alice',
      photoURL: '',
      preferredLanguage: 'pt-BR',
      notificationsEnabled: true,
      termsAccepted: true,
      termsVersion: '2026.1',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Path ID poisoning with oversized/invalid characters',
    operation: 'create',
    path: `/users/userA/favorites/${'x'.repeat(150)}!$`,
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      uid: 'userA',
      tmdbId: 550,
      mediaType: 'movie',
      title: 'Fight Club',
      posterUrl: '',
      year: '1999',
      rating: 8.4,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Orphaned favorite creation without parent user profile',
    operation: 'create',
    path: '/users/orphanUser/favorites/movie_550',
    auth: { uid: 'orphanUser', email: 'orphan@example.com', email_verified: true },
    payload: {
      uid: 'orphanUser',
      tmdbId: 550,
      mediaType: 'movie',
      title: 'Fight Club',
      posterUrl: '',
      year: '1999',
      rating: 8.4,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable createdAt tampering during profile update',
    operation: 'update',
    path: '/users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      createdAt: '2021-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Value poisoning with invalid enum and oversized displayName',
    operation: 'update',
    path: '/users/userA',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      displayName: 'A'.repeat(200),
      preferredLanguage: 'invalid-lang',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Terminal state bypass on resolved support ticket',
    operation: 'update',
    path: '/supportTickets/ticket_resolved',
    auth: { uid: 'userA', email: 'a@example.com', email_verified: true },
    payload: {
      status: 'open',
      message: 'Reopening resolved ticket',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unscoped supportTickets list scraping',
    operation: 'list',
    path: '/supportTickets',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Non-admin maintenanceMode hijack on /systemConfig/public',
    operation: 'update',
    path: '/systemConfig/public',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    payload: {
      maintenanceMode: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Non-admin write attempt on /publicAds',
    operation: 'create',
    path: '/publicAds/ad_fake_1',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    payload: {
      id: 'ad_fake_1',
      name: 'Fake Ad',
      status: 'active',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 15,
    name: 'Non-admin banner hijack on /publicCatalogLists/banners',
    operation: 'update',
    path: '/publicCatalogLists/banners',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    payload: {
      listId: 'banners',
      items: [],
      itemCount: 0,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 16,
    name: 'Unpublished movie scraping by non-admin on /publicMovies',
    operation: 'list',
    path: '/publicMovies',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 17,
    name: 'Media collection enumeration attempt on /publicMedia',
    operation: 'list',
    path: '/publicMedia',
    auth: { uid: 'userB', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 18,
    name: 'Malicious dataUrl scheme injection on /publicMedia',
    operation: 'create',
    path: '/publicMedia/med_bad',
    auth: { uid: 'adminUid', email: 'gelitontn1@gmail.com', email_verified: true },
    payload: {
      id: 'med_bad',
      folder: 'ads-images',
      filename: 'bad.png',
      mimeType: 'image/png',
      dataUrl: 'javascript:alert(1)',
      sizeBytes: 20,
      updatedBy: 'adminUid',
    },
    expected: 'PERMISSION_DENIED',
  },
];
