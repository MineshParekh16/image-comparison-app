const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');
const blockhash = require('blockhash-core');
const pLimit = require('p-limit').default;

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());
app.use('/ourImages', express.static(path.join(__dirname, 'ourImages')));

// MongoDB setup
mongoose.connect('mongodb://localhost:27017/image_comparison_db')
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB error:', err));

const imageSchema = new mongoose.Schema({
  imageHash: String,
  imageUrl: String,
  createdAt: { type: Date, default: Date.now },
});
imageSchema.index({ imageHash: 1 });
const Image = mongoose.model('Image', imageSchema);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'clientImages/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

// Helper: Convert image to perceptual hash
async function getImageHash(imagePath) {
  try {
    const image = await Jimp.read(imagePath);
    const resized = image.resize(64, 64).grayscale();
    const bitmap = {
      data: resized.bitmap.data,
      width: resized.bitmap.width,
      height: resized.bitmap.height,
    };
    return blockhash.bmvbhash(bitmap, 16);
  } catch (err) {
    console.error('❌ Jimp failed to read:', imagePath, err.message);
    throw new Error(`Image read failed: ${imagePath}`);
  }
}

// Helper: Partial matching via cropping
async function getCroppedHashes(imagePath, patchSize = 64, step = 16) {
  const image = await Jimp.read(imagePath);
  const hashes = [];

  for (let y = 0; y <= image.bitmap.height - patchSize; y += step) {
    for (let x = 0; x <= image.bitmap.width - patchSize; x += step) {
      const cropped = image.clone().crop(x, y, patchSize, patchSize).resize(64, 64).grayscale();
      const bitmap = {
        data: cropped.bitmap.data,
        width: cropped.bitmap.width,
        height: cropped.bitmap.height,
      };
      const hash = await blockhash.bmvbhash(bitmap, 16);
      hashes.push(hash);
    }
  }

  return hashes;
}

// Hamming Distance
function hammingDistance(hash1, hash2) {
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
}

// Sync /ourImages
async function syncImagesToDB() {
  const folder = './ourImages';
  const files = fs.readdirSync(folder);

  for (const file of files) {
    const filePath = path.join(folder, file);
    if (file.match(/\.(jpg|jpeg|png)$/i)) {
      try {
        const hash = await getImageHash(filePath);
        const exists = await Image.findOne({ imageHash: hash });

        if (!exists) {
          await new Image({ imageHash: hash, imageUrl: filePath }).save();
          console.log(`✅ Synced ${file}`);
        } else {
          console.log(`⚠️ ${file} already in DB`);
        }
      } catch (err) {
        console.error(`❌ Failed ${file}:`, err.message);
      }
    }
  }
}

// Upload
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const hash = await getImageHash(req.file.path);
    const exists = await Image.findOne({ imageHash: hash });

    if (exists) {
      return res.status(400).json({ message: 'This image already exists' });
    }

    res.status(200).json({
      message: 'Image uploaded successfully',
      imageUrl: req.file.path,
    });
  } catch (err) {
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

// Compare
app.post('/compare', upload.single('image'), async (req, res) => {
  try {
    const uploadedHash = await getImageHash(req.file.path);
    const images = await Image.find().lean();
    const limit = pLimit(5);
    let exactMatch = null;
    const similarImages = [];

    const tasks = images.map(image =>
      limit(async () => {
        const distance = hammingDistance(uploadedHash, image.imageHash);
        const similarity = ((64 - distance) / 64) * 100;

        if (distance === 0) {
          exactMatch = {
            imageUrl: image.imageUrl,
            similarity: '100.00',
          };
        } else if (similarity >= 70) {
          similarImages.push({
            imageUrl: image.imageUrl,
            similarity: similarity.toFixed(2),
          });
        }
      })
    );

    await Promise.all(tasks);

    if (exactMatch) {
      return res.status(200).json({
        message: 'Exact match found',
        data: [exactMatch],
      });
    }

    if (similarImages.length > 0) {
      return res.status(200).json({
        message: 'Similar images found',
        data: similarImages,
      });
    }

    // Partial match fallback
    const croppedHashes = await getCroppedHashes(req.file.path);

    for (const chash of croppedHashes) {
      for (const image of images) {
        const distance = hammingDistance(chash, image.imageHash);
        const similarity = ((64 - distance) / 64) * 100;

        if (similarity >= 70) {
          return res.status(200).json({
            message: 'Partial/cropped image match found',
            data: [{
              imageUrl: image.imageUrl,
              similarity: similarity.toFixed(2),
              note: 'This match is based on a cropped region of the uploaded image',
            }],
          });
        }
      }
    }

    res.status(200).json({ message: 'No similar images found' });
  } catch (err) {
    res.status(500).json({ message: 'Comparison failed', error: err.message });
  }
});

// Start
app.listen(port, () => {
  syncImagesToDB();
  console.log(`🚀 Server running at http://localhost:${port}`);
});