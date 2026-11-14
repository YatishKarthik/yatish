import { Html, Line, OrbitControls, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { Fingerprint } from '../charts/Fingerprint';
import { Ribbon } from '../charts/Ribbon';
import { asset } from '../data/load';
import { PILLARS } from '../data/pillars';
import { bodyName, PERMIT, rankedSites, SCENARIO_TITLE, siteIndex } from '../data/select';
import type { TileSet } from '../data/tiles';
import type { Scenario, Site, SitesJson, Target } from '../data/types';
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
  mission: [-4.9, 2.4, -1.0],
  fingerprint: [4.9, 2.5, -1.0],
  bench: [-2.6, 3.0, -4.8],
  permits: [2.6, 3.0, -4.8],
};
const facing = (p: [number, number, number]) => { const n = new THREE.Vector3(OVERVIEW[0] - p[0], 0, OVERVIEW[2] - p[2]).normalize(); return { n, rotY: Math.atan2(n.x, n.z) }; };
const STATIONS: Record<Station, { pos: [number, number, number]; at: [number, number, number]; name: string }> = {
  overview: { pos: OVERVIEW, at: [0, 1.7, 0], name: 'Overview' },
  terrain: { pos: [0, 2.5, 4.5], at: [0, 0.1, 0], name: 'Terrain' },
  space: { pos: [0, 2.2, 6.6], at: [0, 4.9, 0], name: 'Parameter space' },
  ...(Object.fromEntries((Object.keys(PANELS) as (keyof typeof PANELS)[]).map((k) => {
    const p = PANELS[k], { n } = facing(p);
    // stand back far enough to read the whole panel, and aim a little low so it clears the console
    return [k, { pos: [p[0] + n.x * 7.4, p[1] - 0.1, p[2] + n.z * 7.4], at: [p[0], p[1] - 0.62, p[2]], name: k[0].toUpperCase() + k.slice(1) }];
  })) as Record<keyof typeof PANELS, { pos: [number, number, number]; at: [number, number, number]; name: string }>),
};
const ORDER: Station[] = ['overview', 'terrain', 'mission', 'fingerprint', 'permits', 'bench', 'space'];

/** Flies the camera to the chosen station in 900 ms, then hands control back for free orbiting. */
function Rig() {
  const station = useStore((s) => s.station);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; enabled: boolean } | null;
  const anim = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number } | null>(null);
  useEffect(() => {
    if (!controls) return;
    const st = STATIONS[station], narrow = window.innerWidth < 800 ? 1.45 : 1;
    const at = new THREE.Vector3(...st.at), pos = new THREE.Vector3(...st.pos).sub(at).multiplyScalar(narrow).add(at);
    anim.current = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: at, start: REDUCE ? -1e9 : performance.now() };
  }, [station, controls, camera]);
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

/** The parameter space, hanging above the table: every site a star, the target's nearest five joined to it. */
function Constellation({ data, target, siteId }: { data: SitesJson; target: Target; siteId: string }) {
  const ref = useRef<THREE.Group>(null);
  const navigate = useNavigate();
  useFrame((_, dt) => { if (ref.current && !REDUCE) ref.current.rotation.y += dt * 0.05; });
  const ml = data.meta.ml;
  if (!ml || !target.ml) return null;
  const S = 1.5, at = (p: [number, number, number]) => p.map((v) => v * S) as [number, number, number];
  const near = ml.neighbours[target.id] ?? [];
  return (
    <group ref={ref} position={[0, 5.0, 0]}>
      {near.map((id) => { const s = data.sites.find((x) => x.id === id); return s?.ml ? <Line key={id} points={[at(target.ml!.pca), at(s.ml.pca)]} color="#e0673a" lineWidth={1} transparent opacity={0.8} /> : null; })}
      {data.sites.map((s) => s.ml && (
        <mesh key={s.id} position={at(s.ml.pca)} onClick={(e) => { e.stopPropagation(); navigate({ pathname: `/table/${s.id}`, hash: `#t=${target.id}` }); }}>
          <sphereGeometry args={[s.id === siteId ? 0.075 : near.includes(s.id) ? 0.05 : 0.032, 12, 10]} />
          <meshBasicMaterial color={s.id === siteId ? '#ffffff' : near.includes(s.id) ? '#4f8df7' : '#6f8fb5'} />
        </mesh>
      ))}
      <mesh position={at(target.ml.pca)} rotation={[0.6, 0.6, 0]}><octahedronGeometry args={[0.11]} /><meshBasicMaterial color="#e0673a" /></mesh>
    </group>
  );
}

/** A panel of light: DOM content placed in the room, turned toward the visitor. Click its title to fly to it. */
function Panel({ id, title, children, width = 380 }: { id: keyof typeof PANELS; title: string; children: ReactNode; width?: number }) {
  const p = PANELS[id], { rotY } = facing(p);
  const active = useStore((s) => s.station === id);
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <Html transform distanceFactor={1.5} zIndexRange={[20, 0]}>
        <section className={`holo-panel ${active ? 'is-active' : ''}`} style={{ width, zoom: 2 }} aria-label={title}>
          <button type="button" className="holo-title" onClick={() => useStore.getState().set({ station: active ? 'overview' : id })} aria-pressed={active}>
            <span>{title}</span><span aria-hidden>{active ? 'step back' : 'fly here'}</span>
          </button>
          <div className="holo-body">{children}</div>
        </section>
      </Html>
    </group>
  );
}

function Scene({ data, site, target, tiles, extentM }: { data: SitesJson; site: Site; target: Target; tiles: { earth: TileSet; mars: TileSet } | null; extentM: number }) {
  const E = (extentM || 3000) * KM, segments = useMemo(() => (isSmall() ? 127 : 255), []);
  const si = siteIndex(data, site.id), W = bodyName(target);
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
      <Constellation data={data} target={target} siteId={site.id} />

      <Panel id="mission" title="Mission">
        <p className="holo-k">Target · {W}</p>
        <p className="holo-big">{target.name}</p>
        <p className="holo-k mt-2">Earth site on the table · rank {rank + 1} of {ranked.length}</p>
        <div className="flex items-end justify-between gap-3">
          <p className="holo-big">{site.name}</p>
          <Num path={`sites.${si}.closeness.${target.id}.total`} className="holo-score" />
        </div>
        <p className="holo-dim">{site.region}</p>
        {c?.gate != null && c.gate < 1 && <p className="holo-warn">Vegetation mask applied · score × {c.gate}</p>}
        <div className="mt-2 flex gap-2">
          <button type="button" className="holo-btn" disabled={rank <= 0} onClick={() => go(ranked[rank - 1].id)}>Closer match</button>
          <button type="button" className="holo-btn" disabled={rank >= ranked.length - 1} onClick={() => go(ranked[rank + 1].id)}>Next match</button>
        </div>
        <ol className="mt-2">
          {ranked.slice(0, 6).map((s, i) => (
            <li key={s.id}><button type="button" onClick={() => go(s.id)} className={`holo-row ${s.id === site.id ? 'is-on' : ''}`}>
              <span><span className="holo-dim mr-2">{String(i + 1).padStart(2, '0')}</span>{s.name}</span><span className="tabular-nums">{s.closeness[target.id]?.total}</span>
            </button></li>
          ))}
        </ol>
      </Panel>

      <Panel id="fingerprint" title="Fingerprint">
        {a && b ? <div className="flex justify-center"><Fingerprint a={a} b={b} size={300} labels title={`${site.name} over ${target.name}`} /></div> : <p className="holo-dim">No parameter set.</p>}
        <div className="grid grid-cols-5 gap-1">
          {PILLARS.map((p) => { const v = c?.pillars?.[p.id]; return (
            <div key={p.id} className="holo-tile"><span className="holo-k">{p.short}</span><span className="holo-num">{v == null ? '—' : v}</span><span className="block h-0.5" style={{ background: p.colour, width: `${v ?? 0}%` }} /></div>
          ); })}
        </div>
        <p className="holo-dim mt-2"><span className="text-earth">■ Earth</span> · <span className="text-mars">■ {W}</span> · radius = percentile within its own planet</p>
      </Panel>

      <Panel id="permits" title="Field-test permits">
        {verdicts ? (['driving', 'landing', 'thermal'] as Scenario[]).map((sc) => { const v = verdicts[sc], p = PERMIT[v.level]; return (
          <div key={sc} className="holo-permit">
            <span className="stamp !rotate-0" style={{ color: p.colour, borderColor: p.colour }}>{p.word}</span>
            <p className="holo-k mt-1 !text-ink">{SCENARIO_TITLE[sc]}</p>
            <p className="text-sm">{v.rule}</p>
          </div>
        ); }) : <p className="holo-dim">No verdicts for this pair.</p>}
        <button type="button" className="holo-btn mt-2" onClick={() => open('trial')}>Run the rover trial</button>
      </Panel>

      <Panel id="bench" title="Test bench">
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

      <Html position={[0, 6.9, 0]} center zIndexRange={[10, 0]}><p className="holo-dim pointer-events-none whitespace-nowrap max-md:hidden">parameter space · {data.sites.length} sites · lines join {target.name} to its nearest five · click a star to load it</p></Html>
      <OrbitControls makeDefault enablePan={false} minDistance={1.6} maxDistance={16} maxPolarAngle={Math.PI * 0.62} />
      <Rig />
    </>
  );
}

/** The console at the front edge of the table: time, layer and the two day ribbons. Plain DOM, always readable. */
function Console({ site, target }: { site: Site; target: Target }) {
  const hour = useStore((s) => s.hour), playing = useStore((s) => s.playing), layer = useStore((s) => s.layer), station = useStore((s) => s.station);
  const set = useStore((s) => s.set);
  return (
    <div className="table-console">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="table-clock" aria-hidden>{fmtHour(hour)}</span>
        <button type="button" className="holo-btn" onClick={() => set({ playing: !playing })}>{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={24} step={0.05} value={hour} className="scrub min-w-[120px] flex-1" aria-label="Local solar time" aria-valuetext={`${fmtHour(hour)} local solar time`}
          onChange={(e) => { const h = Number(e.target.value) % 24; set({ hour: h, playing: false }); if (h < 4 || h > 21) useProgress.getState().award('flag', 'night'); }} />
        <Seg label="Terrain layer" value={layer} onChange={(v) => set({ layer: v })} options={[{ value: 'temperature', label: 'Temp' }, { value: 'satellite', label: 'Image' }, { value: 'slope', label: 'Slope' }]} />
      </div>
      <div className="mt-2 grid grid-cols-[52px_1fr] items-center gap-x-2 max-md:hidden">
        <span className="caps !text-earth">Earth</span><Ribbon curve={site.curve} source={site.curve_source} swingPct={site.features.amplitude_pct} label={`${site.name} thermal day`} />
        <span className="caps !text-mars">{bodyName(target)}</span><Ribbon curve={target.curve} source={target.curve_source} swingPct={target.features.amplitude_pct} label={`${target.name} thermal day`} />
      </div>
      <nav className="mt-2 flex gap-1 overflow-x-auto whitespace-nowrap md:flex-wrap" aria-label="Stations">
        {ORDER.map((id, i) => (
          <button key={id} type="button" className="holo-btn" aria-pressed={station === id} onClick={() => set({ station: id })}><span className="opacity-60">{i + 1}</span> {STATIONS[id].name}</button>
        ))}
      </nav>
    </div>
  );
}

export function TableView() {
  const params = useParams();
  const dataAll = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const fallback = rankedSites(dataAll, dataAll.targets.find((t) => t.id === targetId)?.id ?? dataAll.targets[0].id).find((s) => s.kind === 'candidate')?.id;
  const siteId = params.siteId ?? fallback;
  const { data, site, target, tiles, extentM } = useSeam(siteId);
  const sid = site?.id, sname = site?.name;
  useEffect(() => { if (sid) { useProgress.getState().say(`On the table · ${sname}`); useProgress.getState().award('survey', sid); } }, [sid, sname]);
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
  if (!site) return <NotFound what="Site" />;
  return (
    <div className="table-room">
      <Canvas camera={{ position: OVERVIEW, fov: 40, near: 0.05, far: 200 }} dpr={[1, isSmall() ? 1.5 : 2]} aria-label="Holographic table: Earth and target terrain with floating panels">
        <color attach="background" args={['#05070a']} />
        <fog attach="fog" args={['#05070a', 14, 34]} />
        <Scene data={data} site={site} target={target} tiles={tiles} extentM={extentM} />
      </Canvas>
      {!tiles && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-mono text-sm text-dim">Projecting terrain…</p>}
      <Console site={site} target={target} />
    </div>
  );
}
