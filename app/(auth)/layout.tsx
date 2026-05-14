import { AuthBroadcastListener } from "./auth-broadcast-listener";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthBroadcastListener />
      {children}
    </>
  );
}
