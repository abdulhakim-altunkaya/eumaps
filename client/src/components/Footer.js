// src/components/Footer.js
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaHome } from 'react-icons/fa';
import '../styles/Footer.css';

const Footer = () => {
  const navigate = useNavigate();
 
  const handleHomeClick = () => {
    navigate('/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="footer" role="contentinfo" aria-label="Footer">
      <div className="footer-content">
        <div className="footer-header">
          <p>Icons:
            <a href="https://icons8.com/icons" target="_blank" rel="noopener noreferrer" 
              aria-label="Link to icons8 website for the icons used on this website">icons8</a> and 
            <a href="https://www.flaticon.com/" target="_blank" rel="noopener noreferrer" 
              aria-label="Data link to TÜİK site">Flaticon</a>
          </p>
          <FaHome
            className="home-icon"
            onClick={handleHomeClick}
            aria-label="Go to homepage"
          />
        </div>
        <p>Website Manager: <a href='https://www.youtube.com/@soft.tomatoes'>Soft Tomatoes</a> </p>
        <p>Contact: <a href="mailto:drysoftware1@gmail.com" aria-label="Email contact to DrySoftware">drysoftware1@gmail.com</a></p>

      </div>
    </footer>
  );
};

export default Footer;
