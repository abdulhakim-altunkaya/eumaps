import React from 'react';
import {useNavigate} from "react-router-dom";
import "../styles/ConvertersMain.css"; 

function MainConverters() {
  
  const navigate = useNavigate(); 

  return (
    <div className='mainAreasMainComponents'>
      <div className='parentAreasTitleDiv'><h1 className='convertersMainH1'>Converters</h1></div>
      <div className='convertersMain'>
        <div className='convertersIconsMainArea'>          
            <div className="converter-item" onClick={ () => navigate("/weight-units-converter")}>
                <span className="converter-name">Weight</span>
                <span><img src="/icons/weight.png" className="unitIcons" alt="Clickable Weight Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/length-units-converter")}>
                <span className="converter-name">Length</span>
                <span><img src="/icons/length.png" className="unitIcons" alt="Clickable Length Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/temperature-units-converter")}>
                <span className="converter-name">Temperature</span>
                <span><img src="/icons/temperature.png" className="unitIcons" alt="Clickable Temperature Icon"/></span>
            </div>
        </div>
        <div className='convertersIconsMainArea'>
            <div className="converter-item" onClick={ () => navigate("/area-units-converter")}>
                <span className="converter-name">Area</span>
                <span><img src="/icons/area.png" className="unitIcons" alt="Clickable Area Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/volume-units-converter")}>
                <span className="converter-name">Volume</span>
                <span><img src="/icons/volume2.png" className="unitIcons" alt="Clickable Volume Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/time-units-converter")}>
                <span className="converter-name">Time</span>
                <span><img src="/icons/time.png" className="unitIcons" alt="Clickable Time Icon"/></span>
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
    </div>

  )
}

export default MainConverters;