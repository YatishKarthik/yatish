import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { cropPoint, heightAt, slopeAt, type TileSet } from '../data/tiles';
import type { World } from '../data/types';
import { sampleAt, type TrialResult } from '../sim/rover';
import { useStore, type Mode } from '../state/store';
import { buildTerrainGeometry, cropBase, EXAG, KM, makeTerrainMaterial, sceneY, sunAt } from './terrain';

export interface TrialRun { earth: TrialResult; mars: TrialResult; lengthM: number }
interface Props {
  earth: TileSet; mars: TileSet; extentM: number; mode: Mode;
  earthLabel: string; marsLabel: string;
  trial?: TrialRun;
}

const isSmall = () => typeof window !== 'undefined' && (window.innerWidth < 800 || (navigator.hardwareConcurrency ?? 8) < 4);

function Half({ world, tiles, extentM, offsetX, mode, segments, trialMode }: {
  world: World; tiles: TileSet; extentM: number; offsetX: number; mode: Mode; segments: number; trialMode: boolean;
}) {
  const E = extentM * KM;
  const geom = useMemo(() => buildTerrainGeometry(tiles.hf, extentM, segments), [tiles, extentM, segments]);
  const mat = useMemo(() => makeTerrainMaterial(tiles, extentM, world === 'earth' ? -1 : 1), [tiles, extentM, world]);
  const sun = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => { geom.dispose(); mat.dispose(); }, [geom, mat]);

  useFrame((state, delta) => {
    const s = useStore.getState(), u = mat.uniforms;
    u.uHour.value = s.hour;
    u.uDay.value = sunAt(s.hour, sun);
    (u.uSun.value as THREE.Vector3).copy(sun);
    u.uSeamX.value = (s.seam - 0.5) * E;
    u.uSide.value = mode === 'wipe' ? (world === 'earth' ? -1 : 1) : 0;
    u.uGrid.value = s.grid ? 1 : 0;
    const want = s.layer === 'satellite' ? 1 : 0;
    if (Math.abs(want - u.uSatMix.value) > 0.004) {
      u.uSatMix.value += (want - u.uSatMix.value) * Math.min(1, delta * 10);   // ~300 ms crossfade
      state.invalidate();
    } else u.uSatMix.value = want;
  });

  const toCrop = (p: THREE.Vector3): [number, number] => [(p.x - offsetX) / E + 0.5, p.z / E + 0.5];
  const visibleAt = (p: THREE.Vector3) => {
    if (mode !== 'wipe') return true;
    const seamX = (useStore.getState().seam - 0.5) * E;
    return world === 'earth' ? p.x <= seamX : p.x >= seamX;
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!visibleAt(e.point)) return;
    e.stopPropagation();
    const [u, v] = toCrop(e.point);
    const [xm, ym] = cropPoint(tiles.hf, extentM, u, v);
    useStore.getState().set({ hover: { world, slopeDeg: slopeAt(tiles.hf, xm, ym), heightM: heightAt(tiles.hf, xm, ym) } });
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!trialMode || e.delta > 4) return;
    e.stopPropagation();
    const [u, v] = toCrop(e.point).map((x) => Math.min(0.97, Math.max(0.03, x))) as [number, number];
    const { trial, setTrial } = useStore.getState();
    const da = Math.hypot(u - trial.a[0], v - trial.a[1]), db = Math.hypot(u - trial.b[0], v - trial.b[1]);
    setTrial(da < db ? { a: [u, v], t: 0, running: false } : { b: [u, v], t: 0, running: false });
  };

  return (
    <group position={[offsetX, 0, 0]}>
      <mesh geometry={geom} material={mat} onPointerMove={onMove} onPointerOut={() => useStore.getState().set({ hover: null })} onClick={onClick} />
    </group>
  );
}

function Rover({ world, tiles, extentM, offsetX, result, lengthM }: {
  world: World; tiles: TileSet; extentM: number; offsetX: number; result: TrialResult; lengthM: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const E = extentM * KM, size = E * 0.022;
  const base = useMemo(() => cropBase(tiles.hf, extentM), [tiles, extentM]);
  const { a, b } = useStore((s) => s.trial);
  const pathPts = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const f = i / 80, u = a[0] + (b[0] - a[0]) * f, v = a[1] + (b[1] - a[1]) * f;
      const [xm, ym] = cropPoint(tiles.hf, extentM, u, v);
      pts.push([(u - 0.5) * E + offsetX, sceneY(heightAt(tiles.hf, xm, ym), base) + E * 0.004, (v - 0.5) * E]);
    }
    return pts;
  }, [a, b, tiles, extentM, E, offsetX, base]);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const st = sampleAt(result, useStore.getState().trial.t);
    const f = lengthM > 0 ? st.dist / lengthM : 0;
    const u = a[0] + (b[0] - a[0]) * f, v = a[1] + (b[1] - a[1]) * f;
    const [xm, ym] = cropPoint(tiles.hf, extentM, u, v);
    g.position.set((u - 0.5) * E + offsetX, sceneY(heightAt(tiles.hf, xm, ym), base) + size * 0.5, (v - 0.5) * E);
    g.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
  });

  const stuck = result.outcome === 'STUCK';
  const body = world === 'earth' ? '#6ea8ff' : '#f2b599';
  return (
    <>
      <Line points={pathPts} color={stuck ? '#f85149' : '#eef0f2'} lineWidth={2} dashed dashSize={E * 0.02} gapSize={E * 0.012} />
      <group ref={ref}>
        <mesh><boxGeometry args={[size * 1.1, size * 0.5, size * 1.6]} /><meshBasicMaterial color={body} /></mesh>
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
          <mesh key={i} position={[sx * size * 0.65, -size * 0.25, sz * size * 0.6]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[size * 0.32, size * 0.32, size * 0.25, 12]} /><meshBasicMaterial color="#eef0f2" />
          </mesh>
        ))}
      </group>
    </>
  );
}

function Seam({ extentM, earthLabel, marsLabel }: { extentM: number; earthLabel: string; marsLabel: string }) {
  const E = extentM * KM;
  const group = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const H = E * 0.16;
  useFrame(() => { if (group.current) group.current.position.x = (useStore.getState().seam - 0.5) * E; });

  const setFromClientX = (clientX: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const px = (x: number) => (new THREE.Vector3(x, 0, E / 2).project(camera).x * 0.5 + 0.5) * rect.width + rect.left;
    const xl = px(-E / 2), xr = px(E / 2);
    if (Math.abs(xr - xl) < 1) return;
    useStore.getState().set({ seam: Math.min(0.85, Math.max(0.15, (clientX - xl) / (xr - xl))) });
  };
  const nudge = (d: number) => { const s = useStore.getState(); s.set({ seam: Math.min(0.85, Math.max(0.15, s.seam + d)) }); };

  return (
    <group ref={group}>
      <mesh position={[0, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[E, H]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[[0, H, -E / 2], [0, H, E / 2], [0, 0, E / 2]]} color="#eef0f2" lineWidth={1.5} transparent opacity={0.7} />
      <Html position={[0, H, E / 2]} center zIndexRange={[20, 0]}>
        <div className="flex -translate-y-5 select-none items-center gap-2 whitespace-nowrap font-mono text-xs">
          <span className="rounded-sm bg-page/80 px-1.5 py-0.5 text-earth">EARTH · {earthLabel}</span>
          <button
            type="button" role="slider" aria-label="Seam position: drag to show more Earth or more Mars"
            aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(useStore.getState().seam * 100)}
            className="seam-handle hide-in-director"
            onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => dragging.current && setFromClientX(e.clientX)}
            onPointerUp={() => { dragging.current = false; }}
            onDoubleClick={() => useStore.getState().set({ seam: 0.5 })}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') nudge(-0.05); if (e.key === 'ArrowRight') nudge(0.05); }}
          >
            ⟷
          </button>
          <span className="rounded-sm bg-page/80 px-1.5 py-0.5 text-mars">MARS · {marsLabel}</span>
        </div>
      </Html>
    </group>
  );
}

function Scene({ earth, mars, extentM, mode, earthLabel, marsLabel, trial }: Props) {
  const E = extentM * KM, gap = E * 0.12;
  const off = mode === 'split' ? E / 2 + gap / 2 : 0;
  const invalidate = useThree((s) => s.invalidate);
  const segments = useMemo(() => (isSmall() ? 127 : 255), []);
  useEffect(() => useStore.subscribe(() => invalidate()), [invalidate]);
  useEffect(() => { invalidate(); }, [invalidate, earth, mars, mode, trial]);

  const span = mode === 'split' ? 2 * E + gap : E;
  return (
    <>
      <Half world="earth" tiles={earth} extentM={extentM} offsetX={-off} mode={mode} segments={segments} trialMode={!!trial} />
      <Half world="mars" tiles={mars} extentM={extentM} offsetX={off} mode={mode} segments={segments} trialMode={!!trial} />
      {mode === 'wipe' && <Seam extentM={extentM} earthLabel={earthLabel} marsLabel={marsLabel} />}
      {mode === 'split' && (
        <>
          <Html position={[-off, E * 0.1, -E / 2]} center zIndexRange={[20, 0]}>
            <div className="-translate-y-3 whitespace-nowrap rounded-sm bg-page/80 px-1.5 py-0.5 font-mono text-xs text-earth">EARTH · {earthLabel}</div>
          </Html>
          <Html position={[off, E * 0.1, -E / 2]} center zIndexRange={[20, 0]}>
            <div className="-translate-y-3 whitespace-nowrap rounded-sm bg-page/80 px-1.5 py-0.5 font-mono text-xs text-mars">MARS · {marsLabel}</div>
          </Html>
        </>
      )}
      {trial && (
        <>
          <Rover world="earth" tiles={earth} extentM={extentM} offsetX={-off} result={trial.earth} lengthM={trial.lengthM} />
          <Rover world="mars" tiles={mars} extentM={extentM} offsetX={off} result={trial.mars} lengthM={trial.lengthM} />
        </>
      )}
      {/* bench plate and a 1 km scale bar on the ground */}
      <mesh position={[0, -E * 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[span * 1.04, E * 1.04]} /><meshBasicMaterial color="#0d0f12" />
      </mesh>
      <mesh position={[-span / 2 + 0.5, 0, E / 2 + E * 0.05]}>
        <boxGeometry args={[1, E * 0.002, E * 0.004]} /><meshBasicMaterial color="#eef0f2" />
      </mesh>
      <Html position={[-span / 2 + 0.5, 0, E / 2 + E * 0.05]} center zIndexRange={[10, 0]}>
        <div className="translate-y-3 whitespace-nowrap font-mono text-xs text-dim">1 km · vertical ×{EXAG}</div>
      </Html>
      <OrbitControls
        makeDefault enablePan={false} target={[0, 0, 0]}
        minPolarAngle={(20 * Math.PI) / 180} maxPolarAngle={(70 * Math.PI) / 180}
        minAzimuthAngle={-Math.PI / 3} maxAzimuthAngle={Math.PI / 3}
        minDistance={span * 0.45} maxDistance={span * 3}
      />
    </>
  );
}

export function SeamCanvas(props: Props) {
  const E = props.extentM * KM, span = props.mode === 'split' ? 2.12 * E : E;
  const far = typeof window !== 'undefined' && window.innerWidth < 800 ? 1.25 : 1;   // narrow screens: step back so the whole tile fits
  return (
    <Canvas
      key={props.mode}
      flat linear legacy frameloop="demand" dpr={[1, isSmall() ? 1.5 : 2]}
      camera={{ position: props.mode === 'split' ? [0, span * 0.6 * far, span * 0.9 * far] : [0, E * 1.0 * far, E * 1.55 * far], fov: 34, near: 0.01, far: 500 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      aria-label="3D terrain: Earth site and Mars target at the same scale, coloured by the current layer"
    >
      <Scene {...props} />
    </Canvas>
  );
}
