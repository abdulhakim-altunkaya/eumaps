import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css'; // Import the KaTeX CSS for proper styling of Einstein formula
import Footer from "../Footer";

function GravitationalTimeDilation() {
  const pageIdVisitorPage = "einstein_gravity";
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
 
  const [resultArea, setResultArea] = useState('');

  const calculateTimeDilation = (e) => {
    e.preventDefault(); // prevent form from refreshing page

    const formData = new FormData(e.target);
    const distantObserverTime = formData.get('observerTime');
    const massOfObjectSolar = formData.get('massOfObject'); // in Solar masses
    const radius = formData.get('radius'); // in kilometers (now)

    let observerTime = Number(distantObserverTime);
    let massSolar = Number(massOfObjectSolar);
    let radiusInKilometers = Number(radius);

    if (observerTime <= 0 || isNaN(observerTime)) {
      alert('Observer time is not valid.');
      return;
    }

    if (massSolar <= 0 || isNaN(massSolar)) {
      alert('Mass of the object in Solar masses is not valid.');
      return;
    }

    if (radiusInKilometers <= 0 || isNaN(radiusInKilometers)) {
      alert('Radius must be a positive number.');
      return;
    }

    // Constants
    const G = 6.67430e-11; // Gravitational constant in m^3 kg^(-1) s^(-2)
    const c = 299792458;   // Speed of light in m/s
    const solarMass = 1.989e30; // Mass of Sun in kg

    // Convert input radius from kilometers to meters
    const radiusInMeters = radiusInKilometers * 1000;

    // Convert input mass from Solar masses to kilograms
    const massOfObject = massSolar * solarMass;

    // Calculate the Schwarzschild radius for the given mass
    const schwarzschildRadius = (2 * G * massOfObject) / Math.pow(c, 2);

    // Check if the radius is less than or equal to the Schwarzschild radius
    if (radiusInMeters <= schwarzschildRadius) {
      alert(`The radius you entered is too small. The minimum allowed radius for the given mass is ${schwarzschildRadius / 1000} kilometers.`);
      return;
    }

    // Calculate the time dilation factor
    const factor = 1 - (2 * G * massOfObject) / (radiusInMeters * Math.pow(c, 2));

    if (factor <= 0) {
      alert('The result is invalid. This might be too close to a black hole or the input is too extreme.');
      return;
    }

    const timeNearObject = observerTime * Math.sqrt(factor);
    const timeDifference = observerTime - timeNearObject;

    setResultArea(
      <div style={{ textAlign: 'left' }}>
        <span>Mass of Object: {massOfObjectSolar} Solar masses</span> <br/>
        <span>Radius from Object: {radiusInKilometers} kilometers</span> <br/>
        <span>Schwarzschild Radius: {schwarzschildRadius / 1000} kilometers</span> <br/><br/>
        <span>Time passed for Distant Observer: <strong>{observerTime} seconds</strong></span> <br/>
        <span>Time passed near Object: <strong>{timeNearObject.toFixed(6)} seconds</strong></span> <br/>
        <span>Time difference due to gravitational time dilation: <strong>{timeDifference.toFixed(6)} seconds</strong></span> <br/> <br/>
        <span>
          Gravitational Time Dilation Equation: 
        </span>
        <BlockMath>
          {'t\' = t \\cdot \\sqrt{1 - \\frac{2GM}{rc^2}}'}
        </BlockMath>
      </div>
    );
  } 

  const clearTimeDilationForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return (
    <div>
      <h1 className='formHeader'>Gravitational Time Dilation Calculator</h1>
      <form className='formInvestment' onSubmit={calculateTimeDilation}>
        
        <input
          className='inputFields'
          type='number'
          name='observerTime'
          id='observerTime'
          aria-label='Enter Observer time in seconds.'
          min="1"
          max="100000000000000"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='observerTime'>Observer time (in seconds)</label> <br/><br/>

        <input
          className='inputFields'
          type='number'
          name='massOfObject'
          id='massOfObject'
          aria-label='Enter Mass of Object in Solar masses'
          min="1"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='massOfObject'>Mass of Object (in Solar masses)</label> <br/><br/>

        <input
          className='inputFields'
          type='number'
          name='radius'
          id='radius'
          aria-label='Enter radius in kilometers'
          min="1"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='radius'>Radius (distance from the object in kilometers)</label> <br/><br/>

        <button className='button101' type="submit">Calculate</button>
        <button className='button101' onClick={clearTimeDilationForm}>Clear</button>
      </form>

      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>

      <div> <br/><br/><br/><br/><br/><br/><br/> </div>

      <div> <CommentDisplay pageId={10}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </div>
  )
}

export default GravitationalTimeDilation;
