import { useEffect, useRef } from 'react';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

const ROWS: Array<[string, string]> = [
  ['Enter', 'Start the next numbered claim'],
  [`${MOD}+Z`, 'Undo'],
  [`${MOD}+Shift+Z`, 'Redo'],
  [`${MOD}+S`, 'Save a version'],
  ['F8 / Shift+F8', 'Next / previous issue'],
  ['Alt+]  /  Alt+[', 'Next / previous suggestion'],
  ['Alt+Enter', 'Accept the selected suggestion'],
  ['Alt+Backspace', 'Reject the selected suggestion'],
  [`${MOD}+/`, 'Show this list'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <dl className="shortcut-list">
          {ROWS.map(([keys, label]) => (
            <div key={keys}>
              <dt>
                {keys.split(/\s+/).map((part, i) =>
                  part === '/' ? (
                    <span key={i}> / </span>
                  ) : (
                    <kbd key={i}>{part}</kbd>
                  ),
                )}
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <button ref={closeRef} type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
