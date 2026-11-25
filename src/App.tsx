import { useEffect, useState } from 'react';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { StorefrontPage } from './pages/StorefrontPage';

export default function App() {
  const [admin, setAdmin] = useState(window.location.hash === '#admin');

  useEffect(() => {
    const update = () => setAdmin(window.location.hash === '#admin');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  function showAdmin() {
    window.location.hash = 'admin';
  }

  function showStore() {
    window.location.hash = '';
  }

  return admin
    ? <AdminDashboardPage onBack={showStore} />
    : <StorefrontPage onAdmin={showAdmin} />;
}
