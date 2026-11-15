"""A printable one-page field-campaign brief for a target (open in a browser, then Print > Save as PDF)."""
from html import escape

STATUS_WORD = {"REPRESENTATIVE": "Good stand-in", "PARTIAL": "Partly useful", "NOT_REPRESENTATIVE": "Not useful"}
STATUS_CLASS = {"REPRESENTATIVE": "good", "PARTIAL": "part", "NOT_REPRESENTATIVE": "poor"}


def _pct(x):
    return f"{100 * x:.0f}%"


def render(res: dict, validation: dict | None, top_n: int = 5) -> str:
    t = res["target"]
    e = escape
    top = res["matches"][:top_n]
    best = top[0]
    lat = f"{abs(t['lat']):.2f}°{'N' if t['lat'] >= 0 else 'S'}"
    lon = f"{abs(t['lon']):.2f}°{'E' if t['lon'] >= 0 else 'W'}"

    art = t.get("artemis") or {}
    art_line = ""
    if art:
        label = {"artemis_iii_2024": "NASA Artemis III candidate region (Oct 2024 list)",
                 "artemis_iii_2022_only": "Artemis III candidate in 2022, not on the Oct 2024 list"}.get(art.get("status"), "")
        art_line = f"<p class='tag'>{e(label)}: {e(art.get('region', ''))}. {e(art.get('placement', ''))}</p>"

    ill = t.get("illumination")
    ill_html = ""
    if ill:
        ill_html = (f"<table class='kv'><tr><th>Sun above horizon</th><td>{_pct(ill['sunlit_fraction'])} of the time</td>"
                    f"<th>Earth in view</th><td>{_pct(ill['earth_visible_fraction'])}</td></tr>"
                    f"<tr><th>Never-lit share of 2 km window</th><td>{_pct(ill['psr_fraction_tile'])}</td>"
                    f"<th>Highest Sun / modelled peak</th><td>{ill['max_sun_elevation_deg']:.1f}° / {ill['modelled_max_temp_c']:.0f} °C</td></tr></table>"
                    f"<p class='small'>Modelled by Celestra from LRO LOLA terrain (horizons to 90 km, 400 m cells). Not a mission product.</p>")
    nir = t.get("night_ir")
    if nir and nir.get("reading"):
        ill_html += f"<p class='small'>THEMIS night infrared ({e(nir.get('status', ''))}): {e(nir['reading'])}.</p>"

    rows = "".join(
        f"<tr><td>{m['rank']}</td><td>{e(m['name'])}</td><td>{100 * m['similarity_score']:.0f}"
        f" <span class='small'>({100 * m['conformal_90_interval'][0]:.0f}-{100 * m['conformal_90_interval'][1]:.0f})</span></td>"
        f"<td class='small'>{e(', '.join(m['why']['helps'][:2]))}</td><td class='small'>{e(', '.join(m['why']['hurts'][:2]))}</td></tr>"
        for m in top)

    uses = "".join(
        f"<tr><td>{e(u['test'])}</td><td>{e(u['top'][0]['name'])}</td>"
        f"<td class='{STATUS_CLASS[u['top'][0]['status']]}'>{STATUS_WORD[u['top'][0]['status']]}</td>"
        f"<td class='small'>{e(u['top'][0]['reason'] if u['transfers'] else (u['note'] or ''))}</td></tr>"
        for u in res["functional_rankings"])

    fr = best["field_readiness"]
    field = (f"<table class='kv'><tr><th>Analog history</th><td>{e(fr['analog_history'] or 'Not verified')}</td></tr>"
             f"<tr><th>Permits</th><td>{e(fr['permits'])}</td></tr>"
             f"<tr><th>Field season</th><td>{e(fr['field_season'])} <span class='small'>({e(fr['field_season_basis'])})</span></td></tr>"
             f"<tr><th>Low-sun tests</th><td class='small'>{e(fr['low_sun_test_months'])}</td></tr>"
             f"<tr><th>Infrastructure</th><td>{e(fr['infrastructure'])}</td></tr></table>")

    sources = sorted({f"{p['earth_instrument']}" for p in best["parameter_similarities"].values()} |
                     {f"{p['space_instrument']}" for p in best["parameter_similarities"].values()})
    src = "".join(f"<li>{e(s)}</li>" for s in sources)

    val = ""
    if validation:
        b = validation.get("baseline", {})
        val = (f"<p class='small'>Validation over all targets: unsuitable control sites rank at a median of "
               f"{validation['negative_controls']['median_rank']:.1f} of {validation['earth_sites']}; agency benchmark analogs at "
               f"{validation['benchmarks']['median_rank']:.1f}. A plain unweighted distance with the same bare-ground rule scores "
               f"{b.get('plain_with_bare_ground_rule', {}).get('benchmark_median_rank', '?')} on benchmarks, so most of the separation comes from "
               f"the terrain features and the bare-ground rule rather than our weights.</p>")

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Celestra brief: {e(t['name'])}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{{--ink:#15171c;--mute:#5b6270;--line:#d9dce2;--good:#1f7a4d;--part:#9a6a00;--poor:#a23030}}
*{{box-sizing:border-box}} body{{font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#fff;margin:0;padding:28px;max-width:900px;margin:auto}}
h1{{font-size:22px;margin:0}} h2{{font-size:14px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}}
.sub{{color:var(--mute);margin:2px 0 8px}} .tag{{background:#eef3ff;border-left:3px solid #3557c5;padding:6px 10px;margin:8px 0}}
table{{border-collapse:collapse;width:100%}} td,th{{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}}
th{{color:var(--mute);font-weight:600}} .kv th{{width:24%}} .small{{font-size:11px;color:var(--mute)}}
.good{{color:var(--good);font-weight:600}} .part{{color:var(--part);font-weight:600}} .poor{{color:var(--poor);font-weight:600}}
ul{{margin:4px 0 0 18px;padding:0}} .bar{{display:flex;justify-content:space-between;align-items:baseline}}
button{{font:inherit;padding:6px 12px;border:1px solid var(--line);background:#f6f7f9;border-radius:6px;cursor:pointer}}
@media print{{button{{display:none}} body{{padding:0}}}}
</style></head><body>
<div class="bar"><div><h1>Field-campaign brief: {e(t['name'])}</h1>
<p class="sub">{e(t['body'].capitalize())} · {lat}, {lon} · gravity {t['gravity']} m/s² · {t['pressure_bar']} bar · generated by Celestra</p></div>
<button onclick="window.print()">Save as PDF</button></div>
{art_line}
<p>{e(t.get('primary_challenge', ''))}</p>
{ill_html}
<h2>Best Earth stand-ins</h2>
<table><tr><th>#</th><th>Earth site</th><th>Match (90% band)</th><th>Matches best on</th><th>Differs most on</th></tr>{rows}</table>
<h2>Best site for each test</h2>
<table><tr><th>Test</th><th>Site</th><th>Verdict</th><th>Why</th></tr>{uses}</table>
<h2>Planning notes for {e(best['name'])}</h2>
{field}
<h2>Data behind these numbers</h2><ul class="small">{src}</ul>
{val}
<p class="small">Limits: only measurements that exist for both sites are scored (Moon and Mars composition, and Mars temperatures, are not measured in our data and are left out); texture comes from 2 km elevation tiles; field-readiness entries marked "not verified" must be checked before planning. Data: NASA PDS (LRO LOLA, LRO Diviner, MRO HiRISE), NASA Worldview (MODIS), ESA Copernicus (DEM, Sentinel-2).</p>
<script>if(location.hash==='#print')setTimeout(()=>window.print(),400)</script>
</body></html>"""
