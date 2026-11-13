import { Html, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import { asset } from '../data/load';
import { rankedSites, siteIndex, targetIndex } from '../data/select';
import { Atmosphere, Galaxy } from '../scenes/Galaxy';
import { useStore, withTarget } from '../state/store';
import { Num } from '../ui/Num';
import { Seg } from '../ui/Seg';

type Body = 'earth' | 'mars' | 'moon';
type Focus = Body | null;
interface Pin { id: string; label: string; lat: number; lon: number; active?: boolean; onPick: () => void }

const BODIES: Record<Body, { x: number; r: number; name: string; glow: string; k: number }> = {
  earth: { x: -3.5, r: 1.3, name: 'Earth', glow: '#4aa3ff', k: 1.1 },
  mars: { x: 0.35, r: 0.95, name: 'Mars', glow: '#ff7a4a', k: 0.8 },
  moon: { x: 3.1, r: 0.6, name: 'Moon', glow: '#cfd8ff', k: 0.45 },
};
const REDUCE = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      <sphereGeometry args={[r * 0.008, 12, 12]} />
      <meshBasicMaterial color={pin.active ? '#ffffff' : '#e6e9ef'} />
      <Html center zIndexRange={[20, 0]}>
        <button ref={el} type="button" onClick={pin.onPick}
          className={`ml-2 -translate-y-1/2 translate-x-1/2 whitespace-nowrap border px-1.5 py-0.5 font-mono text-xs ${pin.active ? 'z-10 border-ink bg-ink text-page' : 'border-line bg-page text-dim hover:text-ink'}`}>
          {pin.label}
        </button>
      </Html>
    </mesh>
  );
}

function Planet({ body, focus, pins, face, onPick }: { body: Body; focus: Focus; pins: Pin[]; face: { lat: number; lon: number } | null; onPick: () => void }) {
  const { x, r, name, glow, k: glowK } = BODIES[body];
  const tex = useTexture(asset(`textures/${body}.jpg`));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const group = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const focused = focus === body;
  useEffect(() => { document.body.style.cursor = hover && !focused ? 'pointer' : ''; return () => { document.body.style.cursor = ''; }; }, [hover, focused]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
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
      <Atmosphere r={r} colour={glow} strength={glowK} />
      <group ref={group}>
        <mesh onClick={(e) => { e.stopPropagation(); onPick(); }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
          <sphereGeometry args={[r, 96, 64]} />
          <meshStandardMaterial map={tex} roughness={1} metalness={0} />
        </mesh>
        {focused && pins.map((p) => <PinMark key={p.id} pin={p} r={r} />)}
      </group>
      {!focus && (
        <Html position={[0, -r - 0.28, 0]} center zIndexRange={[10, 0]}>
          <button type="button" onClick={onPick} className="head whitespace-nowrap px-2 py-1 hover:text-ink">{name}</button>
        </Html>
      )}
    </group>
  );
}

/** Wide view of all three, or a close view with the chosen body on the left. The lens tightens as it moves in. */
function Rig({ focus }: { focus: Focus }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const look = useRef(new THREE.Vector3(0, 0, 0));
  useFrame((_, dt) => {
    const narrow = size.width < 800;
    const want = new THREE.Vector3(0, 0.5, narrow ? 17 : 10.5), at = new THREE.Vector3(0, 0, 0);
    let fov = 38;
    if (focus) {
      const b = BODIES[focus], off = narrow ? 0 : b.r * 0.75;
      want.set(b.x + off, b.r * 0.15, b.r * (narrow ? 5.2 : 3.6));
      at.set(b.x + off, 0, 0);
      fov = 30;
    }
    const k = REDUCE ? 1 : Math.min(1, dt * 2.6);
    if (!REDUCE) { const t = performance.now() / 1000; want.x += Math.sin(t * 0.23) * 0.12; want.y += Math.sin(t * 0.31) * 0.08; }   // slow float
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
  const target = data.targets[Math.max(0, targetIndex(data, targetId))];
  const ranked = rankedSites(data, target.id);
  const lunar = data.targets.filter((t) => t.body === 'moon');
  const martian = data.targets.filter((t) => t.body === 'mars');

  const marsPins: Pin[] = martian.map((t) => ({ id: t.id, label: t.name, lat: t.lat, lon: t.lon, active: t.id === target.id, onPick: () => { setTarget(t.id); setFocus('earth'); } }));
  const moonPins: Pin[] = lunar.map((t) => ({ id: t.id, label: t.name, lat: t.lat, lon: t.lon, active: t.id === target.id, onPick: () => { setTarget(t.id); setFocus('earth'); } }));
  const earthPins: Pin[] = ranked.slice(0, 15).map((s, i) => ({ id: s.id, label: String(i + 1).padStart(2, '0'), lat: s.centroid.lat, lon: s.centroid.lon, active: s.id === hoverSite, onPick: () => setHoverSite(s.id) }));

  const mean = (xs: { lat: number; lon: number }[]) => (xs.length ? { lat: xs.reduce((a, b) => a + b.lat, 0) / xs.length, lon: xs.reduce((a, b) => a + b.lon, 0) / xs.length } : null);
  const face: Record<Body, { lat: number; lon: number } | null> = {
    earth: ranked[0]?.centroid ?? null,
    mars: target.body === 'mars' ? { lat: target.lat, lon: target.lon } : mean(martian),
    moon: target.body === 'moon' ? { lat: target.lat, lon: target.lon } : mean(lunar) ?? { lat: -60, lon: 0 },
  };
  const pick = (b: Body) => { setFocus(b); if (b !== 'earth') setDest(b); };

  return (
    <div className="relative h-[calc(100vh-53px)] min-h-[520px] overflow-hidden">
      <Canvas style={{ filter: 'saturate(1.45) contrast(1.06)' }} camera={{ position: [0, 0.5, 10.5], fov: 38, near: 0.1, far: 300 }} dpr={[1, 2]}
        aria-label="Earth, Mars and the Moon. Choose a destination, then find matching ground on Earth.">
        <ambientLight intensity={0.7} />
        <directionalLight position={[-3, 3, 10]} intensity={3.0} color="#fff4e6" />
        <Galaxy />
        <Suspense fallback={null}>
          <Planet body="earth" focus={focus} pins={earthPins} face={face.earth} onPick={() => pick('earth')} />
          <Planet body="mars" focus={focus} pins={marsPins} face={face.mars} onPick={() => pick('mars')} />
          <Planet body="moon" focus={focus} pins={moonPins} face={face.moon} onPick={() => pick('moon')} />
        </Suspense>
        <Rig focus={focus} />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="pointer-events-auto">
          <h1 className="head">Where are you going?</h1>
          <div className="mt-2">
            <Seg label="Destination" value={dest} onChange={(v) => { setDest(v); setFocus(v); }} options={[{ value: 'mars', label: 'Mars' }, { value: 'moon', label: 'Moon' }]} />
          </div>
        </div>
        {focus && <button type="button" className="btn pointer-events-auto" onClick={() => setFocus(null)}>All three</button>}
      </div>

      {!focus && <p className="caps pointer-events-none absolute inset-x-0 bottom-5 text-center">Choose a body · not to scale</p>}

      {focus && (
        <aside className="rise absolute bottom-5 right-5 top-20 flex w-[360px] max-w-[calc(100%-40px)] flex-col gap-3 overflow-y-auto max-md:top-auto max-md:max-h-[46%]" key={focus} aria-label={`${BODIES[focus].name} panel`}>
          {focus === 'mars' && (
            <div className="panel p-3">
              <h2 className="head mb-2">Mars targets</h2>
              <ul className="space-y-1">
                {martian.map((t) => (
                  <li key={t.id}>
                    <button type="button" aria-pressed={t.id === target.id} onClick={() => { setTarget(t.id); setFocus('earth'); }}
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
            <div className="panel p-3">
              <h2 className="head mb-2">Lunar targets</h2>
              {lunar.length
                ? <ul className="space-y-1">{lunar.map((t) => <li key={t.id}><button type="button" aria-pressed={t.id === target.id} className={`row w-full border border-line px-3 py-2 text-left ${t.id === target.id ? '!border-ink' : ''}`} onClick={() => { setTarget(t.id); setFocus('earth'); }}><span className="block font-semibold">{t.name}</span><span className="block text-sm text-dim">{t.why}</span></button></li>)}</ul>
                : <p className="text-sm text-dim">No lunar targets in this data yet. Shackleton rim is planned.</p>}
              {!lunar.length && <button type="button" className="btn mt-3" onClick={() => { setDest('mars'); setFocus('mars'); }}>Go to Mars</button>}
            </div>
          )}
          {focus === 'earth' && (
            <div className="panel p-3">
              <h2 className="head mb-1">Ground like {target.name}</h2>
              <p className="caps mb-2">top 10 of {ranked.length} by closeness</p>
              <ol className="space-y-1">
                {ranked.slice(0, 10).map((s, i) => (
                  <li key={s.id}>
                    <Link to={withTarget(`/seam/${s.id}`)} onPointerEnter={() => setHoverSite(s.id)} onFocus={() => setHoverSite(s.id)}
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
