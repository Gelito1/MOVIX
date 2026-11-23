import { useEffect, useState } from 'react';
import { Globe, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { SupportedLanguage } from '../lib/firebase';
import { LANGUAGE_OPTIONS } from '../lib/onboarding';

interface LanguageSelectorModalProps {
  open: boolean;
  currentLanguage: SupportedLanguage;
  onSelect: (lang: SupportedLanguage) => void;
  onClose: () => void;
}

export function LanguageSelectorModal({
  open,
  currentLanguage,
  onSelect,
  onClose,
}: LanguageSelectorModalProps) {
  const { t } = useAuth();
  const [selected, setSelected] = useState<SupportedLanguage>(currentLanguage);

  useEffect(() => {
    if (open) setSelected(currentLanguage);
  }, [open, currentLanguage]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="movix-lang-title"
    >
      <div className="w-full max-w-sm rounded-t-3xl sm:rounded-2xl bg-[#111522] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Globe className="h-4 w-4 text-[#F3C669]" aria-hidden="true" />
            <h2 id="movix-lang-title" className="text-base font-semibold text-[#F6F7FB]">
              {t.language}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="h-9 w-9 rounded-lg hover:bg-white/[0.08] text-[#9BA5BC] flex items-center justify-center cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto divide-y divide-white/[0.06] px-2 py-1">
          {LANGUAGE_OPTIONS.map((opt) => {
            const isSelected = selected === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => setSelected(opt.code)}
                className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.04] rounded-xl transition-colors cursor-pointer"
              >
                <div>
                  <span
                    className={`block text-sm font-medium ${
                      isSelected ? 'text-[#F3C669]' : 'text-[#D8DFEE]'
                    }`}
                  >
                    {opt.nativeLabel}
                  </span>
                  {opt.label !== opt.nativeLabel && (
                    <span className="block text-xs text-[#7F8BA3] mt-0.5">{opt.label}</span>
                  )}
                </div>
                <span
                  className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${
                    isSelected ? 'border-[#F3C669]' : 'border-[#4D5770]'
                  }`}
                >
                  {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-[#F3C669]" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-white/[0.08] bg-[#0B0E17]">
          <button
            type="button"
            onClick={() => {
              onSelect(selected);
              onClose();
            }}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-[#D9A441] via-[#F3C669] to-[#D9A441] text-[#090B11] font-semibold text-sm hover:brightness-105 active:scale-[0.99] transition-all cursor-pointer"
          >
            {t.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
