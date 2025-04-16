const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { imageHash } = require('image-hash'); // Import the hash function correctly

const app = express();
const port = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Set up mongoose (MongoDB)
mongoose.connect('mongodb://localhost:27017/image_comparison_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const imageSchema = new mongoose.Schema({
  imageUrl: String,
  createdAt: { type: Date, default: Date.now },
});

const Image = mongoose.model('Image', imageSchema);

// Configure multer (for file uploads)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Helper function to generate hash for an image
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

// Helper function to download image from URL
async function downloadImage(imageUrl, downloadPath) {
  const writer = fs.createWriteStream(downloadPath);
  const response = await axios({
    url: imageUrl,
    method: 'GET',
    responseType: 'stream',
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(downloadPath));
    writer.on('error', (error) => reject(error));
  });
}

// Helper function to compare image hashes
function compareHashes(hash1, hash2) {
  let differences = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      differences++;
    }
  }
  return (differences / hash1.length) * 100; // Returns percentage of difference
}

// Upload image route - Now does not save to DB, only uploads to folder
app.post('/upload', upload.single('image'), async (req, res) => {
  const uploadedImagePath = req.file.path;

  try {
    // Image uploaded but not saved in DB
    res.status(200).json({ message: 'Image uploaded successfully', imageUrl: uploadedImagePath });
  } catch (err) {
    res.status(500).json({ message: 'Error uploading image', error: err });
  }
});

// Route to compare uploaded image with images in MongoDB
app.post('/compare', upload.single('image'), async (req, res) => {
  const uploadedImagePath = req.file.path;

  try {
    // Check if uploaded image path is valid
    if (!uploadedImagePath) {
      return res.status(400).json({ message: 'Uploaded image is missing' });
    }

    // Get hash for the uploaded image
    const uploadedImageHash = await getImageHash(uploadedImagePath);
    console.log('Uploaded Image Hash:', uploadedImageHash);

    // Get all images from MongoDB
    const images = await Image.find();
    let similarImages = [];

    // Loop through all stored images to compare hashes
    for (const image of images) {
      const storedImageUrl = image.imageUrl;

      // Download the stored image if it's a URL
      let storedImagePath = 'uploads/' + path.basename(storedImageUrl); // Create a local path for the image

      if (storedImageUrl.startsWith('http')) {
        // Download the image from the URL if it is remote
        try {
          await downloadImage(storedImageUrl, storedImagePath);
        } catch (error) {
          console.error('Error downloading image:', storedImageUrl, error);
          continue;  // Skip this image if download fails
        }
      } else {
        storedImagePath = storedImageUrl; // Use local path if the image is stored locally
      }

      // Check if the image file exists before proceeding with hash generation
      if (!fs.existsSync(storedImagePath)) {
        console.error('Image file not found:', storedImagePath);
        continue;  // Skip this image if it doesn't exist
      }

      // Get hash for the stored image
      const storedImageHash = await getImageHash(storedImagePath);
      console.log('Stored Image Hash:', storedImageHash);

      // Compare the hashes
      const difference = compareHashes(uploadedImageHash, storedImageHash);
      console.log('Difference:', difference);

      // If the difference is less than 50%, consider it a similar image
      if (difference < 50) {
        // Send the imageUrl from the database (which could be a local or remote URL) 
        similarImages.push({
          imageUrl: image.imageUrl, // Return the imageUrl from the database
          difference: difference,
        });
      }

      // Clean up the downloaded image after comparison if it was a remote URL
      if (storedImageUrl.startsWith('http') && fs.existsSync(storedImagePath)) {
        fs.unlinkSync(storedImagePath); // Delete the file after processing
      }
    }

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

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});


node index.js
yarn run dev