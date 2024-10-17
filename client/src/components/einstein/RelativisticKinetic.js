import React, { useState } from 'react';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css'; // Import the KaTeX CSS for proper styling of Einstein formula

function RelativisticKinetic() {
  const [resultArea, setResultArea] = useState('');

  // Constants for unit conversions
  const JOULES_TO_KWH = 2.77778e-7;
  const JOULES_TO_EV = 6.242e+18;
  const JOULES_TO_CAL = 0.239006;
  const JOULES_TO_MEGATONS_TNT = 2.39e-16;
  const JOULES_TO_KG_TNT = 2.39e-4;
  const JOULES_TO_HIROSHIMA = 6.3e+13; // Approximate energy released by the Hiroshima bomb
  const JOULES_TO_TSAR_BOMB = 2.1e+17; // Approximate energy released by Tsar bomb

  const calculateKineticEnergy = (e) => {
    e.preventDefault(); // prevent form from refreshing page

    const formData = new FormData(e.target);
    const restMass = formData.get('restMass'); // in kilograms
    const velocityKmPerSec = formData.get('velocity'); // in km/s

    let m0 = Number(restMass);
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
      alert('Velocity must be less than the speed of light (299792.458 km/s). Kinetic energy becomes infinite as you approach light speed.');
      return;
    }

    // Constant
    const c = 299792458;   // Speed of light in m/s

    // Calculate the Lorentz factor (gamma)
    const gamma = 1 / Math.sqrt(1 - (Math.pow(v, 2) / Math.pow(c, 2)));

    // Calculate the relativistic kinetic energy in joules
    const kineticEnergyJoules = (gamma - 1) * m0 * Math.pow(c, 2); // in joules

    // Convert the energy into different units
    const energy = {
      joules: kineticEnergyJoules.toFixed(3),
      kWh: (kineticEnergyJoules * JOULES_TO_KWH).toFixed(10),
      eV: (kineticEnergyJoules * JOULES_TO_EV).toExponential(3),
      calories: (kineticEnergyJoules * JOULES_TO_CAL).toFixed(3),
      megatonsTNT: (kineticEnergyJoules * JOULES_TO_MEGATONS_TNT).toFixed(10),
      kgTNT: (kineticEnergyJoules * JOULES_TO_KG_TNT).toFixed(6),
      hiroshimaBombs: (kineticEnergyJoules / JOULES_TO_HIROSHIMA).toFixed(6),
      tsarBombs: (kineticEnergyJoules / JOULES_TO_TSAR_BOMB).toFixed(9),
    };

    setResultArea(
      <div style={{ textAlign: 'left' }}>
        <span>Rest Mass: {m0} kilograms</span> <br/>
        <br/>
        <span>Velocity: {vKm} km/s</span> <br/><br/>
        <p><strong>Energy in Joules:</strong> {energy.joules} J</p>
        <p><strong>Energy in Kilowatt-hours:</strong> {energy.kWh} kWh</p>
        <p><strong>Energy in Electronvolts:</strong> {energy.eV} eV</p>
        <p><strong>Energy in Calories:</strong> {energy.calories} cal</p>
        <p><strong>Equivalent in Megatons of TNT:</strong> {energy.megatonsTNT} MT</p>
        <p><strong>Equivalent in Kilograms of TNT:</strong> {energy.kgTNT} kg</p>
        <p><strong>Equivalent in Hiroshima Atomic Bombs:</strong> {energy.hiroshimaBombs} bombs</p>
        <p><strong>Equivalent in Tsar Hydrogen Bombs:</strong> {energy.tsarBombs} bombs</p>
        <br/>
        <span>
          Relativistic Kinetic Energy Equation (KE: kinetic energy, m: rest mass, v: velocity km/s, c: speed of light m/s):
        </span>
        <BlockMath>
          {'KE = (\\gamma - 1) m c^2'}
        </BlockMath>
      </div>
    );
  }

  const clearKineticEnergyForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return (
    <div>
      <h1 className='formHeader'>Relativistic Kinetic Energy Calculator</h1>
      <form className='formInvestment' onSubmit={calculateKineticEnergy}>
        
        <input
          className='inputFields'
          type='number'
          name='restMass'
          id='restMass'
          aria-label='Enter Rest Mass in kilograms.'
          min="1"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='restMass'>Enter Rest Mass (in kilograms)</label> <br/><br/>

        <input
          className='inputFields'
          type='number'
          name='velocity'
          id='velocity'
          aria-label='Enter Velocity in kilometers per second.'
          min="1"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='velocity'>Enter Velocity (in km/s)</label> <br/><br/>

        <button className='button101' type="submit">Calculate</button>
        <button className='button101' onClick={clearKineticEnergyForm}>Clear</button>
      </form>

      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>

      <div> <br/><br/><br/><br/><br/><br/><br/> </div>

      <div> <CommentDisplay pageId={14}/></div>
    </div>
  )
}

export default RelativisticKinetic;
