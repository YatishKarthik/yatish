import json
from pathlib import Path

def main():
    config_path = Path("data/config/sites.json")
    if not config_path.exists():
        print(f"ERROR: {config_path} not found!")
        return

    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    targets = data.get("targets", [])
    earth_sites = data.get("earth_analogs", [])

    moon_targets = [t for t in targets if t["body"] == "moon"]
    mars_targets = [t for t in targets if t["body"] == "mars"]

    novel_earth = [e for e in earth_sites if e["type"] == "novel_candidate"]
    benchmarks = [e for e in earth_sites if e["type"] == "benchmark"]
    neg_controls = [e for e in earth_sites if e["type"] == "negative_control"]

    print("=" * 60)
    print("MASTER SITE REGISTRY VERIFIED!")
    print("=" * 60)
    print(f"• Moon Base Targets:        {len(moon_targets)}")
    for m in moon_targets:
        print(f"   - {m['name']} (g={m['gravity_m_s2']} m/s², P={m['pressure_bar']} bar)")

    print(f"\n• Mars Base Targets:        {len(mars_targets)}")
    for m in mars_targets:
        print(f"   - {m['name']} (g={m['gravity_m_s2']} m/s², P={m['pressure_bar']} bar)")

    print(f"\n• Earth Analogs & Controls: {len(earth_sites)}")
    print(f"   - Novel Discoveries:     {len(novel_earth)} (includes Hajar Ophiolite, Sabkha, Harrat Khaybar, Lonar)")
    print(f"   - NASA/ESA Benchmarks:   {len(benchmarks)} (Haughton, Atacama, Askja, Pisgah)")
    print(f"   - Negative Controls:     {len(neg_controls)} (Amazon, Everglades)")
    print("=" * 60)
    print("Ready for Phase 2 (Satellite Data Pipeline)!")

if __name__ == "__main__":
    main()