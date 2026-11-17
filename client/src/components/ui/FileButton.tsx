import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useI18n } from '../../lib/i18n'

type FileButtonProps = {
  accept?: string;
  onFile?: (file: File | null) => void;
};

export default function FileButton({ accept, onFile }: FileButtonProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        onChange={(e: ChangeEvent<HTMLInputElement>)=>{
          const f = e.target.files?.[0];
          onFile?.(f || null);
          try { if (ref.current) ref.current.value = '' } catch {}
        }}
        className="hidden-file-input"
      />
      <button type="button" className="btn" onClick={()=>ref.current?.click?.()}>{t('Choose file…')}</button>
    </>
  )
}
