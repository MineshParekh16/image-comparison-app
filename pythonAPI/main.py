from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
import os
import imagehash
from PIL import Image
import cv2
import numpy as np

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

client = MongoClient('mongodb://localhost:27017/')
db = client['image_comparison_db']
collection = db['images']

OUR_IMAGE_FOLDER = 'our_images'
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg'}

def calculate_hash(image_path, size=(64, 64)):
    try:
        img = Image.open(image_path).convert("L").resize(size)
        return imagehash.phash(img)
    except:
        return None

def sync_images_to_db():
    for file_name in os.listdir(OUR_IMAGE_FOLDER):
        ext = os.path.splitext(file_name)[-1].lower()
        if ext in ALLOWED_EXTENSIONS:
            image_path = os.path.join(OUR_IMAGE_FOLDER, file_name)
            image_hash = calculate_hash(image_path)
            if image_hash:
                exists = collection.find_one({'imageHash': str(image_hash)})
                if not exists:
                    collection.insert_one({
                        'imageHash': str(image_hash),
                        'imagePath': image_path
                    })

@app.route('/')
def home():
    return "Image Comparison Server is Running"

@app.route('/upload', methods=['POST'])
def upload_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400

    os.makedirs('client_images', exist_ok=True)
    path = os.path.join('client_images', file.filename)
    file.save(path)

    uploaded_hash_obj = calculate_hash(path)
    if uploaded_hash_obj is None:
        return jsonify({'error': 'Failed to process image'}), 500

    uploaded_hash_str = str(uploaded_hash_obj)

    # 1. Exact match using hash
    exact_match = collection.find_one({'imageHash': uploaded_hash_str})
    if exact_match:
        return jsonify({
            'message': 'Similar images found',
            'matches': [{
                'matchScore': 100.0,
                'imagePath': exact_match.get('imagePath'),
                'imageHash': uploaded_hash_str
            }]
        }), 200

    # 2. Similar match using hash
    matches = []
    for doc in collection.find():
        db_hash_str = doc.get('imageHash')
        if db_hash_str is None:
            continue  # Skip entries without hash

        try:
            db_hash_obj = imagehash.hex_to_hash(db_hash_str)
            distance = uploaded_hash_obj - db_hash_obj
            match_score = 100 - (distance / (uploaded_hash_obj.hash.size)) * 100
            if match_score >= 75:
                matches.append({
                    'matchScore': round(match_score, 2),
                    'imagePath': doc.get('imagePath'),
                    'imageHash': db_hash_str
                })
        except Exception as e:
            print(f"Hash comparison error: {e}")
            continue

    if matches:
        return jsonify({
            'message': 'Similar images found (hash)',
            'matches': sorted(matches, key=lambda x: -x['matchScore'])
        }), 200

    # 3. Fallback: ORB-based cropped image detection
    def orb_feature_match(cropped_img_path, full_img_path, match_threshold=10):
        cropped_img = cv2.imread(cropped_img_path, cv2.IMREAD_GRAYSCALE)
        full_img = cv2.imread(full_img_path, cv2.IMREAD_GRAYSCALE)
        if cropped_img is None or full_img is None:
            return None, 0

        orb = cv2.ORB_create()
        kp1, des1 = orb.detectAndCompute(cropped_img, None)
        kp2, des2 = orb.detectAndCompute(full_img, None)

        if des1 is None or des2 is None:
            return None, 0

        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(des1, des2)
        good_matches = [m for m in matches if m.distance < 50]

        return good_matches, len(good_matches)

    orb_matches = []
    for doc in collection.find():
        db_path = doc.get('imagePath')
        if not os.path.exists(db_path):
            continue

        good_matches, good_count = orb_feature_match(path, db_path)
        if good_matches is not None and good_count >= 30:
            orb_matches.append({
                'matchScore': good_count,
                'imagePath': db_path
            })

    if orb_matches:
        return jsonify({
            'message': 'Similar images found (ORB)',
            'matches': sorted(orb_matches, key=lambda x: -x['matchScore'])
        }), 200

    return jsonify({'message': 'No match found (hash or cropped)'}), 200

@app.route('/our_images/<filename>')
def serve_image(filename):
    return send_from_directory(OUR_IMAGE_FOLDER, filename)

if __name__ == '__main__':
    sync_images_to_db()
    app.run(debug=True)
