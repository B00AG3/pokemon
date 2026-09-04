import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export interface ConfirmLine {
  label: string;
  value: string;
}

export interface ConfirmRequest {
  title: string;
  lines: ConfirmLine[];
  actionLabel: string;
}

interface ConfirmApi {
  /**
   * Show the transaction summary sheet and resolve once the user confirms or
   * cancels. Callers use it in live mode only: demo actions stay one-click so
   * visitors can feel the mechanic without friction.
   */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function useTxConfirm(): ConfirmApi {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('useTxConfirm must be used inside ConfirmTxProvider');
  return value;
}

type OpenRequest = ConfirmRequest & { resolve: (ok: boolean) => void };

/**
 * In-app confirmation for money actions in live mode: restates price,
 * royalty, and network before the wallet prompt. Square, mono, hairline -
 * same exchange-board primitives as the rest of the site.
 */
export function ConfirmTxProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<OpenRequest | null>(null);

  const confirm = useCallback(
    (req: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...req, resolve });
      }),
    [],
  );

  const settle = useCallback((ok: boolean) => {
    setRequest((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, settle]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {request && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={request.title}
        >
          <div className="panel w-full max-w-sm p-6">
            <p className="eyebrow">Confirm</p>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight">
              {request.title}
            </h2>
            <dl className="mt-4 space-y-2.5 border-t border-white/10 pt-4 font-mono text-xs">
              {request.lines.map((line) => (
                <div key={line.label} className="flex items-baseline justify-between gap-4">
                  <dt className="text-white/50">{line.label}</dt>
                  <dd className="text-right text-white">{line.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 font-mono text-[10px] leading-relaxed text-white/45">
              your wallet shows the final check before anything moves
            </p>
            <div className="mt-6 flex gap-2">
              <button type="button" className="btn btn-primary flex-1" onClick={() => settle(true)}>
                {request.actionLabel}
              </button>
              <button type="button" className="btn btn-ghost flex-1" onClick={() => settle(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
