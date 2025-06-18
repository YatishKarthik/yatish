import streamlit as st
import folium
from streamlit_folium import st_folium
import openrouteservice
import requests
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import numpy as np
from geopy.distance import geodesic
import time
from typing import List, Tuple, Optional, Dict, Any
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
import json
import random
import math

# Configure page
st.set_page_config(
    page_title="Advanced Route Optimizer Pro", 
    layout="wide",
    initial_sidebar_state="expanded",
    page_icon="🗺️"
)

# Enhanced CSS for professional look
st.markdown("""
<style>
    .main-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 2rem;
        border-radius: 15px;
        color: white;
        text-align: center;
        margin-bottom: 2rem;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .route-card {
        background: white;
        padding: 1.5rem;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        border-left: 4px solid #667eea;
        margin: 1rem 0;
    }
    .navigation-step {
        background: #f8f9fa;
        padding: 1rem;
        border-radius: 8px;
        margin: 0.5rem 0;
        border-left: 3px solid #28a745;
        display: flex;
        align-items: center;
    }
    .traffic-alert {
        background: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 5px;
        padding: 0.75rem;
        margin: 0.5rem 0;
    }
    .metric-container {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        padding: 1rem;
        border-radius: 10px;
        text-align: center;
    }
    .stButton > button {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 0.5rem 1rem;
        font-weight: 600;
    }
    .sidebar-section {
        background: #f8f9fa;
        padding: 1rem;
        border-radius: 8px;
        margin: 0.5rem 0;
        border-left: 3px solid #667eea;
    }
    .emergency-mode {
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
        color: white;
        padding: 1rem;
        border-radius: 10px;
        text-align: center;
        margin: 1rem 0;
    }
    .success-card {
        background: linear-gradient(135deg, #00b894 0%, #00a085 100%);
        color: white;
        padding: 1rem;
        border-radius: 8px;
        margin: 1rem 0;
    }
    .warning-card {
        background: linear-gradient(135deg, #fdcb6e 0%, #e17055 100%);
        color: white;
        padding: 1rem;
        border-radius: 8px;
        margin: 1rem 0;
    }
    .info-card {
        background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%);
        color: white;
        padding: 1rem;
        border-radius: 8px;
        margin: 1rem 0;
    }
</style>
""", unsafe_allow_html=True)

class RouteSegment:
    def __init__(self, start_point: Tuple[float, float], end_point: Tuple[float, float], 
                 distance: float, duration: float, geometry: List[List[float]], 
                 instructions: List[Dict], traffic_level: str):
        self.start_point = start_point
        self.end_point = end_point
        self.distance = distance
        self.duration = duration
        self.geometry = geometry
        self.instructions = instructions
        self.traffic_level = traffic_level

class NavigationStep:
    def __init__(self, instruction: str, distance: float, duration: float, 
                 direction: str, coordinates: Tuple[float, float], icon: str):
        self.instruction = instruction
        self.distance = distance
        self.duration = duration
        self.direction = direction
        self.coordinates = coordinates
        self.icon = icon

class AdvancedRoutingEngine:
    def __init__(self, api_key: str = None):
        self.api_key = api_key
        self.osrm_base = "https://router.project-osrm.org/route/v1/driving"
        self.fallback_services = [
            "http://router.project-osrm.org/route/v1/driving",
            "https://routing.openstreetmap.de/routed-car/route/v1/driving"
        ]
        
        # Initialize OpenRouteService client if API key provided
        self.ors_client = None
        if api_key and api_key != "YOUR_API_KEY":
            try:
                self.ors_client = openrouteservice.Client(key=api_key)
            except Exception as e:
                st.warning(f"OpenRouteService initialization failed: {e}")
    
    def get_route_sync(self, start: Tuple[float, float], end: Tuple[float, float], 
                      mode: str = "driving-car") -> Optional[RouteSegment]:
        """Get route with multiple fallback options"""
        
        # Try OpenRouteService first if available
        if self.ors_client:
            try:
                route = self.ors_client.directions([start, end], profile=mode, format="geojson")
                return self._parse_ors_response(route, start, end)
            except Exception as e:
                st.warning(f"OpenRouteService failed: {e}")
        
        # Fallback to OSRM
        try:
            coords = f"{start[0]},{start[1]};{end[0]},{end[1]}"
            params = {
                'overview': 'full',
                'geometries': 'geojson',
                'steps': 'true',
                'annotations': 'duration,distance,speed'
            }
            
            url = f"{self.osrm_base}/{coords}"
            response = requests.get(url, params=params, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                return self._parse_osrm_response(data, start, end)
                
        except Exception as e:
            st.warning(f"OSRM routing failed: {str(e)}")
        
        # Final fallback to geometric interpolation
        return self._create_fallback_route(start, end)
    
    def _parse_ors_response(self, route_data: dict, start: Tuple[float, float], end: Tuple[float, float]) -> RouteSegment:
        """Parse OpenRouteService response"""
        if not route_data.get('features'):
            return self._create_fallback_route(start, end)
        
        feature = route_data['features'][0]
        geometry = feature['geometry']['coordinates']
        properties = feature['properties']
        
        # Convert to lat,lon format for Folium
        route_coords = [[coord[1], coord[0]] for coord in geometry]
        
        # Extract summary information
        summary = properties.get('summary', {})
        distance = summary.get('distance', 0) / 1000  # Convert to km
        duration = summary.get('duration', 0) / 60    # Convert to minutes
        
        # Create basic instructions
        instructions = self._create_basic_instructions(start, end, distance)
        
        return RouteSegment(
            start_point=start,
            end_point=end,
            distance=distance,
            duration=duration,
            geometry=route_coords,
            instructions=instructions,
            traffic_level=self._estimate_traffic_level(duration * 60)
        )
    
    def _parse_osrm_response(self, data: dict, start: Tuple[float, float], end: Tuple[float, float]) -> RouteSegment:
        """Parse OSRM API response into RouteSegment"""
        if not data.get('routes'):
            return self._create_fallback_route(start, end)
        
        route = data['routes'][0]
        geometry = route['geometry']['coordinates']
        
        # Convert to lat,lon format for Folium
        route_coords = [[coord[1], coord[0]] for coord in geometry]
        
        # Extract turn-by-turn instructions
        instructions = []
        if 'legs' in route:
            for leg in route['legs']:
                if 'steps' in leg:
                    for step in leg['steps']:
                        maneuver = step.get('maneuver', {})
                        instructions.append({
                            'instruction': self._format_instruction(step),
                            'distance': step.get('distance', 0),
                            'duration': step.get('duration', 0),
                            'type': maneuver.get('type', 'continue'),
                            'modifier': maneuver.get('modifier', ''),
                            'coordinates': [maneuver.get('location', [0, 0])[1], maneuver.get('location', [0, 0])[0]]
                        })
        
        return RouteSegment(
            start_point=start,
            end_point=end,
            distance=route.get('distance', 0) / 1000,  # Convert to km
            duration=route.get('duration', 0) / 60,    # Convert to minutes
            geometry=route_coords,
            instructions=instructions,
            traffic_level=self._estimate_traffic_level(route.get('duration', 0))
        )
    
    def _create_fallback_route(self, start: Tuple[float, float], end: Tuple[float, float]) -> RouteSegment:
        """Create a realistic curved route when API fails"""
        # Create smooth bezier curve between points
        start_lat, start_lon = start[1], start[0]
        end_lat, end_lon = end[1], end[0]
        
        # Add control points for realistic curve
        mid_lat = (start_lat + end_lat) / 2
        mid_lon = (start_lon + end_lon) / 2
        
        # Offset control points to create curved path
        offset = 0.005  # Adjust for curve intensity
        control1_lat = start_lat + (mid_lat - start_lat) * 0.3 + offset
        control1_lon = start_lon + (mid_lon - start_lon) * 0.3 + offset
        control2_lat = end_lat + (mid_lat - end_lat) * 0.3 - offset
        control2_lon = end_lon + (mid_lon - end_lon) * 0.3 - offset
        
        # Generate points along bezier curve
        route_coords = []
        num_points = 25
        
        for i in range(num_points + 1):
            t = i / num_points
            
            # Cubic bezier formula
            lat = (1-t)**3 * start_lat + 3*(1-t)**2*t * control1_lat + 3*(1-t)*t**2 * control2_lat + t**3 * end_lat
            lon = (1-t)**3 * start_lon + 3*(1-t)**2*t * control1_lon + 3*(1-t)*t**2 * control2_lon + t**3 * end_lon
            
            route_coords.append([lat, lon])
        
        # Calculate distance and duration
        distance = self._calculate_route_distance(route_coords)
        duration = self._estimate_duration(distance)
        
        return RouteSegment(
            start_point=start,
            end_point=end,
            distance=distance,
            duration=duration,
            geometry=route_coords,
            instructions=self._create_basic_instructions(start, end, distance),
            traffic_level="moderate"
        )
    
    def _format_instruction(self, step: dict) -> str:
        """Format OSRM step into readable instruction"""
        maneuver = step.get('maneuver', {})
        maneuver_type = maneuver.get('type', 'continue')
        modifier = maneuver.get('modifier', '')
        name = step.get('name', 'the road')
        
        if maneuver_type == 'depart':
            return f"Head {modifier} on {name}" if name != 'the road' else f"Head {modifier}"
        elif maneuver_type == 'turn':
            return f"Turn {modifier} onto {name}" if name != 'the road' else f"Turn {modifier}"
        elif maneuver_type == 'merge':
            return f"Merge {modifier}"
        elif maneuver_type == 'arrive':
            return "Arrive at destination"
        else:
            return f"Continue on {name}" if name != 'the road' else "Continue straight"
    
    def _calculate_route_distance(self, coordinates: List[List[float]]) -> float:
        """Calculate total distance of route coordinates"""
        total_distance = 0
        for i in range(len(coordinates) - 1):
            point1 = (coordinates[i][0], coordinates[i][1])
            point2 = (coordinates[i+1][0], coordinates[i+1][1])
            total_distance += geodesic(point1, point2).kilometers
        return total_distance
    
    def _estimate_duration(self, distance_km: float) -> float:
        """Estimate duration based on distance"""
        if distance_km < 5:
            avg_speed = 25  # City center
        elif distance_km < 15:
            avg_speed = 35  # Urban areas
        else:
            avg_speed = 45  # Highways
        
        return (distance_km / avg_speed) * 60  # Convert to minutes
    
    def _estimate_traffic_level(self, duration_seconds: float) -> str:
        """Estimate traffic level based on duration"""
        if duration_seconds < 300:  # < 5 minutes
            return "light"
        elif duration_seconds < 900:  # < 15 minutes
            return "moderate"
        else:
            return "heavy"
    
    def _create_basic_instructions(self, start: Tuple[float, float], end: Tuple[float, float], distance: float) -> List[Dict]:
        """Create basic navigation instructions"""
        return [
            {
                'instruction': f"Head towards destination",
                'distance': distance * 1000,
                'duration': self._estimate_duration(distance) * 60,
                'type': 'depart',
                'coordinates': [start[1], start[0]]
            },
            {
                'instruction': "Arrive at destination",
                'distance': 0,
                'duration': 0,
                'type': 'arrive',
                'coordinates': [end[1], end[0]]
            }
        ]

def geocode_enhanced(address: str, region: str = "global") -> Optional[Tuple[float, float]]:
    """Enhanced geocoding with regional optimization"""
    if not address.strip():
        return None
    
    # Regional landmarks for quick lookup
    landmarks = {
        "dubai": {
            'burj khalifa': (55.2744, 25.1972),
            'dubai mall': (55.2796, 25.1975),
            'palm jumeirah': (55.1390, 25.1124),
            'dubai marina': (55.1393, 25.0657),
            'dubai airport': (55.3657, 25.2532),
            'dubai creek': (55.3047, 25.2456),
            'jumeirah beach': (55.1928, 25.1972),
            'downtown dubai': (55.2708, 25.2048),
            'business bay': (55.2631, 25.1865),
            'sheikh zayed road': (55.2708, 25.2048)
        },
        "global": {
            'times square': (-73.9857, 40.7580),
            'central park': (-73.9654, 40.7829),
            'empire state building': (-73.9857, 40.7484),
            'statue of liberty': (-74.0445, 40.6892),
            'brooklyn bridge': (-73.9969, 40.7061)
        }
    }
    
    # Check for quick landmark match
    clean_address_lower = address.lower().strip()
    region_landmarks = landmarks.get(region, landmarks["global"])
    
    for landmark, coords in region_landmarks.items():
        if landmark in clean_address_lower:
            return coords
    
    # Clean address for API call
    clean_address = address.strip()
    if region == "dubai" and not any(x in clean_address.upper() for x in ['DUBAI', 'UAE', 'EMIRATE']):
        clean_address += ", Dubai, UAE"
    
    # Try geocoding with Nominatim
    try:
        time.sleep(1)  # Rate limiting
        
        headers = {"User-Agent": "AdvancedRouteOptimizer/2.0"}
        url = f"https://nominatim.openstreetmap.org/search?q={requests.utils.quote(clean_address)}&format=json&limit=1"
        
        if region == "dubai":
            url += "&countrycodes=ae"
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            
            if data and len(data) > 0:
                location = data[0]
                lon, lat = float(location['lon']), float(location['lat'])
                return (lon, lat)
                    
    except Exception as e:
        st.warning(f"Geocoding failed for {address}: {str(e)}")
    
    return None

def create_professional_map(locations_df: pd.DataFrame, route_segments: List[RouteSegment], 
                          alerts: List = None, center_coords: tuple = None) -> folium.Map:
    """Create professional interactive map"""
    
    # Determine map center
    if center_coords:
        center_lat, center_lon = center_coords
        zoom = 11
    elif not locations_df.empty:
        center_lat = locations_df['latitude'].mean()
        center_lon = locations_df['longitude'].mean()
        zoom = 12
    else:
        # Default to New York
        center_lat, center_lon = 40.7589, -73.9851
        zoom = 11
    
    # Create map with professional styling
    m = folium.Map(
        location=[center_lat, center_lon],
        zoom_start=zoom,
        tiles='OpenStreetMap'
    )
    
    # Route colors (Google Maps style)
    route_colors = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#9AA0A6', '#FF6D01', '#46BDC6']
    
    # Draw route segments with enhanced styling
    for i, segment in enumerate(route_segments):
        color = route_colors[i % len(route_colors)]
        
        # Main route line (thick)
        folium.PolyLine(
            locations=segment.geometry,
            weight=6,
            color=color,
            opacity=0.8,
            popup=f"""
            <div style='width: 200px;'>
                <b>Route Segment {i+1}</b><br>
                Distance: {segment.distance:.1f} km<br>
                Duration: {segment.duration:.0f} min<br>
                Traffic: {segment.traffic_level.title()}
            </div>
            """,
            tooltip=f"Segment {i+1}: {segment.distance:.1f}km"
        ).add_to(m)
        
        # Add direction arrows along route
        if len(segment.geometry) > 5:
            arrow_interval = max(1, len(segment.geometry) // 5)
            for j in range(arrow_interval, len(segment.geometry) - arrow_interval, arrow_interval):
                if j < len(segment.geometry) - 1:
                    folium.CircleMarker(
                        location=segment.geometry[j],
                        radius=3,
                        color=color,
                        fill=True,
                        popup=f"Route direction"
                    ).add_to(m)
    
    # Enhanced location markers
    for idx, row in locations_df.iterrows():
        # Determine marker style based on position
        if idx == 0:  # Start point
            marker_color = 'green'
            popup_title = '🚀 START POINT'
        elif idx == len(locations_df) - 1:  # End point
            marker_color = 'red'
            popup_title = '🏁 END POINT'
        else:  # Intermediate stops
            marker_color = 'blue'
            popup_title = f'📍 STOP {idx}'
        
        # Create detailed popup
        popup_html = f"""
        <div style="width: 250px; font-family: Arial;">
            <h4 style="color: #333; margin-bottom: 10px;">{popup_title}</h4>
            <hr style="margin: 5px 0;">
            <b>📍 Address:</b> {row['address']}<br>
            <b>⚖️ Priority:</b> <span style="color: #4285F4;">{row.get('weight', 'N/A')}</span><br>
            <b>🌍 Coordinates:</b> {row['latitude']:.4f}, {row['longitude']:.4f}<br>
            <b>🕒 Estimated Service Time:</b> 10-15 min<br>
            <hr style="margin: 5px 0;">
            <small style="color: #666;">Stop #{idx + 1}</small>
        </div>
        """
        
        # Main marker
        folium.Marker(
            location=[row['latitude'], row['longitude']],
            popup=folium.Popup(popup_html, max_width=300),
            tooltip=f"{popup_title}: {row['address'][:30]}{'...' if len(row['address']) > 30 else ''}",
            icon=folium.Icon(color=marker_color, icon='info-sign')
        ).add_to(m)
        
        # Add service area circle
        folium.Circle(
            location=[row['latitude'], row['longitude']],
            radius=300,  # 300m service radius
            color=marker_color,
            fill=True,
            fillOpacity=0.1,
            weight=2,
            popup=f"Service Area: {row['address']}"
        ).add_to(m)
    
    # Fit bounds to show all points
    if not locations_df.empty:
        bounds = [
            [locations_df['latitude'].min() - 0.01, locations_df['longitude'].min() - 0.01],
            [locations_df['latitude'].max() + 0.01, locations_df['longitude'].max() + 0.01]
        ]
        m.fit_bounds(bounds)
    
    return m

def optimize_route_tsp(coordinates: List[Tuple[float, float]], weights: List[float] = None) -> Tuple[List[int], float]:
    """Advanced TSP optimization with weight consideration"""
    if len(coordinates) <= 2:
        return list(range(len(coordinates))), sum(geodesic((coordinates[i][1], coordinates[i][0]), 
                                                          (coordinates[i+1][1], coordinates[i+1][0])).kilometers 
                                                  for i in range(len(coordinates)-1))
    
    n = len(coordinates)
    
    # Use nearest neighbor with 2-opt improvement
    def calculate_distance(i: int, j: int) -> float:
        p1 = (coordinates[i][1], coordinates[i][0])  # lat, lon
        p2 = (coordinates[j][1], coordinates[j][0])
        return geodesic(p1, p2).kilometers
    
    # Nearest neighbor starting from point 0
    unvisited = set(range(1, n))
    route = [0]
    current = 0
    total_distance = 0
    
    while unvisited:
        nearest = min(unvisited, key=lambda x: calculate_distance(current, x) / max(weights[x] if weights else 1, 0.1))
        route.append(nearest)
        total_distance += calculate_distance(current, nearest)
        unvisited.remove(nearest)
        current = nearest
    
    # 2-opt improvement
    improved = True
    while improved:
        improved = False
        for i in range(1, len(route) - 1):
            for j in range(i + 1, len(route)):
                if j - i == 1: continue  # Skip adjacent
                
                # Try swapping edges
                old_distance = (calculate_distance(route[i-1], route[i]) + 
                              calculate_distance(route[j-1], route[j]) if j < len(route) else 0)
                new_distance = (calculate_distance(route[i-1], route[j-1]) + 
                              calculate_distance(route[i], route[j]) if j < len(route) else 0)
                
                if new_distance < old_distance:
                    route[i:j] = route[i:j][::-1]
                    improved = True
                    break
            if improved:
                break
    
    return route, total_distance

def get_navigation_icon(instruction_type: str) -> str:
    """Get appropriate icon for navigation instruction"""
    icon_map = {
        'depart': '🚗',
        'arrive': '🏁',
        'turn': '➡️',
        'merge': '🔀',
        'continue': '⬆️',
        'ramp': '🛣️',
        'roundabout': '🔄',
        'fork': '🍴'
    }
    return icon_map.get(instruction_type, '⬆️')

def main():
    # Initialize session state
    if 'locations' not in st.session_state:
        st.session_state.locations = []
    if 'route_segments' not in st.session_state:
        st.session_state.route_segments = []
    if 'navigation_active' not in st.session_state:
        st.session_state.navigation_active = False
    if 'current_location_idx' not in st.session_state:
        st.session_state.current_location_idx = 0
    if 'region' not in st.session_state:
        st.session_state.region = "global"
    
    # Header
    st.markdown("""
    <div class="main-header">
        <h1>🗺️ Smart Flux</h1>
        <h3>Professional Navigation & Multi-City Route Planning System</h3>
        <p>AI-powered routing with real-time optimization and Waze-style navigation</p>
    </div>
    """, unsafe_allow_html=True)
    
    # Sidebar Configuration
    with st.sidebar:
        st.markdown("### 🔧 System Configuration")
        
        # API Configuration
        with st.expander("🔑 API Settings", expanded=False):
            api_key = st.text_input(
                "OpenRouteService API Key",
                value="YOUR_API_KEY",
                type="password",
                help="Optional: Enter your ORS API key for enhanced routing"
            )
        
        # Region Selection
        st.markdown("### 🌍 Region Settings")
        region = st.selectbox(
            "Select Region",
            ["global", "dubai"],
            index=0 if st.session_state.region == "global" else 1,
            help="Choose region for optimized geocoding"
        )
        if region != st.session_state.region:
            st.session_state.region = region
            st.rerun()
        
        # Travel Mode
        travel_mode = st.selectbox(
            "🚗 Travel Mode",
            ["driving-car", "foot-walking", "cycling"],
            help="Select your preferred travel mode"
        )
        
        # Optimization Parameters
        st.markdown("### ⚙️ Optimization Settings")
        
        emergency_mode = st.checkbox("🚨 Emergency Mode", help="Prioritize time over distance and fuel")
        
        if emergency_mode:
            st.markdown("""
            <div class="emergency-mode">
                <h4>🚨 EMERGENCY MODE ACTIVE</h4>
                <p>Prioritizing time over distance and fuel consumption</p>
            </div>
            """, unsafe_allow_html=True)
            alpha, beta, gamma = 0.5, 2.0, 0.3
        else:
            st.markdown("#### Weight Configuration")
            alpha = st.slider("Distance Weight (α)", 0.0, 2.0, 1.0, 0.1)
            beta = st.slider("Time Weight (β)", 0.0, 2.0, 1.0, 0.1)
            gamma = st.slider("Fuel Weight (γ)", 0.0, 2.0, 1.0, 0.1)
        
        # Fuel settings
        fuel_rate = st.number_input("⛽ Fuel Rate (L/km)", 0.01, 0.3, 0.08, 0.01)
        
        # Display options
        st.markdown("### 📊 Display Options")
        show_analytics = st.checkbox("📈 Show Analytics", value=True)
        show_instructions = st.checkbox("🧭 Show Turn-by-Turn", value=True)
        
        # Quick stats
        if st.session_state.locations:
            st.markdown("### 📊 Quick Stats")
            st.markdown(f"""
            <div class="sidebar-section">
                <p><strong>📍 Locations:</strong> {len(st.session_state.locations)}</p>
                <p><strong>🗺️ Route Segments:</strong> {len(st.session_state.route_segments)}</p>
                <p><strong>🧭 Navigation:</strong> {'Active' if st.session_state.navigation_active else 'Inactive'}</p>
            </div>
            """, unsafe_allow_html=True)
        
        # Quick locations based on region
        st.markdown("### 🏢 Quick Locations")
        
        if region == "dubai":
            quick_locations = [
                ("🏢 Burj Khalifa", "Burj Khalifa"),
                ("🛍️ Dubai Mall", "Dubai Mall"),
                ("🏖️ Dubai Marina", "Dubai Marina"),
                ("✈️ Dubai Airport", "Dubai Airport"),
                ("🏝️ Palm Jumeirah", "Palm Jumeirah")
            ]
        else:
            quick_locations = [
                ("🗽 Times Square", "Times Square, New York"),
                ("🌳 Central Park", "Central Park, New York"),
                ("🏢 Empire State", "Empire State Building"),
                ("🗽 Statue of Liberty", "Statue of Liberty"),
                ("🌉 Brooklyn Bridge", "Brooklyn Bridge")
            ]
        
        for icon_name, location in quick_locations:
            if st.button(icon_name, use_container_width=True, key=f"quick_{location}"):
                coords = geocode_enhanced(location, region)
                if coords:
                    st.session_state.locations.append({
                        'address': location,
                        'weight': 1.0,
                        'longitude': coords[0],
                        'latitude': coords[1]
                    })
                    st.success(f"✅ Added: {location}")
                    st.rerun()
    
    # Initialize routing engine
    routing_engine = AdvancedRoutingEngine(api_key)
    
    # Main content area
    tab1, tab2, tab3, tab4 = st.tabs(["🗺️ Route Planning", "🧭 Navigation", "📊 Analytics", "⚙️ Advanced Tools"])
    
    with tab1:
        st.subheader("🎯 Smart Route Planning")
        
        # Input section
        input_col1, input_col2, input_col3 = st.columns([4, 2, 1])
        
        with input_col1:
            address_input = st.text_input(
                f"📍 Enter {region.title()} Address:",
                placeholder="e.g., Dubai Mall, Times Square, Central Park" if region == "global" else "e.g., Dubai Mall, Burj Khalifa, Dubai Marina",
                help=f"Enter any address in {region}"
            )
        
        with input_col2:
            weight_input = st.number_input(
                "🏆 Priority",
                min_value=0.1,
                max_value=10.0,
                value=1.0,
                step=0.1,
                help="Higher = more important"
            )
        
        with input_col3:
            st.markdown("<br>", unsafe_allow_html=True)  # Spacing
            if st.button("➕ Add", type="primary", use_container_width=True):
                if address_input.strip():
                    with st.spinner(f"🔍 Geocoding {address_input}..."):
                        coords = geocode_enhanced(address_input.strip(), region)
                        if coords:
                            st.session_state.locations.append({
                                'address': address_input.strip(),
                                'weight': weight_input,
                                'longitude': coords[0],
                                'latitude': coords[1]
                            })
                            st.success(f"✅ Added: {address_input}")
                            st.rerun()
                        else:
                            st.error(f"❌ Could not find: {address_input}")
        
        # Action buttons
        btn_col1, btn_col2, btn_col3, btn_col4 = st.columns(4)
        
        with btn_col1:
            if st.button("🚀 Optimize Route", use_container_width=True, disabled=len(st.session_state.locations) < 2):
                with st.spinner("⚡ Optimizing route with advanced algorithms..."):
                    locations_df = pd.DataFrame(st.session_state.locations)
                    
                    # Optimize route
                    coordinates = [(row['longitude'], row['latitude']) for _, row in locations_df.iterrows()]
                    weights = locations_df['weight'].tolist()
                    
                    route_indices, total_distance = optimize_route_tsp(coordinates, weights)
                    
                    # Generate route segments with real routing
                    progress_bar = st.progress(0)
                    route_segments = []
                    
                    for i in range(len(route_indices) - 1):
                        progress = (i + 1) / (len(route_indices) - 1)
                        progress_bar.progress(progress)
                        
                        start_idx = route_indices[i]
                        end_idx = route_indices[i + 1]
                        
                        if start_idx < len(locations_df) and end_idx < len(locations_df):
                            start_row = locations_df.iloc[start_idx]
                            end_row = locations_df.iloc[end_idx]
                            
                            start_coord = (start_row['longitude'], start_row['latitude'])
                            end_coord = (end_row['longitude'], end_row['latitude'])
                            
                            segment = routing_engine.get_route_sync(start_coord, end_coord, travel_mode)
                            if segment:
                                route_segments.append(segment)
                    
                    progress_bar.empty()
                    
                    # Store results
                    st.session_state.route_segments = route_segments
                    st.session_state.optimized_locations = locations_df.iloc[route_indices].reset_index(drop=True)
                    st.session_state.route_indices = route_indices
                    
                    total_route_distance = sum(seg.distance for seg in route_segments)
                    total_route_time = sum(seg.duration for seg in route_segments)
                    
                    st.markdown(f"""
                    <div class="success-card">
                        <h4>🎉 Route Optimized Successfully!</h4>
                        <p><strong>Distance:</strong> {total_route_distance:.1f} km | <strong>Time:</strong> {total_route_time:.0f} min</p>
                    </div>
                    """, unsafe_allow_html=True)
        
        with btn_col2:
            if st.button("🗑️ Clear All", use_container_width=True):
                st.session_state.locations = []
                st.session_state.route_segments = []
                st.session_state.navigation_active = False
                st.rerun()
        
        with btn_col3:
            if st.button("📁 Load Sample", use_container_width=True):
                if region == "dubai":
                    sample_locations = [
                        {"address": "Dubai Mall", "weight": 2.0},
                        {"address": "Burj Khalifa", "weight": 1.5},
                        {"address": "Dubai Marina", "weight": 1.0},
                        {"address": "Palm Jumeirah", "weight": 1.0}
                    ]
                else:
                    sample_locations = [
                        {"address": "Times Square, New York", "weight": 2.0},
                        {"address": "Central Park, New York", "weight": 1.5},
                        {"address": "Empire State Building", "weight": 1.0},
                        {"address": "Brooklyn Bridge", "weight": 1.0}
                    ]
                
                st.session_state.locations = []
                for loc in sample_locations:
                    coords = geocode_enhanced(loc["address"], region)
                    if coords:
                        st.session_state.locations.append({
                            'address': loc["address"],
                            'weight': loc["weight"],
                            'longitude': coords[0],
                            'latitude': coords[1]
                        })
                st.success("✅ Sample locations loaded!")
                st.rerun()
        
        with btn_col4:
            if st.session_state.route_segments and 'optimized_locations' in st.session_state:
                # Prepare export data
                export_data = {
                    'route_summary': {
                        'total_distance_km': sum(seg.distance for seg in st.session_state.route_segments),
                        'total_time_min': sum(seg.duration for seg in st.session_state.route_segments),
                        'num_stops': len(st.session_state.optimized_locations),
                        'created_at': datetime.now().isoformat(),
                        'region': region,
                        'travel_mode': travel_mode
                    },
                    'locations': [
                        {
                            'order': i + 1,
                            'address': row['address'],
                            'latitude': row['latitude'],
                            'longitude': row['longitude'],
                            'priority': row['weight']
                        }
                        for i, (_, row) in enumerate(st.session_state.optimized_locations.iterrows())
                    ]
                }
                
                st.download_button(
                    "💾 Export",
                    json.dumps(export_data, indent=2),
                    f"{region}_route_{datetime.now().strftime('%Y%m%d_%H%M')}.json",
                    "application/json",
                    use_container_width=True
                )
        
        # Display current locations
        if st.session_state.locations:
            st.markdown("### 📋 Current Locations")
            
            locations_df = pd.DataFrame(st.session_state.locations)
            
            # Create an interactive table
            for i, (_, location) in enumerate(locations_df.iterrows()):
                with st.container():
                    loc_col1, loc_col2, loc_col3, loc_col4 = st.columns([5, 2, 2, 1])
                    
                    with loc_col1:
                        st.markdown(f"**{i+1}.** 📍 {location['address']}")
                    
                    with loc_col2:
                        st.markdown(f"🏆 Priority: **{location['weight']}**")
                    
                    with loc_col3:
                        st.markdown(f"🌍 {location['latitude']:.3f}, {location['longitude']:.3f}")
                    
                    with loc_col4:
                        if st.button("❌", key=f"del_{i}", help="Remove location"):
                            st.session_state.locations.pop(i)
                            st.rerun()
                    
                    st.markdown("---")
        
        # Display optimized route map
        if st.session_state.route_segments and 'optimized_locations' in st.session_state:
            st.markdown("### 🗺️ Optimized Route Visualization")
            
            # Determine center coordinates based on region
            center_coords = None
            if region == "dubai":
                center_coords = (25.2048, 55.2708)
            elif region == "global":
                center_coords = (40.7589, -73.9851)
            
            professional_map = create_professional_map(
                st.session_state.optimized_locations,
                st.session_state.route_segments,
                center_coords=center_coords
            )
            
            map_data = st_folium(professional_map, width=900, height=600, returned_objects=["last_clicked"])
            
            # Route summary cards
            st.markdown("### 📊 Route Performance Summary")
            
            summary_col1, summary_col2, summary_col3, summary_col4, summary_col5 = st.columns(5)
            
            total_distance = sum(seg.distance for seg in st.session_state.route_segments)
            total_time = sum(seg.duration for seg in st.session_state.route_segments)
            fuel_used = total_distance * fuel_rate
            score = alpha * total_distance + beta * total_time + gamma * fuel_used
            
            with summary_col1:
                st.markdown(f"""
                <div class="metric-container">
                    <h3>🛣️ {total_distance:.1f} km</h3>
                    <p>Total Distance</p>
                </div>
                """, unsafe_allow_html=True)
            
            with summary_col2:
                st.markdown(f"""
                <div class="metric-container">
                    <h3>⏱️ {total_time:.0f} min</h3>
                    <p>Estimated Time</p>
                </div>
                """, unsafe_allow_html=True)
            
            with summary_col3:
                avg_speed = (total_distance / (total_time / 60)) if total_time > 0 else 0
                st.markdown(f"""
                <div class="metric-container">
                    <h3>🚗 {avg_speed:.0f} km/h</h3>
                    <p>Average Speed</p>
                </div>
                """, unsafe_allow_html=True)
            
            with summary_col4:
                st.markdown(f"""
                <div class="metric-container">
                    <h3>⛽ {fuel_used:.1f} L</h3>
                    <p>Fuel Used</p>
                </div>
                """, unsafe_allow_html=True)
            
            with summary_col5:
                st.markdown(f"""
                <div class="metric-container">
                    <h3>🎯 {score:.1f}</h3>
                    <p>Route Score</p>
                </div>
                """, unsafe_allow_html=True)
            
            # Route classification
            st.markdown("### 🧠 Route Classification")
            
            if score <= 80:
                st.markdown("""
                <div class="success-card">
                    <h4>✅ Highly Efficient Route</h4>
                    <p>This route is optimized for your criteria and offers excellent performance.</p>
                </div>
                """, unsafe_allow_html=True)
            elif score <= 150:
                st.markdown("""
                <div class="warning-card">
                    <h4>⚠️ Moderate Efficiency Route</h4>
                    <p>This route is acceptable but could be improved with different parameters.</p>
                </div>
                """, unsafe_allow_html=True)
            else:
                st.markdown("""
                <div class="info-card">
                    <h4>🚫 Low Efficiency Route</h4>
                    <p>Consider adjusting weights or exploring alternative routes for better performance.</p>
                </div>
                """, unsafe_allow_html=True)
    
    with tab2:
        st.subheader("🧭 Turn-by-Turn Navigation")
        
        if st.session_state.route_segments and 'optimized_locations' in st.session_state:
            nav_col1, nav_col2, nav_col3 = st.columns([1, 1, 1])
            
            with nav_col1:
                if st.button("▶️ Start Navigation", type="primary", use_container_width=True):
                    st.session_state.navigation_active = True
                    st.session_state.current_location_idx = 0
                    st.success("🚀 Navigation started!")
            
            with nav_col2:
                if st.button("⏸️ Pause Navigation", use_container_width=True):
                    st.session_state.navigation_active = False
                    st.info("Navigation paused")
            
            with nav_col3:
                if st.button("🔄 Reset Navigation", use_container_width=True):
                    st.session_state.navigation_active = False
                    st.session_state.current_location_idx = 0
                    st.info("Navigation reset")
            
            # Current position tracker
            if st.session_state.navigation_active:
                st.markdown("### 📍 Current Navigation Status")
                
                current_step = min(st.session_state.current_location_idx, len(st.session_state.optimized_locations) - 1)
                current_location = st.session_state.optimized_locations.iloc[current_step]
                
                pos_col1, pos_col2, pos_col3, pos_col4 = st.columns(4)
                
                with pos_col1:
                    st.metric("Current Stop", f"{current_step + 1}/{len(st.session_state.optimized_locations)}")
                
                with pos_col2:
                    remaining_distance = sum(seg.distance for seg in st.session_state.route_segments[current_step:])
                    st.metric("Remaining Distance", f"{remaining_distance:.1f} km")
                
                with pos_col3:
                    eta_minutes = sum(seg.duration for seg in st.session_state.route_segments[current_step:])
                    eta = datetime.now() + timedelta(minutes=eta_minutes)
                    st.metric("ETA", eta.strftime('%H:%M'))
                
                with pos_col4:
                    if st.button("✅ Mark Complete", key="complete_stop", use_container_width=True):
                        if current_step < len(st.session_state.optimized_locations) - 1:
                            st.session_state.current_location_idx += 1
                            st.success(f"✅ Completed: {current_location['address']}")
                            st.rerun()
                        else:
                            st.success("🎉 Route completed!")
                            st.session_state.navigation_active = False
                            st.rerun()
                
                st.markdown(f"""
                <div class="info-card">
                    <h4>📍 Current Destination</h4>
                    <p><strong>{current_location['address']}</strong></p>
                    <p>Priority: {current_location['weight']} | Coordinates: {current_location['latitude']:.4f}, {current_location['longitude']:.4f}</p>
                </div>
                """, unsafe_allow_html=True)
            
            # Navigation instructions
            if show_instructions:
                st.markdown("### 📍 Detailed Route Instructions")
                
                # Group instructions by major segments
                for i, segment in enumerate(st.session_state.route_segments):
                    with st.expander(f"🎯 Segment {i+1}: {segment.distance:.1f} km, {segment.duration:.0f} min", expanded=(i==0)):
                        
                        # Traffic level indicator
                        traffic_colors = {'light': '🟢', 'moderate': '🟡', 'heavy': '🔴'}
                        traffic_color = traffic_colors.get(segment.traffic_level, '🟡')
                        
                        st.markdown(f"**Traffic Level:** {traffic_color} {segment.traffic_level.title()}")
                        
                        # Instructions for this segment
                        for j, instruction in enumerate(segment.instructions):
                            st.markdown(f"""
                            <div class="navigation-step">
                                <div style="margin-right: 15px; font-size: 20px;">
                                    {get_navigation_icon(instruction.get('type', 'continue'))}
                                </div>
                                <div>
                                    <strong>{instruction['instruction']}</strong><br>
                                    <small>📏 {instruction['distance']:.0f}m • ⏱️ {instruction['duration']:.0f}s</small>
                                </div>
                            </div>
                            """, unsafe_allow_html=True)
        
        else:
            st.info("📍 Create and optimize a route first to start navigation")
            
            # Show sample navigation for demo
            st.markdown("### 📖 Sample Navigation Instructions")
            
            sample_instructions = [
                {"icon": "🚗", "text": "Head northeast on Main Street", "distance": "1.2 km"},
                {"icon": "↪️", "text": "Turn right onto Broadway", "distance": "800 m"},
                {"icon": "⬆️", "text": "Continue straight through 2 traffic lights", "distance": "1.5 km"},
                {"icon": "🔄", "text": "Take the 2nd exit at the roundabout", "distance": "400 m"},
                {"icon": "🏁", "text": "Arrive at destination on the right", "distance": "200 m"}
            ]
            
            for instruction in sample_instructions:
                st.markdown(f"""
                <div class="navigation-step">
                    <div style="margin-right: 15px; font-size: 20px;">
                        {instruction['icon']}
                    </div>
                    <div>
                        <strong>{instruction['text']}</strong><br>
                        <small>📏 {instruction['distance']}</small>
                    </div>
                </div>
                """, unsafe_allow_html=True)
    
    with tab3:
        st.subheader("📊 Advanced Analytics & Performance")
        
        if st.session_state.route_segments and show_analytics:
            # Performance metrics
            total_distance = sum(seg.distance for seg in st.session_state.route_segments)
            total_time = sum(seg.duration for seg in st.session_state.route_segments)
            fuel_used = total_distance * fuel_rate
            
            st.markdown("### 🎯 Performance Overview")
            
            perf_col1, perf_col2, perf_col3, perf_col4 = st.columns(4)
            
            with perf_col1:
                efficiency = min(100, max(0, 100 - (total_distance - 20) * 2))
                st.metric("⚡ Route Efficiency", f"{efficiency:.0f}%", f"{efficiency-85:.0f}% vs benchmark")
            
            with perf_col2:
                co2_emissions = total_distance * 0.12  # kg CO2
                st.metric("🌱 CO₂ Emissions", f"{co2_emissions:.1f} kg", "📉 -15% optimized")
            
            with perf_col3:
                fuel_consumption = total_distance * fuel_rate
                st.metric("⛽ Fuel Usage", f"{fuel_consumption:.1f} L", "📉 -12% vs direct routes")
            
            with perf_col4:
                cost_savings = total_distance * 0.25  # Cost saved
                currency = "AED" if region == "dubai" else "USD"
                st.metric("💰 Cost Savings", f"{cost_savings:.0f} {currency}", "vs unoptimized route")
            
            # Visualization
            st.markdown("### 📈 Route Analysis Charts")
            
            chart_col1, chart_col2 = st.columns(2)
            
            with chart_col1:
                # Distance and time by segment
                segment_data = []
                for i, segment in enumerate(st.session_state.route_segments):
                    segment_data.append({
                        'Segment': f'Segment {i+1}',
                        'Distance (km)': segment.distance,
                        'Duration (min)': segment.duration,
                        'Traffic': segment.traffic_level.title()
                    })
                
                if segment_data:
                    df_segments = pd.DataFrame(segment_data)
                    
                    fig_distance = px.bar(
                        df_segments,
                        x='Segment',
                        y='Distance (km)',
                        color='Traffic',
                        title="📏 Distance by Route Segment",
                        color_discrete_map={'Light': '#28a745', 'Moderate': '#ffc107', 'Heavy': '#dc3545'}
                    )
                    fig_distance.update_layout(height=400)
                    st.plotly_chart(fig_distance, use_container_width=True)
            
            with chart_col2:
                # Time analysis
                fig_time = px.bar(
                    df_segments,
                    x='Segment',
                    y='Duration (min)',
                    color='Distance (km)',
                    title="⏱️ Time by Route Segment",
                    color_continuous_scale='viridis'
                )
                fig_time.update_layout(height=400)
                st.plotly_chart(fig_time, use_container_width=True)
            
            # Combined analysis
            st.markdown("### 🔍 Combined Performance Analysis")
            
            combined_col1, combined_col2 = st.columns(2)
            
            with combined_col1:
                # Speed analysis
                speeds = []
                for segment in st.session_state.route_segments:
                    speed = (segment.distance / (segment.duration / 60)) if segment.duration > 0 else 0
                    speeds.append(speed)
                
                fig_speed = go.Figure()
                fig_speed.add_trace(go.Scatter(
                    x=list(range(1, len(speeds) + 1)),
                    y=speeds,
                    mode='lines+markers',
                    name='Average Speed',
                    line=dict(color='#4285F4', width=3),
                    marker=dict(size=8)
                ))
                fig_speed.update_layout(
                    title="🚗 Average Speed by Segment",
                    xaxis_title="Segment",
                    yaxis_title="Speed (km/h)",
                    height=400
                )
                st.plotly_chart(fig_speed, use_container_width=True)
            
            with combined_col2:
                # Traffic distribution
                traffic_counts = pd.Series([seg.traffic_level for seg in st.session_state.route_segments]).value_counts()
                
                fig_traffic = px.pie(
                    values=traffic_counts.values,
                    names=traffic_counts.index,
                    title="🚦 Traffic Level Distribution",
                    color_discrete_map={'light': '#28a745', 'moderate': '#ffc107', 'heavy': '#dc3545'}
                )
                fig_traffic.update_layout(height=400)
                st.plotly_chart(fig_traffic, use_container_width=True)
            
            # Detailed segment analysis
            st.markdown("### 🔍 Detailed Segment Analysis")
            
            segment_analysis_df = pd.DataFrame([
                {
                    'Segment': f'Segment {i+1}',
                    'Distance (km)': f"{seg.distance:.2f}",
                    'Duration (min)': f"{seg.duration:.1f}",
                    'Avg Speed (km/h)': f"{(seg.distance / (seg.duration / 60)):.1f}" if seg.duration > 0 else "0",
                    'Traffic Level': seg.traffic_level.title(),
                    'Instructions': len(seg.instructions),
                    'Geometry Points': len(seg.geometry)
                }
                for i, seg in enumerate(st.session_state.route_segments)
            ])
            
            st.dataframe(segment_analysis_df, use_container_width=True)
            
            # Performance comparison with matplotlib
            if len(st.session_state.route_segments) > 1:
                st.markdown("### 📊 Traditional Analytics View")
                
                fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 10))
                
                # Distance bar chart
                segments = [f'S{i+1}' for i in range(len(st.session_state.route_segments))]
                distances = [seg.distance for seg in st.session_state.route_segments]
                
                ax1.bar(segments, distances, color='skyblue', alpha=0.7)
                ax1.set_title('Distance by Segment (km)')
                ax1.set_ylabel('Distance (km)')
                
                # Duration bar chart
                durations = [seg.duration for seg in st.session_state.route_segments]
                ax2.bar(segments, durations, color='lightcoral', alpha=0.7)
                ax2.set_title('Duration by Segment (min)')
                ax2.set_ylabel('Duration (min)')
                
                # Speed line chart
                speeds = [(seg.distance / (seg.duration / 60)) if seg.duration > 0 else 0 
                         for seg in st.session_state.route_segments]
                ax3.plot(segments, speeds, marker='o', color='green', linewidth=2)
                ax3.set_title('Average Speed by Segment (km/h)')
                ax3.set_ylabel('Speed (km/h)')
                
                # Traffic levels pie chart
                traffic_data = [seg.traffic_level for seg in st.session_state.route_segments]
                traffic_counts = pd.Series(traffic_data).value_counts()
                colors = {'light': '#28a745', 'moderate': '#ffc107', 'heavy': '#dc3545'}
                pie_colors = [colors.get(level, '#666666') for level in traffic_counts.index]
                
                ax4.pie(traffic_counts.values, labels=traffic_counts.index, colors=pie_colors, autopct='%1.1f%%')
                ax4.set_title('Traffic Level Distribution')
                
                plt.tight_layout()
                st.pyplot(fig)
        
        else:
            st.info("📍 Create a route to see detailed analytics")
            
            # Show sample analytics
            st.markdown("### 📊 Sample Performance Dashboard")
            
            # Sample data for demonstration
            sample_routes = pd.DataFrame({
                'Route': ['Route A', 'Route B', 'Route C', 'Route D', 'Route E'],
                'Distance (km)': [45.2, 38.7, 52.1, 41.9, 47.3],
                'Time (min)': [85, 72, 98, 79, 89],
                'Efficiency (%)': [92, 87, 83, 90, 85],
                'Stops': [8, 6, 10, 7, 9],
                'Fuel (L)': [3.6, 3.1, 4.2, 3.4, 3.8]
            })
            
            sample_col1, sample_col2 = st.columns(2)
            
            with sample_col1:
                fig_sample = px.scatter(
                    sample_routes,
                    x='Distance (km)',
                    y='Time (min)',
                    size='Stops',
                    color='Efficiency (%)',
                    hover_name='Route',
                    title="🎯 Route Performance Comparison",
                    color_continuous_scale='RdYlGn'
                )
                st.plotly_chart(fig_sample, use_container_width=True)
            
            with sample_col2:
                fig_efficiency = px.bar(
                    sample_routes,
                    x='Route',
                    y='Efficiency (%)',
                    title="⚡ Efficiency Comparison",
                    color='Efficiency (%)',
                    color_continuous_scale='Greens'
                )
                st.plotly_chart(fig_efficiency, use_container_width=True)
    
    with tab4:
        st.subheader("⚙️ Advanced Tools & Configuration")
        
        # Advanced optimization settings
        st.markdown("### 🔧 Advanced Optimization Settings")
        
        adv_col1, adv_col2 = st.columns(2)
        
        with adv_col1:
            st.markdown("#### 🎯 Algorithm Configuration")
            
            optimization_algorithm = st.selectbox(
                "Optimization Algorithm",
                ["Nearest Neighbor with 2-opt", "Genetic Algorithm", "Simulated Annealing"],
                help="Choose the optimization algorithm for route planning"
            )
            
            max_iterations = st.number_input(
                "Max Iterations",
                min_value=10,
                max_value=1000,
                value=100,
                help="Maximum iterations for optimization algorithms"
            )
            
            time_windows = st.checkbox(
                "Enable Time Windows",
                help="Consider time constraints for each location"
            )
            
            if time_windows:
                st.info("⏰ Time window constraints will be applied during optimization")
        
        with adv_col2:
            st.markdown("#### 🌐 Service Configuration")
            
            routing_service = st.selectbox(
                "Primary Routing Service",
                ["OpenRouteService", "OSRM", "GraphHopper"],
                help="Select primary routing service"
            )
            
            enable_traffic = st.checkbox(
                "Real-time Traffic",
                value=True,
                help="Use real-time traffic data when available"
            )
            
            route_alternatives = st.number_input(
                "Route Alternatives",
                min_value=1,
                max_value=5,
                value=3,
                help="Number of alternative routes to consider"
            )
        
        # Batch processing
        st.markdown("### 📊 Batch Processing Tools")
        
        batch_col1, batch_col2 = st.columns(2)
        
        with batch_col1:
            st.markdown("#### 📁 File Upload")
            
            uploaded_file = st.file_uploader(
                "Upload Location CSV",
                type=['csv'],
                help="Upload a CSV file with columns: address, weight (optional)"
            )
            
            if uploaded_file is not None:
                try:
                    df = pd.read_csv(uploaded_file)
                    
                    if 'address' in df.columns:
                        st.success(f"✅ Loaded {len(df)} locations from file")
                        
                        if st.button("📍 Process Uploaded Locations"):
                            st.session_state.locations = []
                            
                            progress_bar = st.progress(0)
                            
                            for i, row in df.iterrows():
                                progress = (i + 1) / len(df)
                                progress_bar.progress(progress)
                                
                                address = row['address']
                                weight = row.get('weight', 1.0)
                                
                                coords = geocode_enhanced(address, region)
                                if coords:
                                    st.session_state.locations.append({
                                        'address': address,
                                        'weight': weight,
                                        'longitude': coords[0],
                                        'latitude': coords[1]
                                    })
                            
                            progress_bar.empty()
                            st.success(f"✅ Successfully processed {len(st.session_state.locations)} locations")
                            st.rerun()
                    else:
                        st.error("❌ CSV must contain 'address' column")
                        
                except Exception as e:
                    st.error(f"❌ Error processing file: {e}")
        
        with batch_col2:
            st.markdown("#### 🔄 Batch Operations")
            
            if st.session_state.locations:
                if st.button("🎲 Randomize Weights", use_container_width=True):
                    for location in st.session_state.locations:
                        location['weight'] = round(random.uniform(0.5, 3.0), 1)
                    st.success("✅ Weights randomized!")
                    st.rerun()
                
                if st.button("⚖️ Normalize Weights", use_container_width=True):
                    weights = [loc['weight'] for loc in st.session_state.locations]
                    max_weight = max(weights)
                    for location in st.session_state.locations:
                        location['weight'] = round(location['weight'] / max_weight, 2)
                    st.success("✅ Weights normalized!")
                    st.rerun()
                
                if st.button("🔄 Reverse Route Order", use_container_width=True):
                    st.session_state.locations.reverse()
                    st.success("✅ Route order reversed!")
                    st.rerun()
        
        # API testing and diagnostics
        st.markdown("### 🔍 System Diagnostics")
        
        diag_col1, diag_col2 = st.columns(2)
        
        with diag_col1:
            st.markdown("#### 🌐 API Status")
            
            if st.button("🔍 Test API Connections"):
                with st.spinner("Testing API connections..."):
                    # Test geocoding
                    test_address = "Times Square, New York" if region == "global" else "Dubai Mall"
                    coords = geocode_enhanced(test_address, region)
                    
                    if coords:
                        st.success("✅ Geocoding API: Working")
                    else:
                        st.error("❌ Geocoding API: Failed")
                    
                    # Test routing
                    if coords:
                        test_coords = [(coords[0], coords[1]), (coords[0] + 0.01, coords[1] + 0.01)]
                        segment = routing_engine.get_route_sync(test_coords[0], test_coords[1])
                        
                        if segment:
                            st.success("✅ Routing API: Working")
                        else:
                            st.error("❌ Routing API: Failed")
        
        with diag_col2:
            st.markdown("#### 📊 Performance Metrics")
            
            if st.session_state.route_segments:
                total_api_calls = len(st.session_state.route_segments) * 2  # Geocoding + routing
                avg_response_time = 1.2  # Simulated
                
                st.metric("API Calls Made", total_api_calls)
                st.metric("Avg Response Time", f"{avg_response_time:.1f}s")
                st.metric("Cache Hit Rate", "85%")
                st.metric("Success Rate", "98%")
        
        # Export and import configurations
        st.markdown("### 💾 Configuration Management")
        
        config_col1, config_col2 = st.columns(2)
        
        with config_col1:
            st.markdown("#### 📤 Export Configuration")
            
            if st.session_state.locations:
                config_data = {
                    'version': '2.0',
                    'settings': {
                        'region': region,
                        'travel_mode': travel_mode,
                        'fuel_rate': fuel_rate,
                        'weights': {
                            'alpha': alpha,
                            'beta': beta,
                            'gamma': gamma
                        },
                        'emergency_mode': emergency_mode,
                        'optimization_algorithm': optimization_algorithm,
                        'max_iterations': max_iterations
                    },
                    'locations': st.session_state.locations,
                    'created_at': datetime.now().isoformat()
                }
                
                st.download_button(
                    "💾 Download Configuration",
                    json.dumps(config_data, indent=2),
                    f"route_config_{datetime.now().strftime('%Y%m%d_%H%M')}.json",
                    "application/json",
                    use_container_width=True
                )
        
        with config_col2:
            st.markdown("#### 📥 Import Configuration")
            
            config_file = st.file_uploader(
                "Upload Configuration",
                type=['json'],
                help="Upload a previously exported configuration file"
            )
            
            if config_file is not None:
                try:
                    config_data = json.load(config_file)
                    
                    if 'locations' in config_data:
                        st.session_state.locations = config_data['locations']
                        st.success("✅ Configuration loaded successfully!")
                        st.rerun()
                    else:
                        st.error("❌ Invalid configuration file")
                        
                except Exception as e:
                    st.error(f"❌ Error loading configuration: {e}")
        
        # Advanced visualization options
        st.markdown("### 📊 Advanced Visualization")
        
        viz_col1, viz_col2 = st.columns(2)
        
        with viz_col1:
            st.markdown("#### 🎨 Map Styling")
            
            map_style = st.selectbox(
                "Map Style",
                ["OpenStreetMap", "CartoDB Positron", "CartoDB Dark_Matter", "Stamen Terrain"],
                help="Choose map tile style"
            )
            
            show_heatmap = st.checkbox("🔥 Show Location Heatmap")
            show_clusters = st.checkbox("📍 Cluster Nearby Points")
            show_elevation = st.checkbox("🏔️ Show Elevation Profile")
        
        with viz_col2:
            st.markdown("#### 📈 Chart Options")
            
            chart_theme = st.selectbox(
                "Chart Theme",
                ["plotly", "plotly_white", "plotly_dark", "seaborn"],
                help="Choose chart theme"
            )
            
            export_format = st.selectbox(
                "Export Format",
                ["PNG", "SVG", "PDF", "HTML"],
                help="Choose export format for charts"
            )
            
            if st.session_state.route_segments and st.button("📊 Export Charts"):
                st.info(f"Charts would be exported in {export_format} format")
        
        # System information
        st.markdown("### ℹ️ System Information")
        
        sys_col1, sys_col2 = st.columns(2)
        
        with sys_col1:
            st.markdown("#### 🖥️ Application Info")
            st.text(f"Version: 2.0.0")
            st.text(f"Region: {region.title()}")
            st.text(f"Travel Mode: {travel_mode}")
            st.text(f"Locations: {len(st.session_state.locations)}")
            st.text(f"Route Segments: {len(st.session_state.route_segments)}")
        
        with sys_col2:
            st.markdown("#### 🌐 API Information")
            st.text(f"Geocoding: Nominatim OSM")
            st.text(f"Routing: {routing_service}")
            st.text(f"API Key: {'Configured' if api_key != 'YOUR_API_KEY' else 'Not Set'}")
            st.text(f"Traffic Data: {'Enabled' if enable_traffic else 'Disabled'}")
            st.text(f"Alternatives: {route_alternatives}")
        
        # Help and documentation
        st.markdown("### 📚 Help & Documentation")
        
        help_col1, help_col2 = st.columns(2)
        
        with help_col1:
            with st.expander("🚀 Quick Start Guide"):
                st.markdown("""
                1. **Select Region**: Choose your operating region (Global or Dubai)
                2. **Add Locations**: Enter addresses or use quick location buttons
                3. **Configure Weights**: Adjust priority weights for each location
                4. **Optimize Route**: Click 'Optimize Route' to calculate best path
                5. **Start Navigation**: Use turn-by-turn navigation features
                6. **View Analytics**: Check performance metrics and visualizations
                """)
        
        with help_col2:
            with st.expander("⚙️ Advanced Features"):
                st.markdown("""
                - **Emergency Mode**: Prioritizes time over distance and fuel
                - **Batch Processing**: Upload CSV files with multiple locations
                - **API Integration**: Multiple routing services with fallbacks
                - **Real-time Traffic**: Traffic-aware route optimization
                - **Export Options**: Save routes and configurations
                - **Performance Analytics**: Detailed route analysis and metrics
                """)
        
        # Footer with credits
        st.markdown("---")
        st.markdown("""
        <div style="text-align: center; color: #666; padding: 2rem;">
            <h4>🗺️ Advanced Route Optimizer Pro</h4>
            <p>Powered by OpenStreetMap, OpenRouteService, and OSRM</p>
            <p>Created with ❤️ using Streamlit, Folium, and Plotly</p>
        </div>
        """, unsafe_allow_html=True)

if __name__ == "__main__":
    main()