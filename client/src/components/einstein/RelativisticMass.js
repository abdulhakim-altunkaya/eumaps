import React, { useState } from 'react';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css'; // Import the KaTeX CSS for proper styling of Einstein formula

function RelativisticMass() {
  const [resultArea, setResultArea] = useState(<span>Speed of light: 299,792.4580 km/s</span>);

  // Constants for unit conversions
  const GRAMS_TO_KG = 1e-3;       // 1 kilo  = 1e3 grams
  const GRAMS_TO_TON = 1e-6;      // 1 ton = 1e6 grams
  const GRAMS_TO_MEGATON = 1e-12; // 1 megaton = 1e12 grams
  const GRAMS_TO_GIGATON = 1e-15; // 1 gigaton = 1e15 grams

  const calculateRelativisticMass = (e) => {
    e.preventDefault(); // prevent form from refreshing page

    const formData = new FormData(e.target);
    const restMassGrams = formData.get('restMass'); // in grams
    const velocityKmPerSec = formData.get('velocity'); // in km/s

    let m0 = Number(restMassGrams); // Rest mass in grams
    let vKm = Number(velocityKmPerSec);
    let v = vKm * 1000; // Convert km/s to m/s

    if (m0 <= 0 || isNaN(m0)) {
      alert('Rest mass is not valid.');
      return;
    }

    if (vKm <= 0 || isNaN(vKm)) {
      alert('Velocity is not valid.');
      return;
    }

    if (v >= 299792458) {
      alert('Velocity must be less than the speed of light (299792.458 km/s). Relativistic mass becomes infinite as you approach light speed.');
      return;
    }

    // Constant
    const c = 299792458;   // Speed of light in m/s

    // Calculate the Lorentz factor (gamma)
    const gamma = 1 / Math.sqrt(1 - (Math.pow(v, 2) / Math.pow(c, 2)));

    // Calculate the relativistic mass in grams
    const relativisticMassGrams = gamma * m0;

    // Convert the mass into different units
    const mass = {
      grams: relativisticMassGrams.toFixed(2),
      kilos: (relativisticMassGrams * GRAMS_TO_KG).toFixed(2),
      tons: (relativisticMassGrams * GRAMS_TO_TON).toFixed(4),
      megatons: (relativisticMassGrams * GRAMS_TO_MEGATON).toFixed(6),
      gigatons: (relativisticMassGrams * GRAMS_TO_GIGATON).toFixed(8),
    };

    // Calculate the velocity as a ratio of the speed of light
    const velocityRatio = (v / c).toFixed(20); // Displaying to 20 decimal places

    setResultArea(
      <div className='relativisticMassMainDiv' style={{ textAlign: 'left' }}>
        <span>Rest Mass: {restMassGrams} grams</span> <br/>
        <br/>
        <span>Velocity: {vKm} km/s</span> <br/>
        <span>Speed of light: 299,792.4580 km/s</span> <br/>
        <span>Velocity to speed of light ratio: <strong>{velocityRatio}</strong></span> <br/><br/>
        <p><strong>Relativistic Mass in Grams:</strong> {mass.grams} g</p>
        <p><strong>Relativistic Mass in Kilos:</strong> {mass.kilos} kg</p>
        <p><strong>Relativistic Mass in Tons:</strong> {mass.tons} tons</p>
        <p><strong>Relativistic Mass in Megatons:</strong> {mass.megatons} megatons</p>
        <p><strong>Relativistic Mass in Gigatons:</strong> {mass.gigatons} gigatons</p>
        <br/>
        <span>
          Relativistic Mass Equation (m: relativistic mass, m₀: rest mass in grams, v: velocity, c: speed of light km/s):
        </span>
        <BlockMath>
          {'m(v) = \\frac{m_0}{\\sqrt{1 - \\frac{v^2}{c^2}}}'}
        </BlockMath>
        <div className='resultAreaRelativisticMass'>
            <p>As an object approaches the speed of light, its relativistic mass (in other words ineartial mass at 
                relativistic speeds) increases significantly. As an object moves faster, it gains more kinetic energy. 
                In relativity, this extra energy contributes to the object's inertia, which is interpreted as an 
                increase in its relativistic mass. The closer an object gets to the speed of light, the more 
                energy is required to keep accelerating it, because the relativistic mass increases dramatically.</p>
            <p>However, keep in mind that the relations between gravitational waves, inertial mass, rest mass and gravitational 
                mass at relativistic speeds are not fully explored. And Einstein later distanced himself from 
                "relativistic mass" concept and said "energy increases" (Relativistic Kinetic Energy Calculator). 
                So, when it is said "mass increases" do not directly understand it as its size 
                or weight increases. This area is still open to your ideas.</p>
        </div>
      </div>
    );
  }

  const clearRelativisticMassForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return (
    <div>
      <h1 className='formHeader'>Relativistic Mass Calculator</h1>
      <form className='formInvestment' onSubmit={calculateRelativisticMass}>
        
        <input
          className='inputFields'
          type='number'
          name='restMass'
          id='restMass'
          aria-label='Enter Rest Mass in grams.'
          min="1"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='restMass'>Enter Rest Mass (in grams)</label> <br/><br/>

        <input
          className='inputFields'
          type='number'
          name='velocity'
          id='velocity'
          aria-label='Enter Velocity in kilometers per second.'
          step="any"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='velocity'>Enter Velocity (in km/s)</label> <br/><br/>

        <button className='button101' type="submit">Calculate</button>
        <button className='button101' onClick={clearRelativisticMassForm}>Clear</button>
      </form>
      
      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>

      <div> <br/><br/><br/><br/><br/><br/><br/> </div>

      <div> <CommentDisplay pageId={26}/></div>
    </div>
  )
}

export default RelativisticMass;
