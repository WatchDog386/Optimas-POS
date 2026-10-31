// The shop's staff accounts: one till, two people. Used to seed a new till and,
// once, the shop server (server/index.ts). PINs can be changed later under
// My profile → Security; the change syncs to the server.
export const DEFAULT_STAFF = [
  { id: 1, name: 'Optimas Admin', role: 'owner', pin: '0735' },
  { id: 2, name: 'Cashier', role: 'cashier', pin: '2323' },
] as const
