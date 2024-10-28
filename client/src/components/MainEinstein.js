import React from 'react';
import {useNavigate} from "react-router-dom";
import "../styles/ConvertersMain.css"; 

function MainEinstein() {
  
  const navigate = useNavigate(); 

  return (
    <div className='mainAreasMainComponents'>
      <div className='parentAreasTitleDiv'><h1 className='convertersMainH1Long'>Einstein Calculators</h1></div>
      <div className='convertersMain'>
        <div className='convertersIconsMainArea'>
            <div className="converter-item" onClick={ () => navigate("/einstein-mass-energy-converter")}>
                <span className="converter-name2">Mass-Energy</span>
                <span className="icon-wrapper"><img src="/icons/einstein.png" className="unitIcons" 
                    alt="Clickable Einstein Mass-Energy Converter Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/einstein-time-dilation-calculator")}>
                <span className="converter-name2">Time Dilation (Speed)</span>
                <span className="icon-wrapper"><img src="/icons/dilation.png" className="unitIcons" 
                    alt="Clickable Einstein Speed Based Time Dilation Calculator Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/einstein-gravitational-time-dilation-calculator")}>
                <span className="converter-name2">Time Dilation (Gravity)</span>
                <span className="icon-wrapper"><img src="/icons/gravity.png" className="unitIcons" 
                    alt="Clickable Einstein Gravitational Time Dilation Calculator Icon"/></span>
            </div>
        </div>
        <div className='convertersIconsMainArea'>
            <div className="converter-item" onClick={ () => navigate("/einstein-length-contraction-calculator")}>
                <span className="converter-name2">Length Contraction</span>
                <span className="icon-wrapper"><img src="/icons/contraction.png" className="unitIcons" 
                    alt="Clickable Einstein Length Contraction Calculator Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/einstein-relativistic-kinetic-energy-calculator")}>
                <span className="converter-name2">Relativistic Kinetic Energy</span>
                <span className="icon-wrapper"><img src="/icons/kinetic.png" className="unitIcons" 
                    alt="Clickable Einstein Relativistic Kinetic Energy Calculator Icon"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/einstein-relativistic-mass-calculator")}>
                <span className="converter-name2">Relativistic Mass</span>
                <span className="icon-wrapper"><img src="/icons/weight.png" className="unitIcons" 
                    alt="Clickable Einstein Relativistic Mass Calculator Icon"/></span>
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

export default MainEinstein