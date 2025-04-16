from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
import os
import imagehash
from PIL import Image

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

    path = os.path.join('client_images', file.filename)
    file.save(path)

    uploaded_hash_obj = calculate_hash(path)
    if uploaded_hash_obj is None:
        return jsonify({'error': 'Failed to process image'}), 500

    uploaded_hash_str = str(uploaded_hash_obj)

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

    matches = []
    for doc in collection.find():
        db_hash_str = doc.get('imageHash')
        db_hash_obj = imagehash.hex_to_hash(db_hash_str)
        distance = uploaded_hash_obj - db_hash_obj
        match_score = 100 - (distance / (uploaded_hash_obj.hash.size)) * 100
        if match_score >= 55:
            matches.append({
                'matchScore': round(match_score, 2),
                'imagePath': doc.get('imagePath'),
                'imageHash': db_hash_str
            })

    if matches:
        return jsonify({
            'message': 'Similar images found',
            'matches': sorted(matches, key=lambda x: -x['matchScore'])
        }), 200

    return jsonify({'message': 'No similar image found'}), 200

@app.route('/our_images/<filename>')
def serve_image(filename):
    return send_from_directory(OUR_IMAGE_FOLDER, filename)

if __name__ == '__main__':
    sync_images_to_db()
    app.run(debug=True)
