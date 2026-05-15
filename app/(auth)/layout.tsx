// AuthBroadcastListener is mounted in the root app/layout.tsx so cross-tab
// auth events propagate on every route (not just /login and /signup).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
