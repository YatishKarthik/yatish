import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PERMIT, SCENARIO_TITLE } from '../data/select';
import type { Scenario, Verdict } from '../data/types';
import { withTarget } from '../state/store';

export function PermitCard({ scenario, verdict, siteId, defaultOpen = false }: { scenario: Scenario; verdict: Verdict; siteId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const p = PERMIT[verdict.level];
  return (
    <div className="rounded-[10px] border border-line bg-paper p-1">
      <div className="rounded-[8px] border border-dashed border-line p-3">
        <button type="button" className="flex w-full flex-col items-start gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="flex w-full items-center justify-between gap-2">
            <span className="stamp" style={{ color: p.colour, borderColor: p.colour }}>{p.word}</span>
            <span className="caps">{open ? 'Hide fine print' : 'Read fine print'}</span>
          </span>
          <span className="font-mono text-sm tracking-wide">{SCENARIO_TITLE[scenario]}</span>
          <span className="text-sm font-semibold">{verdict.rule}</span>
        </button>
        {open && (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-dim">{verdict.detail}</p>
            {scenario === 'driving'
              ? <Link to={withTarget(`/trial/${siteId}`)} className="btn btn-primary">Run this trial</Link>
              : <p className="caps" title="Plume and drill outcomes would be scripted, not simulated, so we do not animate them.">Illustration only · not simulated</p>}
          </div>
        )}
        <p className="caps mt-2">Issued by rule engine{verdict.rule_id ? ` · rule ${verdict.rule_id}` : ''}</p>
      </div>
    </div>
  );
}
