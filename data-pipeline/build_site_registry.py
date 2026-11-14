import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "data" / "config" / "sites.json"
OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

def build_registry():
    moon_targets = [
        {
            "id": "moon_shackleton_rim",
            "name": "Shackleton Crater Rim",
            "body": "moon",
            "lat": -89.9, "lon": 0.0, "elevation_m": 4200,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -183.0, "temp_max_c": -43.0,
            "morphology": "crater_rim", "mineral_profile": "basalt_anorthosite", "frost": 0.95,
            "primary_challenge": "Steep slopes bordering pitch-black permanently shadowed regions (PSRs) containing volatile water ice.",
            "recommended_hardware_test": "boulder_mobility_and_ice_radar"
        },
        {
            "id": "moon_malapert_massif",
            "name": "Malapert Massif Peak",
            "body": "moon",
            "lat": -85.9, "lon": 2.7, "elevation_m": 5000,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -170.0, "temp_max_c": -35.0,
            "morphology": "ridge_massif", "mineral_profile": "anorthosite", "frost": 0.40,
            "primary_challenge": "High-altitude communication relay peak with extreme low-angle solar glare and razor-sharp shadows.",
            "recommended_hardware_test": "solar_array_and_optical_nav"
        },
        {
            "id": "moon_connecting_ridge",
            "name": "Connecting Ridge (Shackleton - de Gerlache)",
            "body": "moon",
            "lat": -89.4, "lon": -138.0, "elevation_m": 3100,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -175.0, "temp_max_c": -40.0,
            "morphology": "saddle_ridge", "mineral_profile": "anorthosite", "frost": 0.85,
            "primary_challenge": "Narrow traverse corridor between deep basins; severe wheel-slip risk on loose cryogenic regolith.",
            "recommended_hardware_test": "rover_traverse_and_traction"
        },
        {
            "id": "moon_faustini_rim",
            "name": "Faustini Crater Rim A",
            "body": "moon",
            "lat": -87.3, "lon": 77.0, "elevation_m": 2800,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -190.0, "temp_max_c": -55.0,
            "morphology": "crater_rim", "mineral_profile": "basalt_anorthosite", "frost": 0.90,
            "primary_challenge": "Artemis candidate rim overlooking ultra-cold PSR trap; steep descent required for volatile sampling.",
            "recommended_hardware_test": "steep_crater_descent"
        },
        {
            "id": "moon_cabeus_psr",
            "name": "Cabeus Crater PSR Floor",
            "body": "moon",
            "lat": -84.9, "lon": -35.5, "elevation_m": -3800,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -230.0, "temp_max_c": -205.0,
            "morphology": "crater_bowl", "mineral_profile": "regolith_ice", "frost": 0.98,
            "primary_challenge": "Permanent total darkness and cryogenic temperatures (-230C); confirmed water-ice plumes by LCROSS.",
            "recommended_hardware_test": "cryo_ice_drilling_in_darkness"
        },
        {
            "id": "moon_aristarchus_plateau",
            "name": "Aristarchus Plateau (Vallis Schröteri)",
            "body": "moon",
            "lat": 23.7, "lon": -47.4, "elevation_m": 2000,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -165.0, "temp_max_c": 115.0,
            "morphology": "lava_channel", "mineral_profile": "mare_basalt", "frost": 0.02,
            "primary_challenge": "Pyroclastic volcanic glass deposits ideal for oxygen mining, but extreme 280C day-night thermal shock.",
            "recommended_hardware_test": "isru_oxygen_mining_and_thermal"
        },
        {
            "id": "moon_marius_hills",
            "name": "Marius Hills Lava Skylight",
            "body": "moon",
            "lat": 14.1, "lon": -56.8, "elevation_m": -1200,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -155.0, "temp_max_c": 110.0,
            "morphology": "lava_pit", "mineral_profile": "mare_basalt", "frost": 0.02,
            "primary_challenge": "Collapsed lava tube entrance offering natural radiation shielding for a permanent subterranean base.",
            "recommended_hardware_test": "subsurface_lava_tube_scout"
        },
        {
            "id": "moon_schrodinger_basin",
            "name": "Schrödinger Peak-Ring Basin",
            "body": "moon",
            "lat": -75.0, "lon": 132.4, "elevation_m": -1900,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -180.0, "temp_max_c": -10.0,
            "morphology": "crater_bowl", "mineral_profile": "basalt_anorthosite", "frost": 0.65,
            "primary_challenge": "Massive far-side peak-ring crater exposing deep lunar mantle rocks and pyroclastic vents.",
            "recommended_hardware_test": "deep_mantle_geology_rover"
        },
        {
            "id": "moon_peary_rim",
            "name": "Peary Crater North Pole Rim",
            "body": "moon",
            "lat": 88.6, "lon": 33.0, "elevation_m": 2400,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -178.0, "temp_max_c": -45.0,
            "morphology": "ridge_massif", "mineral_profile": "anorthosite", "frost": 0.88,
            "primary_challenge": "North Polar plateau with high illumination uptime adjacent to deeply shadowed icy micro-craters.",
            "recommended_hardware_test": "polar_solar_and_ice_prospecting"
        },
        {
            "id": "moon_von_karman",
            "name": "Von Kármán Crater (South Pole-Aitken)",
            "body": "moon",
            "lat": -44.8, "lon": 175.9, "elevation_m": -5900,
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            "temp_min_c": -170.0, "temp_max_c": 95.0,
            "morphology": "flat_plain", "mineral_profile": "mare_basalt", "frost": 0.05,
            "primary_challenge": "Smooth basalt-flooded floor inside the largest impact basin in the Solar System; fine electrostatic dust.",
            "recommended_hardware_test": "landing_pad_and_dust_mitigation"
        }
    ]

    mars_targets = [
        {
            "id": "mars_jezero_crater",
            "name": "Jezero Crater Delta",
            "body": "mars",
            "lat": 18.38, "lon": 77.58, "elevation_m": -2500,
            "gravity_m_s2": 3.72, "pressure_bar": 0.006,
            "temp_min_c": -90.0, "temp_max_c": 15.0,
            "morphology": "delta_fan", "mineral_profile": "clay_carbonate", "frost": 0.05,
            "primary_challenge": "Ancient river delta rich in clay phyllosilicates and carbonates; boulder-strewn fan slopes.",
            "recommended_hardware_test": "isru_clay_water_extraction"
        },
        {
            "id": "mars_arcadia_planitia",
            "name": "Arcadia Planitia Ice Plains",
            "body": "mars",
            "lat": 39.3, "lon": -170.3, "elevation_m": -4000,
            "gravity_m_s2": 3.72, "pressure_bar": 0.007,
            "temp_min_c": -115.0, "temp_max_c": -5.0,
            "morphology": "polygon_plain", "mineral_profile": "basalt_ice", "frost": 0.92,
            "primary_challenge": "Flat low-elevation volcanic plains concealing thick water-ice sheets just 1–3 m below dust.",
            "recommended_hardware_test": "shallow_sheet_ice_mining"
        },
        {
            "id": "mars_gale_crater",
            "name": "Gale Crater (Mount Sharp Slopes)",
            "body": "mars",
            "lat": -5.4, "lon": 137.8, "elevation_m": -4500,
            "gravity_m_s2": 3.72, "pressure_bar": 0.008,
            "temp_min_c": -85.0, "temp_max_c": 18.0,
            "morphology": "ridge_massif", "mineral_profile": "sulfate_clay", "frost": 0.05,
            "primary_challenge": "Steep layered sulfate and clay mountain flank with abrasive wind-blown sand traps.",
            "recommended_hardware_test": "sand_trap_mobility_and_wheel_wear"
        },
        {
            "id": "mars_oxia_planum",
            "name": "Oxia Planum Clay Basin",
            "body": "mars",
            "lat": 18.2, "lon": -24.5, "elevation_m": -3000,
            "gravity_m_s2": 3.72, "pressure_bar": 0.007,
            "temp_min_c": -92.0, "temp_max_c": 12.0,
            "morphology": "flat_plain", "mineral_profile": "clay_carbonate", "frost": 0.04,
            "primary_challenge": "Exposed iron-magnesium clay plains (ExoMars site) with fine dust hazard over solar panels.",
            "recommended_hardware_test": "solar_dust_and_core_drilling"
        },
        {
            "id": "mars_mawrth_vallis",
            "name": "Mawrth Vallis Outflow Channel",
            "body": "mars",
            "lat": 22.3, "lon": -16.5, "elevation_m": -2200,
            "gravity_m_s2": 3.72, "pressure_bar": 0.006,
            "temp_min_c": -95.0, "temp_max_c": 10.0,
            "morphology": "delta_fan", "mineral_profile": "clay_carbonate", "frost": 0.05,
            "primary_challenge": "Deeply eroded ancient flood valley exposing stratified hydrated clays and sulfates.",
            "recommended_hardware_test": "hydrated_mineral_prospecting"
        },
        {
            "id": "mars_hellas_planitia",
            "name": "Hellas Planitia Deep Basin",
            "body": "mars",
            "lat": -42.4, "lon": 70.5, "elevation_m": -7152,
            "gravity_m_s2": 3.72, "pressure_bar": 0.011,
            "temp_min_c": -110.0, "temp_max_c": 5.0,
            "morphology": "flat_plain", "mineral_profile": "evaporite_sulfate", "frost": 0.30,
            "primary_challenge": "Highest atmospheric pressure on Mars (11 mbar), making aerobraking easier, but severe dust storm sink.",
            "recommended_hardware_test": "dust_storm_habitat_filtration"
        },
        {
            "id": "mars_utopia_planitia",
            "name": "Utopia Planitia Scalloped Ice",
            "body": "mars",
            "lat": 49.7, "lon": 118.0, "elevation_m": -4200,
            "gravity_m_s2": 3.72, "pressure_bar": 0.007,
            "temp_min_c": -125.0, "temp_max_c": -15.0,
            "morphology": "polygon_plain", "mineral_profile": "basalt_ice", "frost": 0.88,
            "primary_challenge": "Subsurface water ice volume equivalent to Lake Superior trapped beneath polygonal permafrost soil.",
            "recommended_hardware_test": "permafrost_radar_and_thermal_drill"
        },
        {
            "id": "mars_melas_chasma",
            "name": "Valles Marineris (Melas Chasma)",
            "body": "mars",
            "lat": -9.8, "lon": -76.4, "elevation_m": -4800,
            "gravity_m_s2": 3.72, "pressure_bar": 0.009,
            "temp_min_c": -88.0, "temp_max_c": 16.0,
            "morphology": "canyon_steep", "mineral_profile": "sulfate_clay", "frost": 0.03,
            "primary_challenge": "Towering canyon walls with recurring slope lineae, massive landslides, and shadowed cliffs.",
            "recommended_hardware_test": "steep_cliff_rover_navigation"
        },
        {
            "id": "mars_olympus_lava_tubes",
            "name": "Arsia / Tharsis Basalt Lava Tubes",
            "body": "mars",
            "lat": -9.1, "lon": -120.0, "elevation_m": 6500,
            "gravity_m_s2": 3.72, "pressure_bar": 0.002,
            "temp_min_c": -115.0, "temp_max_c": -10.0,
            "morphology": "lava_pit", "mineral_profile": "mare_basalt", "frost": 0.05,
            "primary_challenge": "Collapsed volcanic skylights at ultra-low pressure offering natural cosmic radiation shelter.",
            "recommended_hardware_test": "lava_tube_habitat_deployment"
        },
        {
            "id": "mars_phoenix_polar",
            "name": "Vastitas Borealis (North Polar Plains)",
            "body": "mars",
            "lat": 68.2, "lon": -125.7, "elevation_m": -5100,
            "gravity_m_s2": 3.72, "pressure_bar": 0.008,
            "temp_min_c": -138.0, "temp_max_c": -20.0,
            "morphology": "polygon_plain", "mineral_profile": "basalt_ice", "frost": 0.96,
            "primary_challenge": "Shallow ice-cemented hardpan mixed with perchlorates; seasonal CO2 frost cover.",
            "recommended_hardware_test": "cryo_regolith_excavation"
        }
    ]

    # Helper to cleanly define 60 diverse Earth locations
    # Tuple format: (id, name, type, lat, lon, elev, tmin, tmax, morph, mineral, frost, geology)
    earth_raw = [
        # --- UAE / ARABIAN PENINSULA / MENA (10 sites) ---
        ("earth_hajar_ophiolite", "Wadi Jizzi Ophiolite (Hajar Mts, Oman/UAE)", "novel_candidate", 24.25, 56.15, 650, 14.0, 44.0, "ridge_massif", "clay_carbonate", 0.0, "Exposed mantle peridotite undergoing active serpentinization; mimics Mars subsurface geochemistry."),
        ("earth_al_wathba_sabkha", "Al Wathba Inland Sabkha (Abu Dhabi, UAE)", "novel_candidate", 24.21, 54.68, 12, 16.0, 48.0, "flat_plain", "evaporite_sulfate", 0.0, "Hyper-saline evaporite salt flat; direct analog for ancient Martian drying lakebeds."),
        ("earth_liwa_megadunes", "Liwa Empty Quarter Dunes (Abu Dhabi, UAE)", "novel_candidate", 23.13, 53.78, 110, 15.0, 49.0, "dune_field", "iron_sand", 0.0, "Massive ferric-coated sand dunes testing rover wheel sinkage and wind-blown sand traps."),
        ("earth_jebel_hafeet_karst", "Jebel Hafeet Escarpment (Al Ain, UAE)", "novel_candidate", 24.06, 55.78, 1240, 13.0, 43.0, "canyon_steep", "clay_carbonate", 0.0, "Steep, fractured limestone/marl cliffs testing incline climbing and radar slope echoes."),
        ("earth_hatta_ultramafic", "Hatta Ultramafic Ridge (Dubai/Oman Border, UAE)", "novel_candidate", 24.80, 56.12, 520, 14.0, 43.0, "ridge_massif", "mare_basalt", 0.0, "Dark magnesium-iron mafic rock ridges with minimal vegetation."),
        ("earth_harrat_khaybar", "Harrat Khaybar Lava Tubes (Saudi Arabia)", "novel_candidate", 25.68, 39.95, 1300, 7.0, 41.0, "lava_pit", "mare_basalt", 0.0, "Extensive basaltic lava field with collapse skylights and underground lava tube caves."),
        ("earth_al_wahbah_crater", "Al Wahbah Maar Crater (Saudi Arabia)", "novel_candidate", 22.90, 41.14, 1100, 10.0, 42.0, "crater_bowl", "evaporite_sulfate", 0.0, "250m-deep volcanic explosion crater floored with white sodium phosphate salt crystals."),
        ("earth_wadi_rum", "Wadi Rum Ferric Canyon (Jordan)", "novel_candidate", 29.57, 35.42, 950, 4.0, 38.0, "canyon_steep", "iron_sand", 0.0, "Towering red ferric sandstone canyons used extensively in Mars exploration simulations."),
        ("earth_aouelloul_crater", "Aouelloul Impact Crater (Mauritania)", "novel_candidate", 20.25, -12.68, 300, 14.0, 46.0, "crater_rim", "basalt_anorthosite", 0.0, "Well-preserved desert impact crater with dense impactite glass melts."),
        ("earth_richat_structure", "Richat Eye Structure (Mauritania)", "novel_candidate", 21.12, -11.40, 400, 13.0, 45.0, "crater_rim", "clay_carbonate", 0.0, "40 km eroded circular geological dome with concentric boulder ridges."),

        # --- IMPACT CRATERS WORLDWIDE (8 sites) ---
        ("earth_lonar_crater", "Lonar Basaltic Impact Crater (India)", "novel_candidate", 19.97, 76.51, 560, 16.0, 41.0, "crater_rim", "mare_basalt", 0.0, "Rare hyper-velocity impact crater excavated directly into Deccan flood basalt."),
        ("earth_barringer_crater", "Barringer Meteor Crater (Arizona, USA)", "benchmark", 35.03, -111.02, 1740, -5.0, 35.0, "crater_rim", "basalt_anorthosite", 0.02, "Classic Apollo astronaut training crater with preserved ejecta blanket and steep rim."),
        ("earth_ries_crater", "Nördlinger Ries Impact Basin (Germany)", "benchmark", 48.88, 10.57, 430, -3.0, 25.0, "crater_bowl", "basalt_anorthosite", 0.05, "24 km impact crater containing suevite impact breccia studied by Apollo 14/17 crews."),
        ("earth_pingualuit_crater", "Pingualuit Arctic Impact Crater (Canada)", "novel_candidate", 61.28, -73.66, 650, -32.0, 8.0, "crater_rim", "regolith_ice", 0.78, "Young Arctic impact crater in crystalline rock rimmed by permafrost."),
        ("earth_tenoumer_crater", "Tenoumer Desert Crater (Mauritania)", "novel_candidate", 22.92, -10.41, 280, 12.0, 46.0, "crater_rim", "basalt_anorthosite", 0.0, "Nearly circular 1.9 km hyper-arid impact crater with basaltic melt rocks."),
        ("earth_wolfe_creek", "Wolfe Creek Crater (Western Australia)", "novel_candidate", -19.17, 127.79, 340, 12.0, 43.0, "crater_rim", "iron_sand", 0.0, "Preserved desert meteorite crater floored with gypsum and iron-rich sands."),
        ("earth_gosse_bluff", "Gosse Bluff Impact Ring (Australia)", "novel_candidate", -23.82, 132.31, 700, 6.0, 40.0, "crater_rim", "iron_sand", 0.0, "Eroded central peak ring of a 22 km ancient impact structure in ferric desert."),
        ("earth_roter_kamm", "Roter Kamm Impact Crater (Namibia)", "novel_candidate", -27.77, 16.29, 550, 7.0, 36.0, "crater_rim", "iron_sand", 0.0, "2.5 km Namib desert impact crater partially filled with windblown sand."),

        # --- POLAR COLD TRAPS, PERMAFROST & DRY VALLEYS (10 sites) ---
        ("earth_haughton_crater", "Haughton Impact Crater (Devon Island, Canada)", "benchmark", 75.38, -89.67, 250, -38.0, 6.0, "crater_bowl", "basalt_ice", 0.85, "NASA/CSA Arctic research station; 23 km crater in polar desert permafrost."),
        ("earth_svalbard_polygons", "Longyearbyen Ice-Wedge Polygons (Svalbard, Norway)", "novel_candidate", 78.22, 15.65, 180, -24.0, 7.0, "polygon_plain", "basalt_ice", 0.90, "Continuous Arctic permafrost patterned ground mimicking Arcadia Planitia."),
        ("earth_mcmurdo_dry_valleys", "McMurdo Dry Valleys (Antarctica)", "benchmark", -77.47, 162.52, 800, -45.0, -2.0, "canyon_steep", "regolith_ice", 0.96, "Coldest hyper-arid desert on Earth; permafrost soils & buried glacier ice."),
        ("earth_eureka_ellesmere", "Eureka Polar Desert (Ellesmere Island, Canada)", "novel_candidate", 79.98, -85.94, 90, -42.0, 7.0, "polygon_plain", "basalt_ice", 0.88, "High-latitude polar desert with minimal snowfall and shallow permafrost."),
        ("earth_tuktoyaktuk_pingos", "Tuktoyaktuk Ice Pingos (Northwest Territories, Canada)", "novel_candidate", 69.44, -133.03, 15, -33.0, 13.0, "polygon_plain", "basalt_ice", 0.82, "Massive subsurface ice cores creating domed tundra mounds."),
        ("earth_lena_delta_permafrost", "Lena Delta Polygon Tundra (Siberia)", "novel_candidate", 72.38, 126.48, 20, -39.0, 11.0, "polygon_plain", "basalt_ice", 0.86, "Hexagonal thermal-contraction ice-wedge polygons ideal for SAR ice calibration."),
        ("earth_chajnantor_plateau", "Chajnantor Cold Plateau (Atacama, Chile)", "novel_candidate", -23.02, -67.75, 5050, -22.0, 12.0, "flat_plain", "mare_basalt", 0.25, "High-altitude thin-air plateau with extreme UV and freezing dry nights."),
        ("earth_mauna_kea_summit", "Mauna Kea Volcanic Tephra (Hawaii, USA)", "benchmark", 19.82, -155.47, 4207, -6.0, 14.0, "ridge_massif", "mare_basalt", 0.10, "NASA lunar ISRU regolith testing ground in unweathered volcanic tephra."),
        ("earth_ojos_del_salado", "Ojos del Salado High Flank (Chile/Argentina)", "novel_candidate", -27.11, -68.54, 5800, -28.0, 6.0, "ridge_massif", "mare_basalt", 0.45, "Highest active volcano on Earth; thin atmosphere, UV stress, frozen regolith."),
        ("earth_pamir_cold_desert", "Karakul High Cold Basin (Pamir Mts, Tajikistan)", "novel_candidate", 39.01, 73.48, 3914, -29.0, 14.0, "crater_bowl", "evaporite_sulfate", 0.55, "High-altitude cold arid impact basin surrounded by barren permafrost slopes."),

        # --- VOLCANIC BASALTS, LAVA FIELDS & LAVA TUBES (10 sites) ---
        ("earth_askja_caldera", "Askja Caldera & Holuhraun Basalt (Iceland)", "benchmark", 65.03, -16.75, 1100, -18.0, 12.0, "lava_channel", "mare_basalt", 0.35, "Apollo 11/15 geology training site; fresh jagged basalt lava and pumice."),
        ("earth_krafla_lava", "Krafla Basalt Fissure Field (Iceland)", "novel_candidate", 65.71, -16.78, 600, -14.0, 14.0, "lava_channel", "mare_basalt", 0.25, "Young fractured basalt flows with extreme SAR radar roughness."),
        ("earth_mojave_pisgah", "Pisgah Crater & Lava Field (California, USA)", "benchmark", 34.75, -116.37, 650, 2.0, 44.0, "lava_pit", "mare_basalt", 0.0, "JPL Mars rover wheel-wear testbed in rough 'a'ā basalt lava."),
        ("earth_craters_of_the_moon", "Craters of the Moon Lava Tubes (Idaho, USA)", "benchmark", 43.46, -113.56, 1750, -15.0, 32.0, "lava_pit", "mare_basalt", 0.15, "Basaltic lava tubes and spatter cones directly mimicking Marius Hills."),
        ("earth_lanzarote_tubes", "Lanzarote Basalt Tubes (Canary Islands, Spain)", "benchmark", 29.04, -13.63, 350, 12.0, 30.0, "lava_pit", "mare_basalt", 0.0, "ESA PANGAEA astronaut training site for subsurface lava tube exploration."),
        ("earth_etna_high_flank", "Mount Etna Upper Ash Slopes (Italy)", "novel_candidate", 37.75, 14.99, 2800, -9.0, 22.0, "ridge_massif", "mare_basalt", 0.20, "DLR ROBEX lunar rover test site on steep volcanic scoria slopes."),
        ("earth_tolbachik_scoria", "Tolbachik Volcanic Scoria Desert (Kamchatka)", "novel_candidate", 55.83, 160.33, 1400, -24.0, 18.0, "flat_plain", "mare_basalt", 0.40, "Original Soviet Lunokhod Moon rover testing ground in black volcanic ash."),
        ("earth_nyamulagira_lava", "Nyamulagira Fresh Basalt Flows (DRC)", "novel_candidate", -1.41, 29.20, 2400, 8.0, 26.0, "lava_channel", "mare_basalt", 0.0, "Unweathered dark basaltic flows with rough radar backscatter."),
        ("earth_kau_volcanic_desert", "Ka'ū Volcanic Ash Desert (Hawaii, USA)", "novel_candidate", 19.36, -155.34, 950, 10.0, 29.0, "flat_plain", "mare_basalt", 0.0, "Acid-rain-stripped barren basaltic ash plain with high iron content."),
        ("earth_undara_lava_tubes", "Undara Basalt Lava Tubes (Queensland, Australia)", "novel_candidate", -18.20, 144.57, 520, 10.0, 36.0, "lava_pit", "mare_basalt", 0.0, "One of the longest intact basaltic lava tube systems on Earth."),

        # --- HYPER-ARID DESERTS, PLAYAS, SALT FLATS & CANYONS (14 sites) ---
        ("earth_atacama_yungay", "Atacama Yungay Hyper-Arid Core (Chile)", "benchmark", -24.08, -69.87, 980, 0.0, 35.0, "flat_plain", "evaporite_sulfate", 0.0, "Driest non-polar desert on Earth; perchlorate-rich Mars-like soils."),
        ("earth_qaidam_yardangs", "Qaidam Basin Yardangs (Tibetan Plateau, China)", "novel_candidate", 37.85, 93.40, 2850, -19.0, 26.0, "ridge_massif", "evaporite_sulfate", 0.15, "High-altitude cold desert with wind-carved yardangs and sulfate playas."),
        ("earth_dallol_hydrothermal", "Dallol Danakil Salt/Sulfur Flats (Ethiopia)", "novel_candidate", 14.24, 40.30, -120, 24.0, 51.0, "flat_plain", "sulfate_clay", 0.0, "Poly-extreme hyper-saline, hyper-acidic hydrothermal Martian sulfur analog."),
        ("earth_rio_tinto", "Río Tinto Iron-Sulfate Basin (Spain)", "benchmark", 37.71, -6.55, 320, 4.0, 37.0, "delta_fan", "sulfate_clay", 0.0, "Extreme acidic iron-sulfate drainage basin modeling ancient Mars."),
        ("earth_utah_mdrs", "Hanksville Clay-Sulfate Badlands (Utah, USA)", "benchmark", 38.40, -110.79, 1380, -10.0, 39.0, "delta_fan", "clay_carbonate", 0.02, "Mars Desert Research Station; Jurassic phyllosilicate clay & delta channels."),
        ("earth_uyuni_salt_flat", "Salar de Uyuni Evaporite Crust (Bolivia)", "novel_candidate", -20.13, -67.49, 3656, -12.0, 21.0, "polygon_plain", "evaporite_sulfate", 0.05, "World's largest polygonal salt crust; high albedo radar calibration site."),
        ("earth_sossusvlei_dunes", "Sossusvlei Ferric Dunes (Namibia)", "novel_candidate", -24.73, 15.29, 600, 6.0, 40.0, "dune_field", "iron_sand", 0.0, "Oxidized red iron-rich megadunes bordering dry clay vlei pans."),
        ("earth_simpson_iron_dunes", "Simpson Red Ferric Plains (Australia)", "novel_candidate", -25.00, 137.00, 120, 5.0, 44.0, "dune_field", "iron_sand", 0.0, "Iron-oxide-stained quartz sand ridges resembling Martian plains."),
        ("earth_lut_dasht_yardangs", "Dasht-e Lut Hyper-Arid Yardangs (Iran)", "novel_candidate", 30.50, 59.10, 310, 5.0, 54.0, "ridge_massif", "evaporite_sulfate", 0.0, "Extreme thermal stress zone with wind-eroded yardang corridors."),
        ("earth_bardenas_reales", "Bardenas Reales Clay Badlands (Spain)", "novel_candidate", 42.19, -1.48, 350, 0.0, 34.0, "delta_fan", "clay_carbonate", 0.0, "Eroded clay/gypsum badlands mimicking ancient Martian river channels."),
        ("earth_badwater_basin", "Badwater Basin Evaporite Pan (Death Valley, USA)", "novel_candidate", 36.23, -116.77, -86, 4.0, 52.0, "polygon_plain", "evaporite_sulfate", 0.0, "Polygonal salt flat crust with extreme diurnal heat stress."),
        ("earth_tabernas_badlands", "Tabernas Arid Badlands (Spain)", "novel_candidate", 37.02, -2.42, 480, 3.0, 39.0, "canyon_steep", "clay_carbonate", 0.0, "Europe's only true desert; steep eroded clay-marl gullies."),
        ("earth_makgadikgadi_pan", "Makgadikgadi Salt Pan (Botswana)", "novel_candidate", -20.71, 24.95, 900, 5.0, 39.0, "flat_plain", "evaporite_sulfate", 0.0, "Vast desiccated paleolake evaporite crust modeling Jezero drying."),
        ("earth_lake_natron", "Lake Natron Hyper-Alkaline Basin (Tanzania)", "novel_candidate", -2.42, 36.01, 610, 18.0, 41.0, "flat_plain", "clay_carbonate", 0.0, "Carbonate-rich volcanic evaporite basin matching Mars carbonates."),

        # --- NEGATIVE CONTROLS (8 Non-Analog Biomes to test AI rejection!) ---
        ("earth_amazon_rainforest", "Amazon Basin Rainforest (Manaus, Brazil)", "negative_control", -3.10, -60.02, 80, 22.0, 33.0, "flat_plain", "biomass_wet", 0.0, "Dense tropical canopy & saturated humidity. AI must reject."),
        ("earth_everglades_wetland", "Florida Everglades Wetlands (USA)", "negative_control", 25.75, -80.80, 2, 16.0, 33.0, "flat_plain", "biomass_wet", 0.0, "Flooded sawgrass marsh. AI must reject."),
        ("earth_congo_basin", "Congo Basin Tropical Forest (DRC)", "negative_control", 0.50, 22.00, 350, 21.0, 32.0, "flat_plain", "biomass_wet", 0.0, "Continuous equatorial rainforest canopy. AI must reject."),
        ("earth_borneo_peat_swamp", "Borneo Tropical Peatland (Indonesia)", "negative_control", -2.30, 113.90, 25, 23.0, 34.0, "flat_plain", "biomass_wet", 0.0, "Waterlogged organic peat swamp. AI must reject."),
        ("earth_iowa_cropland", "Iowa Irrigated Farmland (USA)", "negative_control", 42.03, -93.62, 290, -12.0, 30.0, "flat_plain", "biomass_wet", 0.1, "Dense agricultural vegetation & wet loam soil. AI must reject."),
        ("earth_sundarbans_delta", "Sundarbans Mangrove Delta (Bangladesh)", "negative_control", 22.00, 89.50, 3, 15.0, 35.0, "flat_plain", "biomass_wet", 0.0, "Tidal mangrove swamp & muddy rivers. AI must reject."),
        ("earth_pantanal_wetland", "Pantanal Flooded Plain (Brazil)", "negative_control", -17.70, -56.90, 110, 18.0, 36.0, "flat_plain", "biomass_wet", 0.0, "World's largest tropical wetland. AI must reject."),
        ("earth_dutch_polders", "Dutch Agricultural Polders (Netherlands)", "negative_control", 52.50, 5.50, -3, 0.0, 23.0, "flat_plain", "biomass_wet", 0.05, "Managed green grasslands below sea level. AI must reject.")
    ]

    earth_analogs = []
    for item in earth_raw:
        sid, name, stype, lat, lon, elev, tmin, tmax, morph, mineral, frost, geo = item
        earth_analogs.append({
            "id": sid,
            "name": name,
            "body": "earth",
            "type": stype,
            "lat": lat,
            "lon": lon,
            "elevation_m": elev,
            "gravity_m_s2": 9.81,
            "pressure_bar": 1.013,
            "temp_min_c": tmin,
            "temp_max_c": tmax,
            "morphology": morph,
            "mineral_profile": mineral,
            "frost": frost,
            "geology": geo
        })

    registry = {
        "targets": moon_targets + mars_targets,
        "earth_analogs": earth_analogs
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)

    print("=" * 65)
    print("MICROSTEP B1 COMPLETE: 80-SITE REGISTRY GENERATED!")
    print("=" * 65)
    print(f"• Moon Targets:     {len(moon_targets)}")
    print(f"• Mars Targets:     {len(mars_targets)}")
    print(f"• Earth Candidates: {len(earth_analogs)}")
    print(f"• Total Sites:      {len(moon_targets) + len(mars_targets) + len(earth_analogs)}")
    print(f"Saved cleanly to:   {OUT_PATH}")
    print("=" * 65)

if __name__ == "__main__":
    build_registry()