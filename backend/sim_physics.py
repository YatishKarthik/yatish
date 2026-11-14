import json
import math
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "backend" / "static" / "assets"
TILES_PATH = ROOT / "data" / "processed" / "tiles.parquet"


class DualPhysicsSimulator:
    def __init__(self):
        self.df = pd.read_parquet(TILES_PATH).set_index("site_id")

    def _load_dem(self, site_id: str) -> tuple[np.ndarray, float]:
        dem_path = ASSETS_DIR / f"{site_id}_dem.json"
        with open(dem_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        grid = np.array(data["data"], dtype=np.float32).reshape(128, 128)
        relief_m = float(data.get("relief_m", 200.0))
        return grid, relief_m

    def _sample_height_and_slope(self, grid: np.ndarray, relief_m: float, gx: float, gy: float) -> tuple[float, float, float]:
        ix = int(np.clip(round(gx), 1, 126))
        iy = int(np.clip(round(gy), 1, 126))
        h = float(grid[iy, ix])

        pixel_m = 2000.0 / 128.0
        dz_dx = ((float(grid[iy, ix + 1]) - float(grid[iy, ix - 1])) * relief_m) / (2.0 * pixel_m)
        dz_dy = ((float(grid[iy + 1, ix]) - float(grid[iy - 1, ix])) * relief_m) / (2.0 * pixel_m)
        slope_deg = float(np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))))
        pitch_rad = float(np.arctan(dz_dx))
        return h, slope_deg, pitch_rad

    def _sim_rover(self, site_id: str, steps: int = 50) -> dict:
        row = self.df.loc[site_id]
        grid, relief_m = self._load_dem(site_id)

        gravity = float(row["gravity_m_s2"])
        sar_rough = float(row["sar_backscatter"])
        bareness = float(row["bareness_index"])

        base_mu = 0.28 + 0.34 * min(gravity / 9.81, 1.0)
        if bareness < 0.3:
            base_mu = 0.18

        pos_x = 18.0
        pos_y = 64.0
        target_end_x = 110.0
        step_dx = (target_end_x - pos_x) / steps

        trajectory = []
        max_slope = 0.0
        max_slip = 0.0
        stalled = False
        stall_reason = ""

        for s in range(steps + 1):
            h, slope_deg, pitch_rad = self._sample_height_and_slope(grid, relief_m, pos_x, pos_y)
            max_slope = max(max_slope, slope_deg)

            slope_rad = math.radians(slope_deg)
            demand = math.tan(slope_rad) + sar_rough * 0.12
            slip_ratio = np.clip((demand / (base_mu + 1e-5)) * 0.45, 0.02, 1.0)
            slip_pct = float(round(slip_ratio * 100.0, 1))
            max_slip = max(max_slip, slip_pct)

            if not stalled:
                if slip_pct >= 88.0:
                    stalled = True
                    stall_reason = f"Wheel slip hit {slip_pct:.0f}% on {slope_deg:.1f} deg slope under {gravity} m/s2 gravity."
                else:
                    advance = step_dx * (1.0 - slip_ratio * 0.65)
                    pos_x = min(target_end_x, pos_x + advance)

            world_x = (pos_x / 127.0) * 14.0 - 7.0
            world_y = (pos_y / 127.0) * 14.0 - 7.0

            trajectory.append({
                "step": s,
                "world_x": round(world_x, 3),
                "world_y": round(world_y, 3),
                "elev_norm": round(h, 4),
                "slope_deg": round(slope_deg, 1),
                "pitch_rad": round(pitch_rad, 3),
                "slip_pct": slip_pct
            })

        progress_pct = round(((pos_x - 18.0) / (target_end_x - 18.0)) * 100.0, 1)
        verdict = "PASS" if (not stalled and progress_pct >= 75.0) else "FAIL"
        summary = (
            f"Traverse completed ({progress_pct:.0f}% distance, max slip {max_slip:.0f}%)."
            if verdict == "PASS"
            else f"ROVER STALLED at {progress_pct:.0f}%: {stall_reason}"
        )

        return {
            "site_id": site_id,
            "verdict": verdict,
            "progress_pct": progress_pct,
            "max_slope_deg": round(max_slope, 1),
            "max_slip_pct": round(max_slip, 1),
            "summary": summary,
            "trajectory": trajectory,
        }

    def _sim_landing(self, site_id: str, steps: int = 50) -> dict:
        row = self.df.loc[site_id]
        grid, relief_m = self._load_dem(site_id)

        pressure = float(row["pressure_bar"])
        sar_rough = float(row["sar_backscatter"])
        h_pad, pad_slope, _ = self._sample_height_and_slope(grid, relief_m, 64.0, 64.0)

        max_plume_m = 9.0 + (1.0 - min(pressure / 1.013, 1.0)) * 105.0
        tilt_hazard = pad_slope > 16.0 or sar_rough > 0.85

        trajectory = []
        for s in range(steps + 1):
            frac = s / steps
            alt_above_pad = max(0.0, (1.0 - frac) ** 1.4 * 4.5)
            plume_r = max_plume_m * (frac ** 1.5) if frac > 0.35 else 2.0
            dust_vel = (45.0 + (1.0 - min(pressure / 1.013, 1.0)) * 680.0) * (frac if frac > 0.3 else 0.1)

            trajectory.append({
                "step": s,
                "alt_above_pad": round(alt_above_pad, 3),
                "pad_elev_norm": round(h_pad, 4),
                "plume_radius_m": round(plume_r, 1),
                "dust_velocity_ms": round(dust_vel, 1),
            })

        plume_fail = max_plume_m > 45.0
        if tilt_hazard and plume_fail:
            verdict = "FAIL"
            summary = f"CRITICAL FAIL: Pad slope {pad_slope:.1f} deg tip-over + {max_plume_m:.0f}m vacuum ejecta blast."
        elif tilt_hazard:
            verdict = "FAIL"
            summary = f"TOUCHDOWN TIP-OVER: Pad slope ({pad_slope:.1f} deg) exceeds 16 deg lander limit."
        elif plume_fail:
            verdict = "FAIL"
            summary = f"PLUME EJECTA FAIL: {pressure} bar vacuum blasts regolith {max_plume_m:.0f}m at high velocity."
        else:
            verdict = "PASS"
            summary = f"SAFE TOUCHDOWN: Pad slope {pad_slope:.1f} deg; air limits dust plume to {max_plume_m:.1f}m."

        return {
            "site_id": site_id,
            "verdict": verdict,
            "pad_slope_deg": round(pad_slope, 1),
            "max_plume_m": round(max_plume_m, 1),
            "pad_elev_norm": round(h_pad, 4),
            "summary": summary,
            "trajectory": trajectory,
        }

    def _sim_mining(self, site_id: str, steps: int = 50) -> dict:
        row = self.df.loc[site_id]
        grid, _ = self._load_dem(site_id)
        h_pad = float(grid[64, 64])

        pressure = float(row["pressure_bar"])
        t_amb = (float(row["temp_min_c"]) + float(row["temp_max_c"])) / 2.0
        mineral = row["mineral_profile"]

        hardness = 1.35 if "basalt" in mineral else (0.95 if "ice" in mineral else 0.80)
        convection_cooling = min(pressure / 1.013, 1.0) * 1.15

        drill_temp = max(t_amb, -40.0)
        depth_m = 0.0
        seized = False
        trajectory = []

        for s in range(steps + 1):
            if not seized:
                depth_m = min(2.0, depth_m + (2.0 / steps) / hardness * 1.15)
                heat_gain = 6.2 * hardness
                heat_loss = convection_cooling * (drill_temp - t_amb) * 0.085 + 0.012 * ((drill_temp + 273.15) / 300.0) ** 4
                drill_temp = drill_temp + heat_gain - heat_loss

                if drill_temp >= 180.0:
                    seized = True

            trajectory.append({
                "step": s,
                "pad_elev_norm": round(h_pad, 4),
                "depth_m": round(depth_m, 2),
                "drill_temp_c": round(drill_temp, 1),
                "seized": seized,
            })

        verdict = "PASS" if not seized else "FAIL"
        summary = (
            f"Core reached {depth_m:.2f}m; convective air held bit at {drill_temp:.0f}C."
            if verdict == "PASS"
            else f"THERMAL SEIZURE at {depth_m:.2f}m: Bit hit {drill_temp:.0f}C in {pressure} bar vacuum (no air cooling)."
        )

        return {
            "site_id": site_id,
            "verdict": verdict,
            "final_depth_m": round(depth_m, 2),
            "peak_temp_c": round(drill_temp, 1),
            "pad_elev_norm": round(h_pad, 4),
            "summary": summary,
            "trajectory": trajectory,
        }

    def run_dual(self, target_id: str, earth_id: str, scenario: str) -> dict:
        if scenario == "rover":
            earth_res = self._sim_rover(earth_id)
            target_res = self._sim_rover(target_id)
        elif scenario == "landing":
            earth_res = self._sim_landing(earth_id)
            target_res = self._sim_landing(target_id)
        elif scenario == "mining":
            earth_res = self._sim_mining(earth_id)
            target_res = self._sim_mining(target_id)
        else:
            raise ValueError(f"Unknown scenario '{scenario}'")

        return {
            "scenario": scenario,
            "earth": earth_res,
            "target": target_res,
            "outcome_type": f"EARTH_{earth_res['verdict']}_VS_SPACE_{target_res['verdict']}",
        }