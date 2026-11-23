import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, Film, Image as ImageIcon, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { uploadMediaFile } from '../../lib/admApi';
import { getCachedCloudMediaDataUrl, resolveCloudMediaUrl } from '../../lib/firebase';

interface MediaUploadFieldProps {
  token: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
  folder: 'posters' | 'backdrops' | 'ads-images' | 'ads-videos' | 'branding' | 'notifications' | 'categories';
  kind: 'image' | 'video';
  hint?: string;
}

export function MediaUploadField({
  token,
  label,
  value,
  onChange,
  folder,
  kind,
  hint,
}: MediaUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [compressImage, setCompressImage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const [cloudWarning, setCloudWarning] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string>(() => getCachedCloudMediaDataUrl(value) || value);

  useEffect(() => {
    if (!value) {
      setPreviewSrc('');
      return;
    }
    const cached = getCachedCloudMediaDataUrl(value);
    if (cached) {
      setPreviewSrc(cached);
      return;
    }
    setPreviewSrc(value);
    if (value.includes('cm=')) {
      let cancelled = false;
      void resolveCloudMediaUrl(value).then((resolved) => {
        if (!cancelled && resolved) setPreviewSrc(resolved);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [value]);

  const accept =
    kind === 'video'
      ? 'video/mp4,video/webm,.mp4,.webm'
      : 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

  const maxSizeMb = kind === 'video' ? 50 : 10;

  const handleFileSelected = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    setSuccessInfo(null);
    setCloudWarning(null);

    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`O ficheiro excede o limite de ${maxSizeMb} MB.`);
      return;
    }

    setUploading(true);
    setProgress(5);
    try {
      const result = await uploadMediaFile({
        token,
        file,
        folder,
        kind,
        compressImage: kind === 'image' && compressImage,
        onProgress: (pct) => setProgress(pct),
      });
      onChange(result.url);
      const kb = Math.max(1, Math.round(result.sizeBytes / 1024));
      setSuccessInfo(
        result.cloudPersisted
          ? `Guardado permanentemente na nuvem (${kb} KB)`
          : `Carregado (${kb} KB)`
      );
      if (result.cloudWarning) {
        setCloudWarning(result.cloudWarning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no carregamento do ficheiro.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-medium text-[#D4D9E6]">{label}</label>
        {kind === 'image' && (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-[#8D97AF] cursor-pointer">
            <input
              type="checkbox"
              checked={compressImage}
              onChange={(e) => setCompressImage(e.target.checked)}
              className="accent-[#E5B85A]"
            />
            Otimizar imagem ao enviar
          </label>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setCloudWarning(null);
            onChange(e.target.value);
          }}
          placeholder={kind === 'video' ? 'URL do vídeo (.mp4 / .webm) ou carregue um ficheiro' : 'URL da imagem ou carregue um ficheiro'}
          className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white placeholder-[#636C82] focus:outline-none focus:border-[#E5B85A]/60"
        />
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={(e) => {
            void handleFileSelected(e.target.files?.[0]);
            e.target.value = '';
          }}
          className="hidden"
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A]/15 text-[#F4CB73] border border-[#E5B85A]/30 hover:bg-[#E5B85A]/25 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
          <span>{uploading ? `A enviar ${progress}%` : kind === 'video' ? 'Carregar Vídeo' : 'Carregar Imagem'}</span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setSuccessInfo(null);
              setCloudWarning(null);
            }}
            className="inline-flex items-center justify-center px-2.5 py-2 rounded-lg text-xs bg-white/[0.04] border border-white/10 text-[#A0A6B8] hover:text-red-400 transition-colors cursor-pointer"
            title="Remover ficheiro"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {uploading && (
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-[#E5B85A] transition-all duration-150" style={{ width: `${progress}%` }} />
        </div>
      )}

      {hint && <p className="text-[11px] text-[#7D879F]">{hint}</p>}

      {error && <p className="text-xs text-red-400">{error}</p>}
      {successInfo && !error && (
        <p className="text-[11px] text-emerald-400 inline-flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {successInfo}
        </p>
      )}
      {cloudWarning && !error && (
        <p className="text-[11px] text-amber-300 flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{cloudWarning}</span>
        </p>
      )}

      {previewSrc && (
        <div className="rounded-lg border border-white/10 bg-black/50 p-2 flex items-center gap-3">
          {kind === 'video' ? (
            <video src={previewSrc} controls muted playsInline className="h-24 w-44 rounded object-cover bg-black" />
          ) : (
            <img src={previewSrc} alt="Pré-visualização" className="h-20 w-32 rounded object-cover bg-black/40" />
          )}
          <div className="min-w-0 text-[11px] text-[#8D97AF] space-y-1">
            <div className="inline-flex items-center gap-1.5 text-white font-medium">
              {kind === 'video' ? <Film className="w-3.5 h-3.5 text-[#E5B85A]" /> : <ImageIcon className="w-3.5 h-3.5 text-[#E5B85A]" />}
              <span>Pré-visualização ativa</span>
              {value.includes('cm=') && (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded px-1.5 py-0.5">
                  <Cloud className="w-3 h-3" /> Nuvem
                </span>
              )}
            </div>
            <p className="truncate max-w-[260px] text-[#7D879F]">{value}</p>
          </div>
        </div>
      )}
    </div>
  );
}
