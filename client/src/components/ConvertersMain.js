import React from 'react';
import {useNavigate} from "react-router-dom";
import "../styles/ConvertersMain.css"; 
import Footer from './Footer';

function ConvertersMain() {
  
  const navigate = useNavigate(); 

  return (
    <div>
      <h1 className='convertersMainH1Long'>Converters & Calculators</h1>
      <div className='convertersMain'>
        <div className='convertersIconsMainArea'>          
            <div className="converter-item" onClick={ () => navigate("/weight-units-converter")}>
                <span className="converter-name">Weight</span>
                <span className="icon-wrapper"><img src="/icons/weight.png" className="unitIcons" alt="Clickable Weight Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/length-units-converter")}>
                <span className="converter-name">Length</span>
                <span className="icon-wrapper"><img src="/icons/length.png" className="unitIcons" alt="Clickable Length Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/temperature-units-converter")}>
                <span className="converter-name">Temperature</span>
                <span className="icon-wrapper"><img src="/icons/temperature.png" className="unitIcons" alt="Clickable Temperature Icon"/></span>
            </div>
        </div>
        <div className='convertersIconsMainArea'>
            <div className="converter-item" onClick={ () => navigate("/area-units-converter")}>
                <span className="converter-name">Area</span>
                <span className="icon-wrapper"><img src="/icons/area.png" className="unitIcons" alt="Clickable Area Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/volume-units-converter")}>
                <span className="converter-name">Volume</span>
                <span className="icon-wrapper"><img src="/icons/volume2.png" className="unitIcons" alt="Clickable Volume Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/time-units-converter")}>
                <span className="converter-name">Time</span>
                <span className="icon-wrapper"><img src="/icons/time.png" className="unitIcons" alt="Clickable Time Icon"/></span>
            </div>
        </div>
        <div className='convertersIconsMainArea'>
            <div className="converter-item" onClick={ () => navigate("/einstein-mass-energy-converter")}>
                <span className="converter-name2">Einstein Mass-Energy</span>
                <span className="icon-wrapper"><img src="/icons/einstein.png" className="unitIcons" 
                    alt="Clickable Einstein Mass-Energy Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/einstein-time-dilation-calculator")}>
                <span className="converter-name2">Einstein Time Dilation (Speed)</span>
                <span className="icon-wrapper"><img src="/icons/dilation.png" className="unitIcons" 
                    alt="Clickable Einstein Speed Based Time Dilation Calculator Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/einstein-gravitational-time-dilation-calculator")}>
                <span className="converter-name2">Einstein Time Dilation (Gravity)</span>
                <span className="icon-wrapper"><img src="/icons/gravity.png" className="unitIcons" 
                    alt="Clickable Einstein Gravitational Time Dilation Calculator Icon"/></span>
            </div>
        </div>
      </div>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <Footer/>
    </div>

  )
}

export default ConvertersMain