from flask import Flask, request, jsonify
import numpy as np
import pandas as pd
import joblib
import os
from flask_cors import CORS
import random

# Create Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for frontend access

# Load the trained model
model_path = os.path.join(os.path.dirname(__file__), 'collision_risk_model.pkl')
model = joblib.load(model_path)

# Load example data for feature reference
try:
    example_data = pd.read_csv('collision_risk_dataset_preprocessed.csv')
    feature_names = list(example_data.drop(columns=['collision_risk']).columns)
except Exception as e:
    print(f"Warning: Could not load example data: {e}")
    # Fallback feature names based on the model
    feature_names = [
        'altitude', 'inclination', 'eccentricity', 'raan', 
        'arg_perigee', 'mean_anomaly', 'mean_motion', 'velocity_magnitude'
    ]

def extract_features_from_request(request_data):
    """Extract relevant features from the request data for model prediction"""
    satellite_id = request_data.get('satellite_id', '')
    
    # If this is a real API with real data, features would be extracted from TLE or other satellite data
    # For this demo, we'll generate realistic features based on the satellite ID
    
    # Generate a deterministic seed from the satellite ID
    seed = sum(ord(c) for c in satellite_id)
    random.seed(seed)
    
    # Generate realistic feature values for different types of satellites
    if 'ISS' in satellite_id:
        # ISS-like orbit: ~400km altitude, 51.6° inclination, nearly circular
        features = {
            'altitude': 408 + random.uniform(-5, 5),
            'inclination': 51.6 + random.uniform(-0.2, 0.2),
            'eccentricity': 0.0001 + random.uniform(0, 0.0005),
            'raan': random.uniform(0, 360),
            'arg_perigee': random.uniform(0, 360),
            'mean_anomaly': random.uniform(0, 360),
            'mean_motion': 15.5 + random.uniform(-0.1, 0.1),
            'velocity_magnitude': 7.66 + random.uniform(-0.05, 0.05)
        }
    elif 'NOAA' in satellite_id:
        # NOAA-like orbit: sun-synchronous, ~800km, high inclination
        features = {
            'altitude': 825 + random.uniform(-10, 10),
            'inclination': 98.7 + random.uniform(-0.3, 0.3),
            'eccentricity': 0.001 + random.uniform(0, 0.001),
            'raan': random.uniform(0, 360),
            'arg_perigee': random.uniform(0, 360),
            'mean_anomaly': random.uniform(0, 360),
            'mean_motion': 14.2 + random.uniform(-0.1, 0.1),
            'velocity_magnitude': 7.45 + random.uniform(-0.05, 0.05)
        }
    elif 'OSTM' in satellite_id:
        # OSTM/Jason-like orbit: ~1300km, 66° inclination
        features = {
            'altitude': 1336 + random.uniform(-15, 15),
            'inclination': 66 + random.uniform(-0.3, 0.3),
            'eccentricity': 0.0004 + random.uniform(0, 0.0008),
            'raan': random.uniform(0, 360),
            'arg_perigee': random.uniform(0, 360),
            'mean_anomaly': random.uniform(0, 360),
            'mean_motion': 12.8 + random.uniform(-0.1, 0.1),
            'velocity_magnitude': 7.2 + random.uniform(-0.05, 0.05)
        }
    elif 'Debris' in satellite_id:
        # Debris with varying orbits, but often in higher risk areas
        features = {
            'altitude': 750 + random.uniform(-150, 350),
            'inclination': random.uniform(20, 100),
            'eccentricity': random.uniform(0.0001, 0.02),
            'raan': random.uniform(0, 360),
            'arg_perigee': random.uniform(0, 360),
            'mean_anomaly': random.uniform(0, 360),
            'mean_motion': random.uniform(12, 15),
            'velocity_magnitude': random.uniform(7.1, 7.8)
        }
    else:
        # Generic satellite
        features = {
            'altitude': random.uniform(400, 1500),
            'inclination': random.uniform(0, 110),
            'eccentricity': random.uniform(0, 0.02),
            'raan': random.uniform(0, 360),
            'arg_perigee': random.uniform(0, 360),
            'mean_anomaly': random.uniform(0, 360),
            'mean_motion': random.uniform(12, 16),
            'velocity_magnitude': random.uniform(7.1, 7.8)
        }
    
    # Ensure all needed features are available in the correct order
    feature_vector = []
    for feature in feature_names:
        if feature in features:
            feature_vector.append(features[feature])
        else:
            # Provide a sensible default for any missing features
            feature_vector.append(0.0)
    
    return np.array(feature_vector).reshape(1, -1)

def get_risk_level(probability):
    """Convert probability to risk level string"""
    if probability >= 0.7:
        return "High"
    elif probability >= 0.4:
        return "Medium"
    else:
        return "Low"

def get_time_to_closest_approach(risk_probability):
    """Generate realistic time to closest approach based on risk"""
    # Higher risk generally means closer approach time
    if risk_probability >= 0.7:
        hours = random.randint(1, 24)  # Higher risk = closer in time
    elif risk_probability >= 0.4:
        hours = random.randint(24, 72)  # Medium risk
    else:
        hours = random.randint(72, 168)  # Lower risk = further in time
    
    minutes = random.randint(0, 59)
    return f"{hours}h {minutes}m"

def get_potential_collisions(risk_probability):
    """Generate number of potential collision objects based on risk"""
    if risk_probability >= 0.7:
        return random.randint(3, 6)
    elif risk_probability >= 0.4:
        return random.randint(1, 3)
    else:
        return random.randint(0, 1)

@app.route('/api/collision-risk', methods=['POST'])
def predict_collision_risk():
    """API endpoint to predict collision risk for a satellite"""
    try:
        request_data = request.get_json()
        
        if not request_data or 'satellite_id' not in request_data:
            return jsonify({
                'error': 'Missing satellite_id in request'
            }), 400
        
        # Extract features from request
        features = extract_features_from_request(request_data)
        
        # Make prediction
        risk_probability = model.predict_proba(features)[0][1]  # Get probability of the positive class
        
        # Generate response
        response = {
            'satellite_id': request_data['satellite_id'],
            'risk_probability': float(risk_probability),
            'risk_level': get_risk_level(risk_probability),
            'time_to_closest_approach': get_time_to_closest_approach(risk_probability),
            'potential_collisions': get_potential_collisions(risk_probability),
            'features_used': feature_names
        }
        
        return jsonify(response)
        
    except Exception as e:
        print(f"Error processing request: {e}")
        return jsonify({
            'error': str(e)
        }), 500

# Error handler
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Server error'}), 500

# Simple test endpoint
@app.route('/api/ping', methods=['GET'])
def ping():
    return jsonify({'status': 'ok', 'message': 'Collision Risk API is running'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True) 