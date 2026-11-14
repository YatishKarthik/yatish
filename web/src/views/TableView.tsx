import { Html, Line, OrbitControls, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { Fingerprint } from '../charts/Fingerprint';
import { Ribbon } from '../charts/Ribbon';
import { asset } from '../data/load';
import { PILLARS } from '../data/pillars';
import { bodyName, PERMIT, rankedSites, siteIndex } from '../data/select';
import type { TileSet } from '../data/tiles';
import type { Level, Scenario, Site, SitesJson, Target } from '../data/types';
import { Clouds, EarthMaterial, SUN_DIR } from '../scenes/Earth';
import { Half, isSmall, Seam } from '../scenes/SeamCanvas';
import { KM } from '../scenes/terrain';
import { runPower } from '../sim/power';
import { runThermal } from '../sim/thermal';
import { fmtHour } from '../state/clock';
import { useProgress } from '../state/progress';
import { useStore, type Station } from '../state/store';
import { Num } from '../ui/Num';
import { Seg } from '../ui/Seg';
import { NotFound } from './SeamView';
import { useSeam } from './useSeam';

const REDUCE = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOLO = '#8fe3ff';
const OVERVIEW: [number, number, number] = [0, 5.0, 11.8];

// Where each light panel floats. All of them face the place the visitor first stands.
const PANELS: Record<'mission' | 'fingerprint' | 'permits' | 'bench', [number, number, number]> = {
  mission: [-5.5, 2.15, -0.4],
  fingerprint: [5.5, 2.15, -0.4],
  bench: [-3.5, 2.15, -5.6],
  permits: [3.5, 2.15, -5.6],
};
const DF = 1.7, PANEL_W = 380;   // panel size in the room
const SCENARIOS: Scenario[] = ['driving', 'landing', 'thermal'];
const PLAIN: Record<Scenario, string> = { driving: 'Drive a rover here', landing: 'Practise landings here', thermal: 'Trust the temperatures here' };
const CALLS: { level: Level; word: string }[] = [{ level: 'green', word: 'Permit' }, { level: 'yellow', word: 'With limits' }, { level: 'red', word: 'Deny' }];
type Picks = Partial<Record<Scenario, Level>>;
interface Game { picks: Picks; open: boolean; pick: (sc: Scenario, l: Level) => void; reveal: (skip: boolean) => void }
type TaskId = 'probe' | 'night' | 'fingerprint' | 'permits' | 'bench';
const TASKS: { id: TaskId; name: string; how: string; station: Station }[] = [
  { id: 'probe', name: 'Probe the ground', how: 'Move the pointer over the terrain', station: 'terrain' },
  { id: 'night', name: 'See it at night', how: 'Drag the clock past sunset', station: 'terrain' },
  { id: 'fingerprint', name: 'Compare the fingerprints', how: 'Fly to the Fingerprint panel', station: 'fingerprint' },
  { id: 'permits', name: 'Make your call', how: 'Judge the three field tests', station: 'permits' },
  { id: 'bench', name: 'Stress the hardware', how: 'Fly to the Test bench panel', station: 'bench' },
];
const facing = (p: [number, number, number]) => { const n = new THREE.Vector3(OVERVIEW[0] - p[0], 0, OVERVIEW[2] - p[2]).normalize(); return { n, rotY: Math.atan2(n.x, n.z) }; };
const STATIONS: Record<Station, { pos: [number, number, number]; at: [number, number, number]; name: string }> = {
  overview: { pos: OVERVIEW, at: [0, 1.7, 0], name: 'Overview' },
  terrain: { pos: [0, 2.5, 4.5], at: [0, 0.1, 0], name: 'Terrain' },
  space: { pos: [0, 2.9, 5.4], at: [0, 3.0, 0], name: 'Star map' },
  ...(Object.fromEntries((Object.keys(PANELS) as (keyof typeof PANELS)[]).map((k) => {
    const p = PANELS[k], { n } = facing(p), back = k === 'permits' ? 9.8 : 8.3;
    // stand back far enough to read the whole panel, and aim a little low so it clears the console
    return [k, { pos: [p[0] + n.x * back, p[1] - 0.1, p[2] + n.z * back], at: [p[0], p[1] - 0.45, p[2]], name: k[0].toUpperCase() + k.slice(1) }];
  })) as Record<keyof typeof PANELS, { pos: [number, number, number]; at: [number, number, number]; name: string }>),
};
const ORDER: Station[] = ['overview', 'terrain', 'mission', 'fingerprint', 'permits', 'bench', 'space'];

/**
 * Flies the camera to the chosen station in 900 ms, then hands control back for free orbiting.
 * At a panel it stands exactly far enough back for the whole panel to fit between the top bar and the console.
 */
function Rig({ fitKey }: { fitKey: string }) {
  const station = useStore((s) => s.station);
  const camera = useThree((s) => s.camera), size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; enabled: boolean } | null;
  const anim = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number } | null>(null);
  useEffect(() => {
    if (!controls) return;
    const id = window.setTimeout(() => {   // one beat later, so the panel and the top bar have their new size
      const st = STATIONS[station], W = window.innerWidth, H = window.innerHeight;
      let at = new THREE.Vector3(...st.at), pos = new THREE.Vector3(...st.pos);
      if (station in PANELS) {
        const p = PANELS[station as keyof typeof PANELS], { n } = facing(p);
        const el = document.querySelector<HTMLElement>(`[data-panel="${station}"]`);
        const top = document.querySelector('.table-head')?.getBoundingClientRect().bottom ?? 0;
        const bottom = Math.min(H, document.querySelector('.table-console')?.getBoundingClientRect().top ?? H);
        const free = Math.max(220, bottom - top - 28), k = DF / 400, t = 2 * Math.tan((20 * Math.PI) / 180);
        const wide = PANEL_W * 2 * k, tall = el && el.offsetWidth ? ((el.offsetHeight * PANEL_W * 2) / el.offsetWidth) * k : 3;
        const d = Math.max((tall * H) / (t * free), (wide * H) / (t * W * 0.94));
        const dy = ((H / 2 - (top + bottom) / 2) * t * d) / H;
        at = new THREE.Vector3(p[0], p[1] - dy, p[2]);
        pos = new THREE.Vector3(p[0] + n.x * d, p[1] - dy, p[2] + n.z * d);
      } else if (W < 800) pos = pos.sub(at).multiplyScalar(1.45).add(at);
      anim.current = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: at, start: REDUCE ? -1e9 : performance.now() };
    }, 60);
    return () => window.clearTimeout(id);
  }, [station, controls, camera, fitKey, size.width, size.height]);
  useFrame(() => {
    const a = anim.current;
    if (!a || !controls) return;
    const k = Math.min(1, (performance.now() - a.start) / 900), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(a.p0, a.p1, e);
    controls.target.lerpVectors(a.t0, a.t1, e);
    controls.enabled = k >= 1;
    controls.update();
    if (k >= 1) anim.current = null;
  });
  return null;
}

/** The table, its glowing rim, the projection rings under the terrain and the room's floor grid. */
function Room({ E }: { E: number }) {
  const rings = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uT;
      void main() { float d = length(vUv - 0.5) * 2.0; float ring = smoothstep(0.03, 0.0, abs(fract(d * 6.0 - uT * 0.25) - 0.5) - 0.44);
        float a = ring * (1.0 - d) * 0.5 + smoothstep(1.0, 0.94, d) * smoothstep(0.9, 0.97, d) * 0.9;
        gl_FragColor = vec4(vec3(0.56, 0.89, 1.0), a * step(d, 1.0)); }`,
  }), []);
  const floor = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW;
      void main() { vec2 g = abs(fract(vW.xz * 0.5) - 0.5) / fwidth(vW.xz * 0.5); float line = 1.0 - min(min(g.x, g.y), 1.0);
        float fade = smoothstep(26.0, 4.0, length(vW.xz)); gl_FragColor = vec4(vec3(0.56, 0.89, 1.0), line * fade * 0.16); }`,
  }), []);
  const beam = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; void main() { gl_FragColor = vec4(vec3(0.56, 0.89, 1.0), pow(1.0 - vUv.y, 2.5) * 0.16); }`,
  }), []);
  useFrame(({ clock }) => { if (!REDUCE) rings.uniforms.uT.value = clock.elapsedTime; });
  const R = E * 1.15, H = E * 0.5;
  return (
    <group>
      <mesh position={[0, -1.2, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floor}><planeGeometry args={[60, 60]} /></mesh>
      <mesh position={[0, -0.64, 0]}><cylinderGeometry args={[R * 0.55, R * 0.75, 1.1, 48]} /><meshStandardMaterial color="#0b1016" roughness={0.6} metalness={0.4} /></mesh>
      <mesh position={[0, -0.07, 0]}><cylinderGeometry args={[R, R, 0.08, 96]} /><meshStandardMaterial color="#0d131b" roughness={0.45} metalness={0.5} /></mesh>
      <mesh position={[0, -0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} material={rings}><planeGeometry args={[R * 2, R * 2]} /></mesh>
      {/* light walls rising from the tile's edge: the volume the projector fills */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} material={beam} position={[Math.sin((i * Math.PI) / 2) * (E / 2), H / 2, Math.cos((i * Math.PI) / 2) * (E / 2)]} rotation={[0, (i * Math.PI) / 2, 0]}>
          <planeGeometry args={[E, H]} />
        </mesh>
      ))}
    </group>
  );
}

/** Slow motes in the projector's light. */
function Motes() {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    let s = 5; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pos = new Float32Array(360 * 3);
    for (let i = 0; i < 360; i++) { const a = rnd() * 6.283, r = 0.6 + rnd() * 6; pos.set([Math.cos(a) * r, rnd() * 6, Math.sin(a) * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); return g;
  }, []);
  useFrame((_, dt) => { if (ref.current && !REDUCE) ref.current.rotation.y += dt * 0.01; });
  return <points ref={ref} geometry={geo}><pointsMaterial size={1.6} sizeAttenuation={false} color={HOLO} transparent opacity={0.28} depthWrite={false} /></points>;
}

/** A world as a token at the table's edge, with a thread of light to the half of the terrain it supplies. */
function Token({ body, x, to }: { body: 'earth' | 'mars' | 'moon'; x: number; to: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const tex = useTexture(asset(`textures/${body}.jpg`));
  tex.colorSpace = THREE.SRGBColorSpace;
  useFrame((_, dt) => { if (ref.current && !REDUCE) ref.current.rotation.y += dt * 0.25; });
  const pos: [number, number, number] = [x, 0.95, 3.0], r = 0.42;
  return (
    <>
      <group position={pos}>
        <group ref={ref}>
          <mesh><sphereGeometry args={[r, 64, 48]} />{body === 'earth' ? <EarthMaterial /> : <meshStandardMaterial map={tex} roughness={1} />}</mesh>
          {body === 'earth' && <Clouds r={r} />}
        </group>
      </group>
      <Line points={[pos, to]} color={body === 'earth' ? '#4f8df7' : '#e0673a'} lineWidth={1} transparent opacity={0.55} dashed dashSize={0.12} gapSize={0.08} />
    </>
  );
}

/** The star map above the table: every Earth site a star, placed by how alike they are. Hover for a name, click to load. */
function Constellation({ data, target, siteId, peek, setPeek }: { data: SitesJson; target: Target; siteId: string; peek: string | null; setPeek: (id: string | null) => void }) {
  const ref = useRef<THREE.Group>(null);
  const navigate = useNavigate();
  useFrame((_, dt) => { if (ref.current && !REDUCE && !peek) ref.current.rotation.y += dt * 0.05; });
  useEffect(() => { document.body.style.cursor = peek ? 'pointer' : ''; return () => { document.body.style.cursor = ''; }; }, [peek]);
  const ml = data.meta.ml;
  if (!ml || !target.ml) return null;
  const S = 0.95, at = (p: [number, number, number]) => p.map((v) => v * S) as [number, number, number];
  const near = ml.neighbours[target.id] ?? [];
  const tag = (text: string, cls: string, below = false) => <Html center zIndexRange={[15, 0]}><div className={`hud-tag pointer-events-none ${below ? 'translate-y-6' : '-translate-y-6'} whitespace-nowrap font-mono text-xs ${cls}`}>{text}</div></Html>;
  return (
    <group ref={ref} position={[0, 3.0, 0]}>
      {near.map((id) => { const s = data.sites.find((x) => x.id === id); return s?.ml ? <Line key={id} points={[at(target.ml!.pca), at(s.ml.pca)]} color="#e0673a" lineWidth={1} transparent opacity={0.8} /> : null; })}
      {data.sites.map((s) => { if (!s.ml) return null; const on = s.id === siteId, hot = s.id === peek; return (
        <group key={s.id} position={at(s.ml.pca)}>
          <mesh onClick={(e) => { e.stopPropagation(); navigate({ pathname: `/table/${s.id}`, hash: `#t=${target.id}` }); }}
            onPointerOver={(e) => { e.stopPropagation(); setPeek(s.id); }} onPointerOut={() => setPeek(null)}>
            <sphereGeometry args={[on || hot ? 0.06 : near.includes(s.id) ? 0.042 : 0.028, 12, 10]} />
            <meshBasicMaterial color={on ? '#ffffff' : hot ? '#8fe3ff' : near.includes(s.id) ? '#4f8df7' : '#6f8fb5'} />
          </mesh>
          {hot && !on && tag(`${s.name} · ${s.closeness[target.id]?.total ?? '—'}`, 'text-ink')}
          {on && tag(`${s.name} · on the table`, 'text-ink', true)}
        </group>
      ); })}
      <group position={at(target.ml.pca)}>
        <mesh rotation={[0.6, 0.6, 0]}><octahedronGeometry args={[0.08]} /><meshBasicMaterial color="#e0673a" /></mesh>
        {tag(target.name, 'text-mars')}
      </group>
    </group>
  );
}

/** A panel of light: DOM content placed in the room, turned toward the visitor. Click its title to fly to it. */
function Panel({ id, title, sub, children }: { id: keyof typeof PANELS; title: string; sub: string; children: ReactNode }) {
  const p = PANELS[id], { rotY } = facing(p);
  const active = useStore((s) => s.station === id);
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <Html transform distanceFactor={DF} zIndexRange={[20, 0]}>
        <section className={`holo-panel ${active ? 'is-active' : ''}`} style={{ width: PANEL_W, zoom: 2 }} data-panel={id} aria-label={title}>
          <button type="button" className="holo-title" onClick={() => useStore.getState().set({ station: active ? 'overview' : id })} aria-pressed={active}>
            <span>{title}</span><span aria-hidden>{active ? 'step back' : 'fly here'}</span>
          </button>
          <div className="holo-body"><p className="holo-sub">{sub}</p>{children}</div>
        </section>
      </Html>
    </group>
  );
}

function Scene({ data, site, target, tiles, extentM, game }: { data: SitesJson; site: Site; target: Target; tiles: { earth: TileSet; mars: TileSet } | null; extentM: number; game: Game }) {
  const [peek, setPeek] = useState<string | null>(null);
  const E = (extentM || 3000) * KM, segments = useMemo(() => (isSmall() ? 127 : 255), []);
  const W = bodyName(target);
  const ranked = rankedSites(data, target.id), rank = ranked.findIndex((s) => s.id === site.id);
  const navigate = useNavigate();
  const go = (id: string) => navigate({ pathname: `/table/${id}`, hash: `#t=${target.id}` });
  const open = (page: 'trial' | 'bench' | 'seam') => navigate({ pathname: `/${page}/${site.id}`, hash: `#t=${target.id}` });
  const c = site.closeness[target.id], verdicts = site.verdicts[target.id], a = site.params, b = target.params;
  const pe = data.planets.earth, pt = data.planets[target.body];
  const bench = a && b ? {
    pe: runPower({ insolationKwh: a.insolation_kwh!.value, dayHours: pe.day_hours, areaM2: 2, efficiency: 0.25, loadW: 60 }),
    pt: runPower({ insolationKwh: b.insolation_kwh!.value, dayHours: pt.day_hours, areaM2: 2, efficiency: 0.25, loadW: 60 }),
    te: runThermal({ curve: site.curve, minC: a.temp_min_c!.value, maxC: a.temp_max_c!.value, dayHours: pe.day_hours, tauHours: 2 }),
    tt: runThermal({ curve: target.curve, minC: b.temp_min_c!.value, maxC: b.temp_max_c!.value, dayHours: pt.day_hours, tauHours: 2 }),
  } : null;
  const hrs = (x: number) => (x >= 48 ? `${(x / 24).toFixed(1)} d` : `${x.toFixed(0)} h`);

  return (
    <>
      <hemisphereLight args={['#bcd4ff', '#06080b', 0.5]} />
      <directionalLight position={[SUN_DIR.x * 10, SUN_DIR.y * 10, SUN_DIR.z * 10]} intensity={2.6} color="#fff6ea" />
      <Room E={E} />
      <Motes />
      {tiles && (
        <group position={[0, 0.02, 0]}>
          <Half world="earth" tiles={tiles.earth} extentM={extentM} offsetX={0} mode="wipe" segments={segments} trialMode={false} rough={0.15} />
          <Half world="mars" tiles={tiles.mars} extentM={extentM} offsetX={0} mode="wipe" segments={segments} trialMode={false} rough={0.15} />
          <Seam extentM={extentM} earthLabel={site.name} marsLabel={target.name} body={W.toUpperCase()} />
        </group>
      )}
      <Suspense fallback={null}>
        <Token body="earth" x={-3.1} to={[-E / 4, 0.25, E / 2]} />
        <Token body={target.body} x={3.1} to={[E / 4, 0.25, E / 2]} />
      </Suspense>
      <Constellation data={data} target={target} siteId={site.id} peek={peek} setPeek={setPeek} />

      <Panel id="mission" title="Best matches" sub={`Earth sites ranked by how closely they behave like ${target.name}. Pick one to put it on the table.`}>
        <ol>
          {ranked.slice(Math.max(0, Math.min(rank - 3, ranked.length - 8)), Math.max(0, Math.min(rank - 3, ranked.length - 8)) + 8).map((s) => { const i = ranked.indexOf(s), v = s.closeness[target.id]?.total ?? 0; return (
            <li key={s.id}><button type="button" onClick={() => go(s.id)} onPointerEnter={() => setPeek(s.id)} onPointerLeave={() => setPeek(null)} className={`holo-row ${s.id === site.id ? 'is-on' : ''}`}>
              <span className="min-w-0 truncate"><span className="holo-dim mr-2">{String(i + 1).padStart(2, '0')}</span>{s.name}</span>
              <span className="flex shrink-0 items-center gap-2"><span className="holo-bar"><span style={{ width: `${v}%` }} /></span><span className="w-6 text-right tabular-nums">{v}</span></span>
            </button></li>
          ); })}
        </ol>
        <div className="mt-2 flex gap-2">
          <button type="button" className="holo-btn" disabled={rank <= 0} onClick={() => go(ranked[rank - 1].id)}>← Closer match</button>
          <button type="button" className="holo-btn" disabled={rank >= ranked.length - 1} onClick={() => go(ranked[rank + 1].id)}>Next match →</button>
        </div>
        {c?.gate != null && c.gate < 1 && <p className="holo-warn mt-2">Plants cover this site, so its score is cut (× {c.gate}).</p>}
      </Panel>

      <Panel id="fingerprint" title="Fingerprint" sub="Each spoke is one measurement. Where the blue and orange shapes overlap, the two places agree.">
        {a && b ? <div className="flex justify-center"><Fingerprint a={a} b={b} size={290} labels title={`${site.name} over ${target.name}`} /></div> : <p className="holo-dim">No parameter set.</p>}
        <div className="grid grid-cols-5 gap-1">
          {PILLARS.map((p) => { const v = c?.pillars?.[p.id]; return (
            <div key={p.id} className="holo-tile" title={p.label}><span className="holo-k">{p.short}</span><span className="holo-num">{v == null ? <span className="text-xs text-[#9fb4c2]">no data</span> : v}</span><span className="block h-0.5" style={{ background: p.colour, width: `${v ?? 0}%` }} /></div>
          ); })}
        </div>
        <p className="holo-dim mt-2"><span className="text-earth">■ {site.name}</span> · <span className="text-mars">■ {target.name}</span> · scores out of 100</p>
      </Panel>

      <Panel id="permits" title="Field-test permits" sub="A close match is not a licence to test. Each kind of test has its own rule. Make your call, then see what the rules say.">
        {!verdicts ? <p className="holo-dim">No verdicts for this pair.</p> : !game.open ? (
          <>
            {SCENARIOS.map((sc) => (
              <div key={sc} className="holo-permit">
                <p className="text-sm font-semibold">{PLAIN[sc]}?</p>
                <div className="mt-1 flex gap-1">
                  {CALLS.map((k) => <button key={k.level} type="button" className="holo-btn holo-call" aria-pressed={game.picks[sc] === k.level} style={{ ['--call' as string]: PERMIT[k.level].colour }} onClick={() => game.pick(sc, k.level)}>{k.word}</button>)}
                </div>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-3">
              <button type="button" className="holo-btn holo-go" disabled={SCENARIOS.some((sc) => !game.picks[sc])} onClick={() => game.reveal(false)}>Reveal the rules</button>
              <button type="button" className="holo-link" onClick={() => game.reveal(true)}>Skip, just show me</button>
            </div>
          </>
        ) : (
          <>
            {SCENARIOS.map((sc) => { const v = verdicts[sc], p = PERMIT[v.level], mine = game.picks[sc]; return (
              <div key={sc} className="holo-permit">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{PLAIN[sc]}</p>
                  <span className="stamp !rotate-0 shrink-0" style={{ color: p.colour, borderColor: p.colour }}>{p.word}</span>
                </div>
                <p className="text-sm">{v.rule}</p>
                <p className="holo-dim">{v.detail}</p>
                {mine && <p className="holo-k mt-1" style={{ color: mine === v.level ? '#3fb950' : '#f2a93b' }}>{mine === v.level ? '✓ You called it' : `✗ You said ${CALLS.find((k) => k.level === mine)!.word.toLowerCase()}`}</p>}
              </div>
            ); })}
            <button type="button" className="holo-btn mt-2" onClick={() => open('trial')}>Run the rover trial</button>
          </>
        )}
      </Panel>

      <Panel id="bench" title="Test bench" sub="The same solar panel, battery and metal part, placed on both worlds for one full day and night.">
        {bench ? (
          <table className="w-full text-sm">
            <thead><tr><th className="holo-k text-left font-normal">2 m² panel · 60 W load</th><th className="holo-k text-right font-normal !text-earth">Earth</th><th className="holo-k text-right font-normal !text-mars">{W}</th></tr></thead>
            <tbody className="font-mono tabular-nums">
              <tr><td className="font-sans">Energy per day</td><td className="text-right">{bench.pe.energyPerDayKwh.toFixed(1)} kWh</td><td className="text-right">{bench.pt.energyPerDayKwh.toFixed(1)} kWh</td></tr>
              <tr><td className="font-sans">Night to survive</td><td className="text-right">{hrs(bench.pe.nightHours)}</td><td className="text-right">{hrs(bench.pt.nightHours)}</td></tr>
              <tr><td className="font-sans">Battery for the night</td><td className="text-right">{bench.pe.storageKwh.toFixed(1)} kWh</td><td className="text-right">{bench.pt.storageKwh.toFixed(1)} kWh</td></tr>
              <tr><td className="font-sans">Power result</td><td className="text-right">{bench.pe.ok ? 'CARRIES' : 'SHORT'}</td><td className="text-right">{bench.pt.ok ? 'CARRIES' : 'SHORT'}</td></tr>
              <tr><td className="font-sans pt-2">Part swing per cycle</td><td className="pt-2 text-right">{bench.te.swingC.toFixed(0)} °C</td><td className="pt-2 text-right">{bench.tt.swingC.toFixed(0)} °C</td></tr>
              <tr><td className="font-sans">Cycles per Earth year</td><td className="text-right">{bench.te.cyclesPerEarthYear.toFixed(0)}</td><td className="text-right">{bench.tt.cyclesPerEarthYear.toFixed(0)}</td></tr>
              <tr><td className="font-sans">Below −40 °C per day</td><td className="text-right">{hrs(bench.te.heaterHoursPerDay)}</td><td className="text-right">{hrs(bench.tt.heaterHoursPerDay)}</td></tr>
            </tbody>
          </table>
        ) : <p className="holo-dim">No parameter set.</p>}
        <button type="button" className="holo-btn mt-2" onClick={() => open('bench')}>Open the full bench</button>
      </Panel>

      <OrbitControls makeDefault enablePan={false} minDistance={1.6} maxDistance={24} maxPolarAngle={Math.PI * 0.62} />
      <Rig fitKey={`${site.id}:${target.id}:${game.open}`} />
    </>
  );
}

/** One plain sentence at the top of the room: which two places, how close, and where they agree and differ. */
function Headline({ data, site, target, children }: { data: SitesJson; site: Site; target: Target; children: ReactNode }) {
  const ranked = rankedSites(data, target.id), rank = ranked.findIndex((s) => s.id === site.id), c = site.closeness[target.id];
  const have = PILLARS.map((p) => ({ p, v: c?.pillars?.[p.id] })).filter((x): x is { p: (typeof PILLARS)[number]; v: number } => x.v != null);
  const best = have.reduce<(typeof have)[number] | null>((m, x) => (!m || x.v > m.v ? x : m), null), worst = have.reduce<(typeof have)[number] | null>((m, x) => (!m || x.v < m.v ? x : m), null);
  const none = PILLARS.filter((p) => c?.pillars?.[p.id] == null).map((p) => p.label.toLowerCase());
  const compact = useStore((s) => s.station in PANELS);   // reading a panel: shrink to one line so nothing sits behind the text
  if (compact) return (
    <header className="table-head">
      <p className="text-sm"><span className="text-earth">{site.name}</span> <span className="text-dim">and</span> <span className="text-mars">{target.name}</span> <span className="text-dim">·</span> <Num path={`sites.${siteIndex(data, site.id)}.closeness.${target.id}.total`} className="text-ink" /> <span className="text-dim">/ 100 match</span></p>
      {children}
    </header>
  );
  return (
    <header className="table-head">
      <div className="flex items-center justify-center gap-4 max-md:gap-2">
        <p className="min-w-0 text-right"><span className="caps !text-earth">Earth</span><span className="table-name">{site.name}</span><span className="table-where max-md:hidden">{site.region}</span></p>
        <p className="table-score" title="Closeness, 0 to 100. Read from sites.json, never computed in the browser."><Num path={`sites.${siteIndex(data, site.id)}.closeness.${target.id}.total`} /><span>/ 100 match</span></p>
        <p className="min-w-0"><span className="caps !text-mars">{bodyName(target)}</span><span className="table-name">{target.name}</span><span className="table-where max-md:hidden">rank {rank + 1} of {ranked.length} Earth sites</span></p>
      </div>
      {best && worst && <p className="table-why max-md:hidden">Most alike in <b>{best.p.label.toLowerCase()}</b> ({best.v}) · least alike in <b>{worst.p.label.toLowerCase()}</b> ({worst.v}){none.length ? ` · no data yet for ${none.join(', ')}` : ''}</p>}
      {children}
    </header>
  );
}

/** The survey: five things to do with this pair, then file the report. Each chip flies you to where the task is done. */
function Survey({ site, target, done, next }: { site: Site; target: Target; done: Record<TaskId, boolean>; next: (() => void) | null }) {
  const pair = `${site.id}:${target.id}`;
  const filed = useProgress((s) => s.reports.includes(pair)), total = useProgress((s) => s.reports.length);
  const n = TASKS.filter((t) => done[t.id]).length, ready = n === TASKS.length;
  return (
    <div className="survey max-lg:hidden" aria-label="Site survey">
      <span className="caps !text-[#8fe3ff]">Survey</span>
      {TASKS.map((t) => { const ok = done[t.id] || filed; return (
        <button key={t.id} type="button" className={`survey-task ${ok ? 'is-done' : ''}`} title={t.how} onClick={() => useStore.getState().set({ station: t.station })}>
          <span aria-hidden>{ok ? '✓' : '○'}</span>{t.name}
        </button>
      ); })}
      {filed
        ? (next ? <button type="button" className="holo-btn holo-go" onClick={next}>Filed ✓ · next site →</button> : <span className="font-mono text-xs text-permit">Filed ✓</span>)
        : <button type="button" className="holo-btn holo-go" disabled={!ready} title={`Reports filed so far: ${total}`} onClick={() => { useProgress.getState().award('report', pair); useProgress.getState().say(`Report filed · ${site.name} for ${target.name}`); }}>{ready ? 'File report · +30 XP' : `${n} of ${TASKS.length}`}</button>}
    </div>
  );
}

/** The console at the front edge of the table: time, layer, what the pointer is over, and the two day ribbons. */
function Console({ site, target }: { site: Site; target: Target }) {
  const hour = useStore((s) => s.hour), playing = useStore((s) => s.playing), layer = useStore((s) => s.layer), station = useStore((s) => s.station), hover = useStore((s) => s.hover);
  const set = useStore((s) => s.set);
  const key = layer === 'temperature' ? ['cold', 'linear-gradient(90deg,#1f2f6e,#4f8df7,#e9e2cf,#e0673a,#8f1d1d)', 'hot · each world on its own scale'] : layer === 'slope' ? ['flat', 'linear-gradient(90deg,#1c2a3a,#3fb950,#f2a93b,#f85149)', 'steep'] : null;
  return (
    <div className="table-console">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="table-clock" aria-hidden>{fmtHour(hour)}</span>
        <button type="button" className="holo-btn" onClick={() => set({ playing: !playing })}>{playing ? '❚❚ Pause' : '▶ Play a day'}</button>
        <input type="range" min={0} max={24} step={0.05} value={hour} className="scrub min-w-[120px] flex-1" aria-label="Local solar time" aria-valuetext={`${fmtHour(hour)} local solar time`}
          onChange={(e) => { const h = Number(e.target.value) % 24; set({ hour: h, playing: false }); if (h < 4 || h > 21) useProgress.getState().award('flag', 'night'); }} />
        <Seg label="Terrain layer" value={layer} onChange={(v) => set({ layer: v })} options={[{ value: 'temperature', label: 'Heat' }, { value: 'satellite', label: 'Photo' }, { value: 'slope', label: 'Slope' }]} />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-xs text-dim max-md:hidden" aria-live="off">
        {key ? <span className="flex items-center gap-1.5">{key[0]}<span className="inline-block h-1.5 w-24" style={{ background: key[1] }} />{key[2]}</span> : <span>Satellite photo of each site</span>}
        <span className="ml-auto text-ink">{hover
          ? <><span className={hover.world === 'earth' ? 'text-earth' : 'text-mars'}>{hover.world === 'earth' ? site.name : target.name}</span> · height {hover.heightM.toFixed(0)} m · slope {hover.slopeDeg.toFixed(1)}°</>
          : <span className="text-dim">Point at the terrain to measure it · drag the centre line to compare</span>}</span>
      </p>
      <div className="mt-2 grid grid-cols-[52px_1fr] items-center gap-x-2 max-md:hidden">
        <span className="caps !text-earth">Earth</span><Ribbon curve={site.curve} source={site.curve_source} swingPct={site.features.amplitude_pct} label={`${site.name} thermal day`} />
        <span className="caps !text-mars">{bodyName(target)}</span><Ribbon curve={target.curve} source={target.curve_source} swingPct={target.features.amplitude_pct} label={`${target.name} thermal day`} />
      </div>
      <nav className="mt-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap md:flex-wrap" aria-label="Stations">
        <span className="caps mr-1 max-md:hidden">Fly to</span>
        {ORDER.map((id, i) => (
          <button key={id} type="button" className="holo-btn" aria-pressed={station === id} onClick={() => set({ station: id })}><span className="opacity-60">{i + 1}</span> {STATIONS[id].name}</button>
        ))}
      </nav>
    </div>
  );
}

export function TableView() {
  const params = useParams();
  const navigate = useNavigate();
  const dataAll = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const fallback = rankedSites(dataAll, dataAll.targets.find((t) => t.id === targetId)?.id ?? dataAll.targets[0].id).find((s) => s.kind === 'candidate')?.id;
  const siteId = params.siteId ?? fallback;
  const { data, site, target, tiles, extentM } = useSeam(siteId);
  const sid = site?.id, sname = site?.name;
  useEffect(() => { if (sid) { useProgress.getState().say(`On the table · ${sname}`); useProgress.getState().award('survey', sid); } }, [sid, sname]);
  useEffect(() => {   // the nav bar's height varies with the window; the headline sits just under it
    const nav = document.querySelector('header'), room = document.querySelector<HTMLElement>('.table-room');
    if (!nav || !room) return;
    const fit = () => room.style.setProperty('--nav', `${nav.getBoundingClientRect().height}px`);
    fit();
    const ro = new ResizeObserver(fit); ro.observe(nav);
    return () => ro.disconnect();
  }, [sid]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < ORDER.length) useStore.getState().set({ station: ORDER[i] });
      if (e.key === 'Escape') useStore.getState().set({ station: 'overview' });
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); useStore.getState().set({ station: 'overview' }); };
  }, []);
  // the survey for this pair: what has been done, and the visitor's own call on the permits
  const pair = `${sid}:${target.id}`;
  const [picks, setPicks] = useState<Picks>({});
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<TaskId, boolean>>({ probe: false, night: false, fingerprint: false, permits: false, bench: false });
  useEffect(() => {
    const p = useProgress.getState(), seen = p.reports.includes(pair) || p.flags.includes(`call:${pair}`);
    setPicks({}); setOpen(seen); setDone({ probe: false, night: false, fingerprint: false, permits: seen, bench: false });
  }, [pair]);
  const hovering = useStore((s) => s.hover != null), night = useStore((s) => s.hour < 5 || s.hour > 20), station = useStore((s) => s.station);
  useEffect(() => {
    setDone((d) => {
      const n = { ...d, probe: d.probe || hovering, night: d.night || night, fingerprint: d.fingerprint || station === 'fingerprint', bench: d.bench || station === 'bench', permits: d.permits || open };
      for (const t of TASKS) if (n[t.id] && !d[t.id] && !(t.id === 'permits' && open && !Object.keys(picks).length)) useProgress.getState().say(`Survey · ${t.name} ✓`);
      return TASKS.some((t) => n[t.id] !== d[t.id]) ? n : d;
    });
  }, [hovering, night, station, open]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!site) return <NotFound what="Site" />;
  const verdicts = site.verdicts[target.id];
  const game: Game = {
    picks, open,
    pick: (sc, l) => setPicks((p) => ({ ...p, [sc]: l })),
    reveal: (skip) => {
      if (skip) setPicks({});
      else if (verdicts) {
        const right = SCENARIOS.filter((sc) => picks[sc] === verdicts[sc].level).length;
        useProgress.getState().award('call', pair, right);
        useProgress.getState().say(`Your call · ${right} of 3 right`);
      }
      setOpen(true);
    },
  };
  const ranked = rankedSites(data, target.id), at = ranked.findIndex((s) => s.id === site.id), nextSite = ranked[at + 1];
  return (
    <div className="table-room">
      <Canvas camera={{ position: OVERVIEW, fov: 40, near: 0.05, far: 200 }} dpr={[1, isSmall() ? 1.5 : 2]} aria-label="Holographic table: Earth and target terrain with floating panels">
        <color attach="background" args={['#05070a']} />
        <fog attach="fog" args={['#05070a', 14, 34]} />
        <Scene data={data} site={site} target={target} tiles={tiles} extentM={extentM} game={game} />
      </Canvas>
      {!tiles && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-mono text-sm text-dim">Projecting terrain…</p>}
      <Headline data={data} site={site} target={target}>
        <Survey site={site} target={target} done={done} next={nextSite ? () => navigate({ pathname: `/table/${nextSite.id}`, hash: `#t=${target.id}` }) : null} />
      </Headline>
      <Console site={site} target={target} />
    </div>
  );
}
