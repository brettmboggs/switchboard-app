// Product-level settings: the same for everyone who installs Switchboard, so
// they live in code. Nothing here is personal: these are the services the
// product itself runs (the sync service, the Microsoft app people sign in to).
// Each can be overridden with an environment variable for testing.
export const PRODUCT = {
  // The sync service. Anyone can run their own (sync-worker/, on their own
  // Cloudflare account and domain) and point Switchboard at it in Settings,
  // Account, before signing in; lib/sync.js syncServer() reads that first.
  syncUrl: process.env.SWITCHBOARD_SYNC_URL || 'https://switchboard-sync.brettmboggs.workers.dev',
  // Where the link in an invite email opens. Empty: the join page on the sync
  // service in use (sync-worker/src/joinpage.js); a web board at your own
  // domain later (docs/WEB-BOARD.md). The inviteBase setting overrides it.
  inviteBase: process.env.SWITCHBOARD_INVITE_BASE || '',
  // Where people download Switchboard, for invite emails.
  downloadUrl: process.env.SWITCHBOARD_DOWNLOAD_URL || 'https://github.com/brettmboggs/switchboard-app/releases/latest',
  // The Switchboard app in Microsoft Entra. "Sign in with Microsoft" uses it with
  // the "organizations" authority, so any work or school account can sign in once
  // the registration allows multiple tenants.
  microsoftClientId: process.env.SWITCHBOARD_MS_CLIENT_ID || 'ae83ee13-7776-4abe-8b13-b718d4b0cbd6',
  microsoftTenant: process.env.SWITCHBOARD_MS_TENANT || 'organizations',
  // The Switchboard app in Google Cloud (a desktop-app client). The id is public by
  // design; the secret is not kept in code (lib/google.js says where it is read from).
  googleClientId: process.env.SWITCHBOARD_GOOGLE_CLIENT_ID || '782651601113-4e91d6reo4c4a6md85i55kaqlqm0vjmv.apps.googleusercontent.com'
};
