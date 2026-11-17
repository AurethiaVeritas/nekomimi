import { useEffect } from 'react';
import type { ReactNode } from 'react';
import ResizeHandle, { resizeCorners } from './modal/ResizeHandle'
import useModalWindow from './modal/useModalWindow'
import './Modal.css'

type ModalProps = {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  maxWidth?: number;
  children?: ReactNode;
  footer?: ReactNode;
  resizable?: boolean;
  fitContent?: boolean;
};

type DocumentScrollStyles = {
  rootOverflow: string;
  rootOverscrollBehavior: string;
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  bodyPaddingRight: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyWidth: string;
};

let documentScrollLockCount = 0;
let documentScrollStyles: DocumentScrollStyles | null = null;
let documentScrollPosition = { x: 0, y: 0 };

function preventBackgroundScroll(event: Event) {
  const target = event.target;
  if (target instanceof Element && target.closest('.modal-window')) return;
  event.preventDefault();
}

function lockDocumentScroll() {
  const root = document.documentElement;
  const body = document.body;

  if (documentScrollLockCount === 0) {
    documentScrollStyles = {
      rootOverflow: root.style.overflow,
      rootOverscrollBehavior: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      bodyPaddingRight: body.style.paddingRight,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
    };
    documentScrollPosition = { x: window.scrollX, y: window.scrollY };

    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }

    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.position = 'fixed';
    body.style.top = `${-documentScrollPosition.y}px`;
    body.style.left = `${-documentScrollPosition.x}px`;
    body.style.width = '100%';
    document.addEventListener('wheel', preventBackgroundScroll, { passive: false });
    document.addEventListener('touchmove', preventBackgroundScroll, { passive: false });
  }

  documentScrollLockCount += 1;

  return () => {
    documentScrollLockCount = Math.max(0, documentScrollLockCount - 1);
    if (documentScrollLockCount !== 0 || !documentScrollStyles) return;

    root.style.overflow = documentScrollStyles.rootOverflow;
    root.style.overscrollBehavior = documentScrollStyles.rootOverscrollBehavior;
    body.style.overflow = documentScrollStyles.bodyOverflow;
    body.style.overscrollBehavior = documentScrollStyles.bodyOverscrollBehavior;
    body.style.paddingRight = documentScrollStyles.bodyPaddingRight;
    body.style.position = documentScrollStyles.bodyPosition;
    body.style.top = documentScrollStyles.bodyTop;
    body.style.left = documentScrollStyles.bodyLeft;
    body.style.width = documentScrollStyles.bodyWidth;
    document.removeEventListener('wheel', preventBackgroundScroll);
    document.removeEventListener('touchmove', preventBackgroundScroll);
    window.scrollTo(documentScrollPosition.x, documentScrollPosition.y);
    documentScrollStyles = null;
  };
}

export default function Modal({ open, onClose, title, maxWidth = 896, children, footer, resizable = true, fitContent = false }: ModalProps) {
  const { rect: { w, h, x, y }, isMobile, active, beginGesture, resizeWithKeyboard } = useModalWindow(open, maxWidth, fitContent)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    return lockDocumentScroll()
  }, [open])

  if (!open) return null
  return (
    <div className="modal-layer">
      <button
        type="button"
        className="modal-layer__backdrop"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        className={`modal-window${active ? ' modal-window--interacting' : ''}`}
        style={isMobile
          ? { maxWidth: `${maxWidth}px` }
          : fitContent
            ? {
                left: '50%',
                top: '50%',
                width: `${w}px`,
                height: 'auto',
                maxWidth: `${maxWidth}px`,
                maxHeight: '90vh',
                transform: 'translate(-50%, -50%)',
              }
          : {
              left: `${x}px`,
              top: `${y}px`,
              width: `${w}px`,
              height: `${h}px`,
              maxWidth: `${maxWidth}px`,
              maxHeight: '90vh'
            }}
      >
        <div
          className={`modal-window__header ${isMobile || fitContent ? '' : 'modal-window__header--draggable'}`}
          onPointerDown={event => beginGesture(event)}
        >
          <div className="modal-window__title">{title}</div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-window__body">
          {children}
        </div>
        {footer ? (
          <div className="modal-window__footer">
            {footer}
          </div>
        ) : null}
        {resizable && !isMobile && !fitContent && (
          resizeCorners.map(corner => (
            <ResizeHandle
              key={corner}
              corner={corner}
              active={active === corner}
              onPointerDown={beginGesture}
              onKeyDown={resizeWithKeyboard}
            />
          ))
        )}
      </div>
    </div>
  )
}
