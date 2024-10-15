import React, { useState } from 'react';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css'; // Import the KaTeX CSS for proper styling of Einstein formula

function LengthContraction() {

  const [resultArea, setResultArea] = useState('');

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

    // Calculate the contraction factor
    const factor = Math.sqrt(1 - (Math.pow(v, 2) / Math.pow(c, 2)));

    if (factor <= 0) {
      alert('The result is invalid due to extreme velocity.');
    }

    const contractedLength = L0 * factor;
    const contractedLength2 = contractedLength.toFixed(3);
    const contractedLength3 = contractedLength2.toString();

    setResultArea(
      <div style={{ textAlign: 'left' }}>
        <span>Rest Length: {L0} meters</span> <br/>
        <br/>
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
        <label htmlFor='restLength'>Enter Rest Length (in meters)</label> <br/><br/>

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
        <button className='button101' onClick={clearLengthContractionForm}>Clear</button>
      </form>

      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>

      <div> <br/><br/><br/><br/><br/><br/><br/> </div>

      <div> <CommentDisplay pageId={13}/></div>
    </div>
  )
}

export default LengthContraction;
