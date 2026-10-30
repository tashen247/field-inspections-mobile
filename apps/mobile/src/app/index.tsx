import { Redirect } from 'expo-router';
import { Loading } from '../components/ui';
import { useAuth } from '../lib/auth-store';

export default function Index() {
  const status = useAuth((s) => s.status);
  const role = useAuth((s) => s.session?.user.role);
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (status === 'locked') return <Redirect href="/lock" />;
  return <Redirect href={role === 'manager' ? '/(manager)/inspections' : '/(assessor)/jobs'} />;
}
