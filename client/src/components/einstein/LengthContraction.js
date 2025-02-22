import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css'; // Import the KaTeX CSS for proper styling of Einstein formula
import Footer from "../Footer";

function LengthContraction() {
  const pageIdVisitorPage = "einstein_length_cont";
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

  const calculateLengthContraction = (e) => {
    e.preventDefault(); // prevent form from refreshing page

    const formData = new FormData(e.target);
    const restLength = formData.get('restLength'); // in meters
    const velocityKmPerSec = formData.get('velocity'); // in km/s

    let L0 = Number(restLength);
    let vKm = Number(velocityKmPerSec);
    let v = vKm * 1000; // Convert km/s to m/s

    if (L0 <= 0 || isNaN(L0)) {
      alert('Rest length is not valid.');
      return;
    }

    if (vKm <= 0 || isNaN(vKm)) {
      alert('Velocity is not valid.');
      return;
    }

    if (v >= 299792458) {
      alert('Velocity must be less than the speed of light (299792.458). Length becomes negative or an invalid number if you cross light speed');
    }

    // Constant
    const c = 299792458;   // Speed of light in m/s

    // Calculate the velocity as a ratio of the speed of light
    const velocityRatio = (v / c).toFixed(20); // Displaying to 5 decimal places

    // Calculate the contraction factor
    const factor = Math.sqrt(1 - (Math.pow(v, 2) / Math.pow(c, 2)));

    if (factor <= 0) {
      alert('The result is invalid due to extreme velocity.');
    }

    const contractedLength = L0 * factor;
    const contractedLength2 = contractedLength.toFixed(6);
    const contractedLength3 = contractedLength2.toString();

    setResultArea(
      <div style={{ textAlign: 'left' }}>
        <span>Rest Length: {L0} meters</span> <br/>
        <span>Speed of light: 299,792.4580 km/s</span> <br/>
        <span>Velocity to speed of light ratio: <strong>{velocityRatio}</strong></span> <br/><br/>
  
        <span>Observed Length: <strong>{contractedLength3} meters</strong></span> <br/> <br/>
        <span>
          Relativistic Length Contraction Equation (L: observed length, L0: rest length, v: velocity km/s, c: speed of light km/s): 
        </span>
        <BlockMath>
          {'L = L_0 \\cdot \\sqrt{1 - \\frac{v^2}{c^2}}'}
        </BlockMath>
      </div>
    );
  }

  const clearLengthContractionForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return ( 
    <div>
      <h1 className='formHeader'>Relativistic Length Contraction Calculator</h1>
      <form className='formInvestment' onSubmit={calculateLengthContraction}>
        
        <input
          className='inputFields'
          type='number'
          name='restLength'
          id='restLength'
          aria-label='Enter Rest length in meters.'
          min="1"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='restLength'>Rest Length (in meters)</label> <br/><br/>

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
        <button className='button101' onClick={clearLengthContractionForm}>Clear</button>
      </form>

      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>

      <div> <br/><br/><br/><br/><br/><br/><br/> </div>

      <div> <CommentDisplay pageId={12}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </div>
  )
}

export default LengthContraction;
