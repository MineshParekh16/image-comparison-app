from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
import os
import imagehash
from PIL import Image

app = Flask(__name__)

# ✅ Enable CORS for all origins and methods
CORS(app, resources={r"/*": {"origins": "*"}})

client = MongoClient('mongodb://localhost:27017/')
db = client['image_comparison_db']
collection = db['images']

OUR_IMAGE_FOLDER = 'our_images'
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg'}

# Function to calculate perceptual hash of an image
def calculate_hash(image_path, size=(64, 64)):
    try:
        img = Image.open(image_path).convert("L").resize(size)
        return str(imagehash.phash(img))  # Generate perceptual hash (phash)
    except Exception as e:
        print(f"❌ Error reading image: {image_path} — {e}")
        return None

# Sync images from folder to DB
def sync_images_to_db():
    print("🔁 Syncing images to DB...")
    for file_name in os.listdir(OUR_IMAGE_FOLDER):
        ext = os.path.splitext(file_name)[-1].lower()
        if ext in ALLOWED_EXTENSIONS:
            image_path = os.path.join(OUR_IMAGE_FOLDER, file_name)
            image_hash = calculate_hash(image_path)
            if image_hash:
                exists = collection.find_one({'imageHash': image_hash})
                if not exists:
                    collection.insert_one({
                        'imageHash': image_hash,
                        'imagePath': image_path
                    })
                    print(f"✅ Synced: {file_name}")
                else:
                    print(f"⚠️ Already in DB: {file_name}")

@app.route('/')
def home():
    return "🟢 Image Comparison Server is Running"

@app.route('/upload', methods=['POST'])
def upload_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400

    path = os.path.join('client_images', file.filename)
    file.save(path)

    # Calculate the perceptual hash of the uploaded image (resize to 64x64)
    uploaded_hash_str = calculate_hash(path, size=(64, 64))

    if uploaded_hash_str is None:
        return jsonify({'error': 'Failed to process image'}), 500

    # Convert the uploaded hash string to ImageHash object
    uploaded_hash_obj = imagehash.hex_to_hash(uploaded_hash_str)

    # Compare with all existing images in the DB
    matches = []
    threshold = 5  # Set a reasonable threshold for similarity

    for doc in collection.find():
        db_hash_str = doc.get('imageHash')
        db_hash_obj = imagehash.hex_to_hash(db_hash_str)

        # Calculate the Hamming distance between the uploaded image hash and the DB hash
        distance = uploaded_hash_obj - db_hash_obj

        # If the distance is below the threshold, consider the images as similar
        if distance <= threshold:
            match_score = 100 - (distance / (uploaded_hash_obj.hash.size)) * 100  # Calculate match percentage
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

# Serve image files from the "our_images" directory
@app.route('/our_images/<filename>')
def serve_image(filename):
    return send_from_directory(OUR_IMAGE_FOLDER, filename)

if __name__ == '__main__':
    sync_images_to_db()  # Sync images from folder to DB before starting the server
    app.run(debug=True)
