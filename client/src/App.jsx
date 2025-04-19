import React, { useState, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [image, setImage] = useState(null);
  const [similarImages, setSimilarImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [currentDateTime, setCurrentDateTime] = useState('');

  useEffect(() => {
    const getGreeting = () => {
      const currentHour = new Date().getHours();
      if (currentHour < 12) {
        return 'Good Morning';
      } else if (currentHour < 17) {
        return 'Good Afternoon';
      } else {
        return 'Good Evening';
      }
    };

    const getCurrentDateTime = () => {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const hours = now.getHours() % 12 || 12;
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
      return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
    };

    setGreeting(getGreeting());
    setCurrentDateTime(getCurrentDateTime());

    const intervalId = setInterval(() => {
      setCurrentDateTime(getCurrentDateTime());
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  const handleFileChange = (e) => {
    setSimilarImages([])
    setImage(URL.createObjectURL(e.target.files[0]));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData();
    formData.append('image', e.target.image.files[0]);

    try {
      const uploadResponse = await axios.post('https://image-comparison-app.onrender.com/upload', formData);
      if (uploadResponse.data.message?.includes('Similar images found')) {
        setSimilarImages(uploadResponse.data.matches);
        alert('Image uploaded and compared successfully!');
      } else {
        alert(uploadResponse.data.message);
      }
    } catch (error) {
      console.error('Error uploading or comparing image:', error);
      alert('Error uploading or comparing image');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className='headerStyle'>
        <div>{greeting}</div>
        <div>{currentDateTime}</div>
      </header>

      <div className='middle-section'>
        <h1>Image Comparison</h1>
        <form onSubmit={handleSubmit}>
          <input type="file" name="image" onChange={handleFileChange} />
          <button type="submit" disabled={loading || !image}>
            {loading ? 'Comparing...' : 'Compare Image'}
          </button>
        </form>
        {image && (
          <div>
            <h2>Preview Image</h2>
            <img src={image} alt="Preview" style={{ width: '200px' }} />
          </div>
        )}

        {similarImages.length > 0 && (
          <div>
            <h2>Similar Images</h2>
            <div className='main-compared-image'>
              {similarImages.map((image, index) => (
                <div className='compared-image' key={index}>
                  <img src={`https://image-comparison-app.onrender.com/${image.imagePath}`} alt={`Similar image ${index}`} style={{ width: '200px' }} />
                  <p>Similarity: {image.matchScore}%</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px',
  backgroundColor: '#f0f0f0',
  borderBottom: '1px solid #ddd',
  fontSize: '16px',
};

export default App;