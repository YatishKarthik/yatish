import { Html, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import { asset } from '../data/load';
import { rankedSites, siteIndex, targetIndex } from '../data/select';
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Clouds, EarthMaterial, SUN_DIR, Sun } from '../scenes/Earth';
import { Atmosphere, Galaxy } from '../scenes/Galaxy';
import { PARAMS } from '../data/pillars';
import { useProgress } from '../state/progress';
import { useStore, withTarget } from '../state/store';
import { Num } from '../ui/Num';
import { Seg } from '../ui/Seg';

type Body = 'earth' | 'mars' | 'moon';
type Focus = Body | null;
interface Pin { id: string; label: string; sub?: string; lat: number; lon: number; active?: boolean; onPick: () => void }

const BODIES: Record<Body, { x: number; r: number; name: string; glow: string; k: number }> = {
  earth: { x: -3.5, r: 1.3, name: 'Earth', glow: '#5fb0ff', k: 0.9 },
  mars: { x: 0.35, r: 0.95, name: 'Mars', glow: '#ffb089', k: 0.22 },
  moon: { x: 3.1, r: 0.6, name: 'Moon', glow: '#ffffff', k: 0 },
};
const REDUCE = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// post-processing only where it will hold frame rate
const POST = typeof window !== 'undefined' && window.innerWidth >= 800 && (navigator.hardwareConcurrency ?? 8) >= 4;
const DEG = Math.PI / 180;

/** Point on a unit sphere textured with an equirectangular map whose centre is longitude 0. */
function onSphere(lat: number, lon: number, r: number): [number, number, number] {
  const phi = (90 - lat) * DEG, theta = (lon + 180) * DEG;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}
const lerpAngle = (a: number, b: number, k: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;

function PinMark({ pin, r }: { pin: Pin; r: number }) {
  const pos = useMemo(() => onSphere(pin.lat, pin.lon, r * 1.01), [pin.lat, pin.lon, r]);
  const el = useRef<HTMLButtonElement>(null);
  const v = useMemo(() => new THREE.Vector3(), []);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (!mesh.current || !el.current) return;
    // hide the label when its point has turned to the far side
    mesh.current.getWorldPosition(v);
    const centre = mesh.current.parent!.getWorldPosition(new THREE.Vector3());
    const facing = v.clone().sub(centre).normalize().dot(camera.position.clone().sub(centre).normalize());
    el.current.style.opacity = facing > 0.15 ? '1' : '0';
    el.current.style.pointerEvents = facing > 0.15 ? 'auto' : 'none';
  });
  return (
    <mesh ref={mesh} position={pos}>
      <sphereGeometry args={[r * 0.006, 12, 12]} />
      <meshBasicMaterial color={pin.active ? '#9fe8ff' : '#e6e9ef'} />
      <Html center zIndexRange={[20, 0]}>
        <button ref={el} type="button" onClick={pin.onPick} className={`hud-pin ${pin.active ? 'is-active' : ''}`}>
          <span className="hud-bracket" aria-hidden />
          <span className="hud-tag">{pin.label}{pin.sub && <span className="hud-sub">{pin.sub}</span>}</span>
        </button>
      </Html>
    </mesh>
  );
}

/** One expanding ring when a body is selected: the console 'scanning' it. */
function ScanPulse({ r, trigger }: { r: number; trigger: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const t0 = useRef(-1);
  useEffect(() => { t0.current = performance.now(); }, [trigger]);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const k = REDUCE ? 1 : (performance.now() - t0.current) / 900;
    m.visible = k >= 0 && k < 1;
    if (!m.visible) return;
    const sc = 1 + k * 1.6;
    m.scale.set(sc, sc, sc);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
  });
  return (
    <mesh ref={mesh} visible={false}>
      <ringGeometry args={[r * 0.99, r * 1.01, 128]} />
      <meshBasicMaterial color="#8fe3ff" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Planet({ body, focus, pins, face, onPick, labels = true }: { body: Body; focus: Focus; pins: Pin[]; face: { lat: number; lon: number } | null; onPick: () => void; labels?: boolean }) {
  const { x, r, name, glow, k: glowK } = BODIES[body];
  const tex = useTexture(asset(`textures/${body}.jpg`));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  const bump = useTexture(asset(`textures/${body}.jpg`));   // planet maps double as faint relief
  const group = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const focused = focus === body;
  const drag = useRef({ on: false, manual: false, moved: 0 });
  const faceKey = face ? `${face.lat},${face.lon}` : '';
  useEffect(() => { drag.current.manual = false; }, [faceKey, focused]);
  const [scan, setScan] = useState(0);
  useEffect(() => { if (focused) setScan((n) => n + 1); }, [focused]);
  useEffect(() => { if (group.current) group.current.rotation.y = (-90 - (body === 'earth' ? 45 : 0)) * DEG; }, [body]);   // Earth opens on the Gulf
  useEffect(() => { document.body.style.cursor = hover && !focused ? 'pointer' : ''; return () => { document.body.style.cursor = ''; }; }, [hover, focused]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    if (drag.current.on || (focused && drag.current.manual)) return;   // the visitor is turning it by hand
    if (focused && face) {
      // the planet turns until the chosen place faces the camera
      const k = REDUCE ? 1 : Math.min(1, dt * 3);
      g.rotation.y = lerpAngle(g.rotation.y, (-90 - face.lon) * DEG, k);
      g.rotation.x += (Math.min(50, Math.max(-50, face.lat)) * DEG * 0.8 - g.rotation.x) * k;
    } else if (!REDUCE) {
      g.rotation.y += dt * (hover ? 0.5 : 0.06);
      g.rotation.x += (0 - g.rotation.x) * Math.min(1, dt * 2);
    }
  });

  return (
    <group position={[x, 0, 0]}>
      {glowK > 0 && <Atmosphere r={r} colour={glow} strength={glowK} />}
      <ScanPulse r={r} trigger={scan} />
      <group ref={group}>
        <mesh
          onClick={(e) => { e.stopPropagation(); if (drag.current.moved < 6) onPick(); }}
          onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}
          onPointerDown={(e) => { if (!focused) return; e.stopPropagation(); drag.current.on = true; drag.current.moved = 0; (e.target as Element).setPointerCapture?.(e.pointerId); }}
          onPointerUp={(e) => { drag.current.on = false; (e.target as Element).releasePointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => {
            const g = group.current;
            if (!drag.current.on || !g) return;
            const dx = e.nativeEvent.movementX, dy = e.nativeEvent.movementY;
            drag.current.moved += Math.abs(dx) + Math.abs(dy);
            if (drag.current.moved > 6) drag.current.manual = true;
            g.rotation.y += dx * 0.006;
            g.rotation.x = Math.min(1.2, Math.max(-1.2, g.rotation.x + dy * 0.006));
          }}>
          <sphereGeometry args={[r, 160, 112]} />
          {body === 'earth' ? <EarthMaterial /> : <meshStandardMaterial map={tex} bumpMap={bump} bumpScale={body === 'moon' ? 0.02 : 0.012} roughness={0.95} metalness={0} />}
        </mesh>
        {body === 'earth' && <Clouds r={r} />}
        {focused && pins.map((p) => <PinMark key={p.id} pin={p} r={r} />)}
      </group>
      {!focus && labels && (
        <Html position={[0, -r - 0.28, 0]} center zIndexRange={[10, 0]}>
          <button type="button" onClick={onPick} className="head whitespace-nowrap px-2 py-1 hover:text-ink">{name}</button>
        </Html>
      )}
    </group>
  );
}

/** Thin orbit arcs through the three bodies: console plotting, not to scale. Fade away when a body is in focus. */
function OrbitLines({ focus }: { focus: Focus }) {
  const group = useRef<THREE.Group>(null);
  const lines = useMemo(() => Object.values(BODIES).map((b) => {
    const R = Math.abs(b.x) + 8.5, pts = new THREE.EllipseCurve(-6.5 + (b.x < 0 ? 0 : 0), 0, R, R * 0.32, 0, Math.PI * 2, false, 0).getPoints(240);
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y * 0.6, -p.y * 0.8)));
    return g;
  }), []);
  useFrame((_, dt) => {
    if (!group.current) return;
    if (!REDUCE) group.current.rotation.y += dt * 0.012;   // the plot itself turns slowly
    group.current.children.forEach((c) => {
      const m = (c as THREE.Line).material as THREE.LineBasicMaterial;
      m.opacity += ((focus ? 0 : 0.16) - m.opacity) * Math.min(1, dt * 4);
    });
  });
  return (
    <group ref={group} position={[0, -0.4, -1.2]}>
      {lines.map((g, i) => <primitive key={i} object={new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0, depthWrite: false }))} />)}
    </group>
  );
}

/** Wide view of all three, or a close view with the chosen body on the left. The lens tightens as it moves in. */
function Rig({ focus }: { focus: Focus }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => { mouse.current = { x: e.clientX / window.innerWidth - 0.5, y: e.clientY / window.innerHeight - 0.5 }; };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  useFrame((_, dt) => {
    const narrow = size.width < 800;
    const want = new THREE.Vector3(0, 0.4, narrow ? 24 : 15.5), at = new THREE.Vector3(0, 0, 0);
    let fov = 26;
    if (focus) {
      const b = BODIES[focus], off = narrow ? 0 : b.r * 0.75;
      want.set(b.x + off, b.r * 0.12, b.r * (narrow ? 7.2 : 5.0));
      at.set(b.x + off, 0, 0);
      fov = 22;
    }
    const k = REDUCE ? 1 : Math.min(1, dt * 2.6);
    if (!REDUCE) {
      const t = performance.now() / 1000;
      want.x += Math.sin(t * 0.23) * 0.12 + mouse.current.x * (focus ? 0.25 : 0.6);   // slow float plus a little parallax
      want.y += Math.sin(t * 0.31) * 0.08 - mouse.current.y * (focus ? 0.15 : 0.35);
    }
    camera.position.lerp(want, k);
    look.current.lerp(at, k);
    camera.lookAt(look.current);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * k; camera.updateProjectionMatrix(); }
  });
  return null;
}

export function SystemView() {
  const data = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const setTarget = useStore((s) => s.setTarget);
  const [focus, setFocus] = useState<Focus>(null);
  const [dest, setDest] = useState<'mars' | 'moon'>('mars');
  const [hoverSite, setHoverSite] = useState<string | null>(null);
  const [titled, setTitled] = useState(() => { try { return /[?&](nointro|director)/.test(window.location.search) || sessionStorage.getItem('tt-title') === '1'; } catch { return true; } });
  const enter = (story: boolean) => { try { sessionStorage.setItem('tt-title', '1'); } catch { /* ignore */ } setTitled(true); if (story) useProgress.getState().setStory(0); };
  const story = useProgress((s) => s.story);
  const real = data.sites.reduce((n, s) => n + Object.values(s.params ?? {}).filter((v) => v.source === 'measured' || v.source === 'reanalysis').length, 0);
  const [jump, setJump] = useState(0);
  const go = (f: Focus) => { setFocus(f); setJump((n) => n + 1); };
  const target = data.targets[Math.max(0, targetIndex(data, targetId))];
  const ranked = rankedSites(data, target.id);
  const lunar = data.targets.filter((t) => t.body === 'moon');
  const martian = data.targets.filter((t) => t.body === 'mars');

  const marsPins: Pin[] = martian.map((t) => ({ id: t.id, label: t.name, sub: t.class?.name, lat: t.lat, lon: t.lon, active: t.id === target.id, onPick: () => { setTarget(t.id); go('earth'); } }));
  const moonPins: Pin[] = lunar.map((t) => ({ id: t.id, label: t.name, sub: t.class?.name, lat: t.lat, lon: t.lon, active: t.id === target.id, onPick: () => { setTarget(t.id); go('earth'); } }));
  const earthPins: Pin[] = ranked.slice(0, 15).map((s, i) => ({ id: s.id, label: String(i + 1).padStart(2, '0'), sub: String(s.closeness[target.id]?.total ?? ''), lat: s.centroid.lat, lon: s.centroid.lon, active: s.id === hoverSite, onPick: () => setHoverSite(s.id) }));

  const mean = (xs: { lat: number; lon: number }[]) => (xs.length ? { lat: xs.reduce((a, b) => a + b.lat, 0) / xs.length, lon: xs.reduce((a, b) => a + b.lon, 0) / xs.length } : null);
  const face: Record<Body, { lat: number; lon: number } | null> = {
    earth: ranked[0]?.centroid ?? null,
    mars: target.body === 'mars' ? { lat: target.lat, lon: target.lon } : mean(martian),
    moon: target.body === 'moon' ? { lat: target.lat, lon: target.lon } : mean(lunar) ?? { lat: -60, lon: 0 },
  };
  const pick = (b: Body) => { go(b); if (b !== 'earth') setDest(b); };

  return (
    <div className="relative h-[calc(100vh-53px)] min-h-[520px] overflow-hidden">
      <Canvas style={{ filter: 'saturate(1.15) contrast(1.04)' }} camera={{ position: [0, 0.4, 15.5], fov: 26, near: 0.1, far: 300 }} dpr={[1, 2]}
        aria-label="Earth, Mars and the Moon. Choose a destination, then find matching ground on Earth.">
        <hemisphereLight args={['#c9d8ff', '#0a0806', 0.55]} />
        <directionalLight position={[SUN_DIR.x * 10, SUN_DIR.y * 10, SUN_DIR.z * 10]} intensity={3.8} color="#fff6ea" />
        <directionalLight position={[6, -2, -6]} intensity={0.22} color="#8fa8ff" />
        <Sun />
        <Galaxy />
        <OrbitLines focus={focus} />
        <Suspense fallback={null}>
          <Planet body="earth" focus={focus} pins={earthPins} face={face.earth} onPick={() => pick('earth')} labels={titled || story != null} />
          <Planet body="mars" focus={focus} pins={marsPins} face={face.mars} onPick={() => pick('mars')} labels={titled || story != null} />
          <Planet body="moon" focus={focus} pins={moonPins} face={face.moon} onPick={() => pick('moon')} labels={titled || story != null} />
        </Suspense>
        <Rig focus={focus} />
        {POST && (
          <EffectComposer multisampling={0}>
            <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.2} intensity={0.6} mipmapBlur radius={0.55} />
            <Vignette eskil={false} offset={0.25} darkness={0.55} />
            <SMAA />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Canvas>

      <div key={jump} className="warp" aria-hidden />

      {!titled && story == null && (
        <div className="title-screen" role="dialog" aria-label="Thermal Twin">
          <div className="title-lockup rise">
            <p className="caps !text-[#8fe3ff]">NASA Space Apps 2026 · analog site finder</p>
            <h1 className="title-word">THERMAL<br />TWIN</h1>
            <p className="mt-3 max-w-md text-base">Find the places on Earth where the ground behaves like the Moon and Mars, then test what survives the trip.</p>
            <dl className="title-stats">
              <div><dt>Earth sites</dt><dd>{data.sites.length}</dd></div>
              <div><dt>Targets</dt><dd>{data.targets.length}</dd></div>
              <div><dt>Parameters</dt><dd>{PARAMS.length}</dd></div>
              <div><dt>Real values</dt><dd>{real.toLocaleString('en-US')}</dd></div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary !min-h-[44px] !px-5" onClick={() => enter(true)}>Begin mission</button>
              <button type="button" className="btn !min-h-[44px] !px-5" onClick={() => enter(false)}>Explore freely</button>
            </div>
          </div>
        </div>
      )}

      <div className={`pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-5 ${!titled && story == null ? 'hidden' : ''}`}>
        <ol className="hud pointer-events-auto" aria-label="Mission steps">
          <li className={`hud-step ${focus === null || focus === 'mars' || focus === 'moon' ? 'is-on' : 'is-done'}`}>
            <span className="hud-n">01</span>
            <span className="hud-k">Destination</span>
            <span className="hud-v"><Seg label="Destination" value={dest} onChange={(v) => { setDest(v); go(v); }} options={[{ value: 'mars', label: 'Mars' }, { value: 'moon', label: 'Moon' }]} /></span>
          </li>
          <li className={`hud-step ${focus === 'mars' || focus === 'moon' ? 'is-on' : focus === 'earth' ? 'is-done' : ''}`}>
            <span className="hud-n">02</span>
            <span className="hud-k">Target site</span>
            <span className="hud-v">{target.body === dest ? target.name : 'pick one on the globe'}</span>
          </li>
          <li className={`hud-step ${focus === 'earth' ? 'is-on' : ''}`}>
            <span className="hud-n">03</span>
            <span className="hud-k">Earth ground that behaves like it</span>
            <span className="hud-v">{ranked[0] ? <>{ranked[0].name} · <Num path={`sites.${siteIndex(data, ranked[0].id)}.closeness.${target.id}.total`} /></> : '—'}</span>
          </li>
        </ol>
        {focus && <button type="button" className="btn pointer-events-auto" onClick={() => go(null)}>All three</button>}
      </div>

      {!focus && titled && story == null && <p className="caps pointer-events-none absolute inset-x-0 bottom-5 text-center">Same ground test, three worlds · choose a body · not to scale</p>}
      {focus === 'earth' && <p className="caps pointer-events-none absolute bottom-5 left-5 max-w-[48%]">Ranked by day–night temperature curve, slope, roughness and minerals · nothing is scored in the browser</p>}

      {focus && (
        <aside className="rise absolute bottom-5 right-5 top-20 flex w-[360px] max-w-[calc(100%-40px)] flex-col gap-3 overflow-y-auto max-md:top-auto max-md:max-h-[46%]" key={focus} aria-label={`${BODIES[focus].name} panel`}>
          {focus === 'mars' && (
            <div className="console p-3">
              <h2 className="head mb-2">Mars targets</h2>
              <ul className="space-y-1">
                {martian.map((t) => (
                  <li key={t.id}>
                    <button type="button" aria-pressed={t.id === target.id} onClick={() => { setTarget(t.id); go('earth'); }}
                      className={`row w-full border border-line px-3 py-2 text-left ${t.id === target.id ? '!border-ink' : ''}`}>
                      <span className="block font-semibold">{t.name}</span>
                      <span className="block text-sm text-dim">{t.why}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="caps mt-2">Pick one to see its matches on Earth</p>
            </div>
          )}
          {focus === 'moon' && (
            <div className="console p-3">
              <h2 className="head mb-2">Lunar targets</h2>
              {lunar.length
                ? <ul className="space-y-1">{lunar.map((t) => <li key={t.id}><button type="button" aria-pressed={t.id === target.id} className={`row w-full border border-line px-3 py-2 text-left ${t.id === target.id ? '!border-ink' : ''}`} onClick={() => { setTarget(t.id); go('earth'); }}><span className="block font-semibold">{t.name}</span><span className="block text-sm text-dim">{t.why}</span></button></li>)}</ul>
                : <p className="text-sm text-dim">No lunar targets in this data yet. Shackleton rim is planned.</p>}
              {!lunar.length && <button type="button" className="btn mt-3" onClick={() => { setDest('mars'); go('mars'); }}>Go to Mars</button>}
            </div>
          )}
          {focus === 'earth' && (
            <div className="console p-3">
              <h2 className="head mb-1">Ground like {target.name}</h2>
              <p className="caps mb-2">top 10 of {ranked.length} by closeness</p>
              <ol className="space-y-1">
                {ranked.slice(0, 10).map((s, i) => (
                  <li key={s.id}>
                    <Link to={withTarget(`/table/${s.id}`)} onPointerEnter={() => setHoverSite(s.id)} onFocus={() => setHoverSite(s.id)}
                      className={`row flex items-center justify-between gap-3 border border-line px-3 py-2 ${hoverSite === s.id ? '!border-ink' : ''}`}>
                      <span>
                        <span className="mr-2 font-mono text-sm text-dim">{String(i + 1).padStart(2, '0')}</span>
                        <span className="font-semibold">{s.name}</span>
                        <span className="block text-sm text-dim">{s.region}</span>
                      </span>
                      <Num path={`sites.${siteIndex(data, s.id)}.closeness.${target.id}.total`} className="text-lg" />
                    </Link>
                  </li>
                ))}
              </ol>
              <Link to={withTarget('/sol')} className="btn mt-3 w-full">See all {ranked.length} and their thermal days</Link>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
