import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { isDemoMode } from '../lib/api';

interface HeaderProps {
  admin?: boolean;
  onAdmin?: () => void;
  onBack?: () => void;
}

export function Header({ admin = false, onAdmin, onBack }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
      {admin ? (
        <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft size={16} /> Kembali ke toko
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-white">N</span>
            Nomor Virtual
          </a>
          {isDemoMode && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200/70">
              <Sparkles size={11} className="text-amber-600" /> Mode Demo
            </span>
          )}
        </div>
      )}
      {!admin && (
        <button onClick={onAdmin} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900">
          <ShieldCheck size={15} /> Admin
        </button>
      )}
      {admin && <span className="text-sm font-medium text-slate-700">Panel Admin</span>}
    </header>
  );
}
