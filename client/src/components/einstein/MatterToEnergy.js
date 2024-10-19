import { useState } from 'react';
import "../../styles/converters.css"; 
import "../../styles/car.css"; 
import CommentDisplay from '../CommentDisplay'; 

const MatterToEnergy = () => {
  const [grams, setGrams] = useState('');
  const [energy, setEnergy] = useState(null);

  const speedOfLight = 3 * Math.pow(10, 8); // Speed of light in m/s
  const energyPerMegatonTNT = 4.18 * Math.pow(10, 15); // Energy in joules for 1 megaton of TNT
  const energyPerKgTNT = 4.184 * Math.pow(10, 6); // Energy in joules for 1 kg of TNT
  const energyPerHiroshimaBomb = 6.276 * Math.pow(10, 13); // Energy in joules for Hiroshima bomb
  const energyPerTsarBomb = 2.09 * Math.pow(10, 17); // Energy in joules for Tsar bomb

  const handleConvert = () => {
    if (grams) {
      const massKg = grams / 1000; // Convert grams to kilograms
      const energyJoules = massKg * Math.pow(speedOfLight, 2); // Calculate energy in joules
      const energyKWh = energyJoules / 3.6e6; // Convert joules to kWh
      const energyEv = energyJoules / 1.60218e-19; // Convert joules to eV
      const energyCalories = energyJoules / 4.184; // Convert joules to calories
      
      // Convert to TNT equivalents
      const energyMegatonsTNT = energyJoules / energyPerMegatonTNT; // Energy in megatons of TNT
      const energyKgTNT = energyJoules / energyPerKgTNT; // Energy in kilograms of TNT
      const energyHiroshimaBombs = energyJoules / energyPerHiroshimaBomb; // Energy in Hiroshima bombs
      const energyTsarBombs = energyJoules / energyPerTsarBomb; // Energy in Tsar bombs

      setEnergy({
        joules: energyJoules.toFixed(2),
        kWh: energyKWh.toFixed(8),
        eV: energyEv.toExponential(3),
        calories: energyCalories.toFixed(2),
        megatonsTNT: energyMegatonsTNT.toFixed(5),
        kgTNT: energyKgTNT.toFixed(2),
        hiroshimaBombs: energyHiroshimaBombs.toFixed(5),
        tsarBombs: energyTsarBombs.toFixed(5),
      });
    }
  };

  const clearFields = () => {
    setGrams("");
    setEnergy(null)
  }

  return (
    <div className='convertersMainArea'>
      <h2>Convert Mass to Energy (E = mc²)</h2>
      <div className='inputButtonContainer'>
        <div>
          <input type="number" className='input2'
            value={grams} onChange={(e) => setGrams(e.target.value)} />
          <label>Enter Mass in Grams</label>
        </div>
        <div>
          <button onClick={handleConvert} className='button201'>Convert</button>
          <button onClick={clearFields} className='button201'>Clear</button>
        </div>

      </div>
      {energy && (
        <div>
          {/* Display the formula */}
          <div style={{ margin: "20px 0", fontSize: "1.2em" }}>
            E<sub>joules</sub> = m<sub>kg</sub> × (3 × 10<sup>8</sup>)<sup>2</sup>
          </div>
          <p><strong>Energy in Joules:</strong> {energy.joules} J</p>
          <p><strong>Energy in Kilowatt-hours:</strong> {energy.kWh} kWh</p>
          <p><strong>Energy in Electronvolts:</strong> {energy.eV} eV</p>
          <p><strong>Energy in Calories:</strong> {energy.calories} cal</p>
          <p><strong>Equivalent in Megatons of TNT:</strong> {energy.megatonsTNT}</p>
          <p><strong>Equivalent in Kilograms of TNT:</strong> {energy.kgTNT}</p>
          <p><strong>Equivalent in Hiroshima Atomic Bombs:</strong> {energy.hiroshimaBombs}</p>
          <p><strong>Equivalent in Tsar Hydrogen Bombs:</strong> {energy.tsarBombs}</p>
        </div>
      )}

      <div> <br/><br/><br/><br/><br/><br/><br/> </div>
      <div> <CommentDisplay pageId={11}/></div>
    </div>
  );
};

export default MatterToEnergy;
