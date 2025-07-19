import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css'; // Import the KaTeX CSS for proper styling of Einstein formula
import Footer from "../Footer";

function RelativisticKinetic() {
  const pageIdVisitorPage = "einstein_rel_kinetic";
  useEffect(() => {
    const getData = async () => {
      try {
        // Send the request to log the visitor data without awaiting its completion
        axios.post(`/serversavevisitor/${pageIdVisitorPage}`, {}).catch((error) => {
          console.error('Error logging visit:', error.message);
        });
      } catch (error) {
        console.log(error.message);
      }
    };
    getData();
  }, []);

  const [resultArea, setResultArea] = useState(<span>Speed of light: 299,792.4580 km/s</span>);

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
    const restMassGrams = formData.get('restMass'); // in grams
    const velocityKmPerSec = formData.get('velocity'); // in km/s

    let m0 = Number(restMassGrams) / 1000; // Convert grams to kilograms
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

    // Calculate the velocity as a ratio of the speed of light
    const velocityRatio = (v / c).toFixed(20); // Displaying to 5 decimal places

    // Convert the energy into different units
    const energy = {
      joules: kineticEnergyJoules.toFixed(2),
      kWh: (kineticEnergyJoules * JOULES_TO_KWH).toFixed(2),
      eV: (kineticEnergyJoules * JOULES_TO_EV).toExponential(2),
      calories: (kineticEnergyJoules * JOULES_TO_CAL).toFixed(2),
      kgTNT: (kineticEnergyJoules * JOULES_TO_KG_TNT).toFixed(2),
      megatonsTNT: (kineticEnergyJoules * JOULES_TO_MEGATONS_TNT).toFixed(2),
      hiroshimaBombs: (kineticEnergyJoules / JOULES_TO_HIROSHIMA).toFixed(4),
      tsarBombs: (kineticEnergyJoules / JOULES_TO_TSAR_BOMB).toFixed(6),
    };

    setResultArea(
      <div className='relativisticKineticMainDiv' style={{ textAlign: 'left' }}>
        <span>Rest Mass: {restMassGrams} grams</span> <br/>
        <br/>
        <span>Velocity: {vKm} km/s</span> <br/>
        <span>Speed of light: 299,792.4580 km/s</span> <br/>
        <span>Velocity to speed of light ratio: <strong>{velocityRatio}</strong></span> <br/><br/>
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
          Relativistic Kinetic Energy Equation (KE: kinetic energy, m: rest mass in grams, y: Lorentz factor, c: speed of light km/s):
        </span>
        <BlockMath>
          {'KE = (\\gamma - 1) m c^2'}
        </BlockMath>
        <span>
          In relativity, the total energy of an object is given by equation below. For an object at rest, Lorentz factor is 1.
          For an object moving at relativistic speeds, Lorentz factor grows very large.
        </span>
          <BlockMath>
            {'E_{total} = \\gamma mc^2'}
          </BlockMath>
        <span> 
          This total energy includes both the rest energy and the energy due to motion (kinetic energy). 
          To isolate the kinetic energy, we subtract the rest energy from the total energy:
          <BlockMath>
            {'KE = E_{total} - E_{rest} = \\gamma mc^2 - mc^2 = (\\gamma - 1) mc^2'}
          </BlockMath>
        </span>
        <span>
          If an object moving at relativistic speeds hits the Earth, approximately 90% of its kinetic energy will
          convert into an explosion (heat, shockwaves, seismic waves, etc). Atmospheric drag for objects moving at 
          relativistic speed is negligible. During these type of impacts, rest enegy of the object is not converted into
          explosion, only its kinetic energy is converted to explosion (90%). For impact scenarios where kinetic energy 
          and rest energy together convert into explosion, the impact should be accompanied by a type of nuclear detonation or 
          matter-antimatter annihilation.
        </span>

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
          aria-label='Enter Rest Mass in grams.'
          min="1"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='restMass'>Rest Mass (in grams)</label> <br/><br/>

        <input
          className='inputFields'
          type='number'
          name='velocity'
          id='velocity'
          aria-label='Enter Velocity in kilometers per second.'
          step="any"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='velocity'>Velocity (in km/s)</label> <br/><br/>

        <button className='button101' type="submit">Calculate</button>
        <button className='button101' onClick={clearKineticEnergyForm}>Clear</button>
      </form>
      
      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>

      <div> <br/><br/><br/><br/><br/><br/><br/> </div>

      <div> <CommentDisplay pageId={13}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </div>
  )
}

export default RelativisticKinetic;
