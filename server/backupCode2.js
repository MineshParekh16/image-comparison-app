const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { imageHash } = require('image-hash');

const app = express();
const port = 5000;
app.use(cors());
app.use(express.json());
app.use('/ourImages', express.static(path.join(__dirname, 'ourImages')));

mongoose.connect('mongodb://localhost:27017/image_comparison_db')
  .then(() => console.log('MongoDB connected successfully'))
  .catch((error) => console.error('MongoDB connection error:', error));

const imageSchema = new mongoose.Schema({
  imageHash: String,
  imageUrl: String,
  createdAt: { type: Date, default: Date.now },
});

imageSchema.index({ imageHash: 1 });

const Image = mongoose.model('Image', imageSchema);
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'clientImages/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage: storage });

async function getImageHash(imagePath) {
  return new Promise((resolve, reject) => {
    imageHash(imagePath, 16, true, (error, hash) => {
      if (error) {
        reject(error);
      } else {
        resolve(hash);
      }
    });
  });
}

function compareHashes(hash1, hash2) {
  let differences = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      differences++;
    }
  }
  return (differences / hash1.length) * 100;
}

async function syncImagesToDB() {
  try {
    const imageFolderPath = './ourImages';
    const files = fs.readdirSync(imageFolderPath);

    for (const file of files) {
      const filePath = path.join(imageFolderPath, file);
      if (fs.existsSync(filePath) && filePath.match(/\.(jpg|jpeg|png)$/)) {
        const imageHashValue = await getImageHash(filePath);
        const existingImage = await Image.findOne({ imageHash: imageHashValue });

        if (!existingImage) {
          const newImage = new Image({ imageHash: imageHashValue, imageUrl: filePath });
          await newImage.save();
          console.log(`Image ${file} synced to DB.`);
        } else {
          console.log(`Image ${file} already exists in DB.`);
        }
      }
    }
  } catch (error) {
    console.error('Error syncing images:', error);
  }
}

app.post('/upload', upload.single('image'), async (req, res) => {
  const uploadedImagePath = req.file.path;

  try {
    const uploadedImageHash = await getImageHash(uploadedImagePath);
    const existingImage = await Image.findOne({ imageUrl: uploadedImageHash });

    if (existingImage) {
      return res.status(400).json({ message: 'This image has already been uploaded.' });
    }

    res.status(200).json({ message: 'Image uploaded successfully', imageUrl: uploadedImagePath });
  } catch (err) {
    res.status(500).json({ message: 'Error uploading image', error: err });
  }
});

app.post('/compare', upload.single('image'), async (req, res) => {
  const uploadedImagePath = req.file.path;

  try {
    if (!uploadedImagePath) {
      return res.status(400).json({ message: 'Uploaded image is missing' });
    }

    const uploadedImageHash = await getImageHash(uploadedImagePath);
    console.log('Uploaded Image Hash:', uploadedImageHash);

    // Fetch all images once to avoid multiple DB hits
    const images = await Image.find().lean(); // Using .lean() to return plain JavaScript objects for better performance
    let similarImages = [];

    // Iterate over the images in memory
    await Promise.all(images.map(async (image) => {
      const storedImagePath = image.imageUrl;

      if (!fs.existsSync(storedImagePath)) {
        return;
      }

      const storedImageHash = await getImageHash(storedImagePath);
      console.log('Stored Image Hash:', storedImageHash);

      const difference = compareHashes(uploadedImageHash, storedImageHash);
      console.log('Difference:', difference);

      if (difference < 50) {
        similarImages.push({
          imageUrl: image.imageUrl,
          difference: difference,
        });
      }
    }));

    if (similarImages.length > 0) {
      res.status(200).json({ message: 'Similar images found', data: similarImages });
    } else {
      res.status(200).json({ message: 'No similar images found' });
    }

  } catch (err) {
    console.error('Error comparing images:', err);
    res.status(500).json({ message: 'Error comparing images', error: err.message });
  }
});

app.listen(port, () => {
  syncImagesToDB();
  console.log(`Server running on http://localhost:${port}`);
});
