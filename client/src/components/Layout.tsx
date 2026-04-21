import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Sidebar, { MobileMenuButton } from './Sidebar';
import KamalAssistant from './KamalAssistant';
import NotificationsBell from './NotificationsBell';

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-dark-500 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-dark-50 bg-dark-400 flex-shrink-0">
          <MobileMenuButton onClick={() => setMobileOpen(true)} />
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gold flex items-center justify-center">
              <span className="text-dark-500 font-black text-[10px]">K</span>
            </div>
            <span className="text-white font-bold text-sm">Kaamkaro AI</span>
          </div>
          <NotificationsBell />
        </header>

        {/* Desktop header — notifications only */}
        <div className="hidden lg:flex items-center justify-end px-8 py-3 border-b border-dark-50/30 bg-dark-400 flex-shrink-0">
          <NotificationsBell />
        </div>

        <main className="flex-1 overflow-y-auto bg-dark-500">
          <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Kamal floating AI assistant */}
      <KamalAssistant />
    </div>
  );
}
