const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { PNG } = require('pngjs');
const pLimit = require('p-limit').default;

// Fix for pixelmatch default import issue
const _pixelmatch = require('pixelmatch');
const pixelmatch = _pixelmatch.default || _pixelmatch;

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());
app.use('/ourImages', express.static(path.join(__dirname, 'ourImages')));

// MongoDB Setup
mongoose.connect('mongodb://localhost:27017/image_comparison_db')
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch((error) => console.error('❌ MongoDB connection error:', error));

const imageSchema = new mongoose.Schema({
  imageHash: String,
  imageUrl: String,
  createdAt: { type: Date, default: Date.now },
});

imageSchema.index({ imageHash: 1 });
const Image = mongoose.model('Image', imageSchema);

// Multer Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'clientImages/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({ storage });

// Helper: Convert Image to PNG Buffer
async function convertToPngBuffer(imagePath) {
  return await sharp(imagePath)
    .resize(64, 64)
    .grayscale()
    .png()
    .toBuffer();
}

// Helper: Generate MD5 Hash
const crypto = require('crypto');
async function generateHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// Helper: Compare Two PNG Buffers
function getPixelDifference(buf1, buf2) {
  const img1 = PNG.sync.read(buf1);
  const img2 = PNG.sync.read(buf2);

  const { width, height } = img1;
  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, {
    threshold: 0.1,
  });

  const similarity = ((width * height - numDiffPixels) / (width * height)) * 100;
  return similarity;
}

// Sync /ourImages to DB
async function syncImagesToDB() {
  const imageFolderPath = './ourImages';
  const files = fs.readdirSync(imageFolderPath);

  for (const file of files) {
    const filePath = path.join(imageFolderPath, file);
    if (filePath.match(/\.(jpg|jpeg|png)$/i)) {
      try {
        const buffer = await convertToPngBuffer(filePath);
        const imageHash = await generateHash(buffer);
        const existingImage = await Image.findOne({ imageHash });

        if (!existingImage) {
          const newImage = new Image({ imageHash, imageUrl: filePath });
          await newImage.save();
          console.log(`✅ Image ${file} synced to DB.`);
        } else {
          console.log(`⚠️ Image ${file} already exists in DB.`);
        }
      } catch (err) {
        console.error(`❌ Failed to process ${file}:`, err.message);
      }
    }
  }
}

// Upload API
app.post('/upload', upload.single('image'), async (req, res) => {
  const uploadedPath = req.file.path;

  try {
    const buffer = await convertToPngBuffer(uploadedPath);
    const imageHash = await generateHash(buffer);
    const existingImage = await Image.findOne({ imageHash });

    if (existingImage) {
      return res.status(400).json({ message: 'This image has already been uploaded.' });
    }

    res.status(200).json({ message: 'Image uploaded successfully', imageUrl: uploadedPath });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading image', error: error.message });
  }
});

// Compare API
app.post('/compare', upload.single('image'), async (req, res) => {
  const uploadedPath = req.file.path;

  try {
    const uploadedBuffer = await convertToPngBuffer(uploadedPath);
    const images = await Image.find().lean();
    const similarImages = [];
    const limit = pLimit(5);

    const tasks = images.map((image) =>
      limit(async () => {
        try {
          if (!fs.existsSync(image.imageUrl)) {
            console.warn(`⚠️ File missing: ${image.imageUrl}`);
            return;
          }

          const storedBuffer = await convertToPngBuffer(image.imageUrl);
          const diffPercentage = getPixelDifference(uploadedBuffer, storedBuffer);

          if (diffPercentage > 50) {
            similarImages.push({
              imageUrl: image.imageUrl,
              similarity: diffPercentage.toFixed(2),
            });
          }
        } catch (err) {
          console.error('❌ Error processing image:', image.imageUrl, err.message);
        }
      })
    );

    await Promise.all(tasks);

    if (similarImages.length > 0) {
      res.status(200).json({ message: 'Similar images found', data: similarImages });
    } else {
      res.status(200).json({ message: 'No similar images found' });
    }
  } catch (error) {
    console.error('❌ Error comparing images:', error);
    res.status(500).json({ message: 'Error comparing images', error: error.message });
  }
});

// Start Server
app.listen(port, () => {
  syncImagesToDB();
  console.log(`🚀 Server running on http://localhost:${port}`);
});
