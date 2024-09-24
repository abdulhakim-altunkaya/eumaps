import React, { useState } from 'react';
import '../../styles/investment.css';

import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css'; // Import the KaTeX CSS for proper styling of Einstein formula

function SpeedOfLight() {

  const [resultArea, setResultArea] = useState('');

  const calculateTimeDilation = (e) => {
    e.preventDefault(); // prevent form from refreshing page

    const formData = new FormData(e.target);
    const spaceshipTime2 = formData.get('spaceshipTime');
    const spaceshipVelocity2 = formData.get('spaceshipVelocity');
    let spaceshipTime3 = Number(spaceshipTime2);
    let spaceshipVelocity3 = Number(spaceshipVelocity2);

    if (spaceshipVelocity3 < 1 || spaceshipVelocity3 === '') {
      alert('Spaceship velocity is not a valid number');
      return;
    }
    if (spaceshipVelocity3 > 299793) {
      alert("You are going faster than light. The equation breaks down after here.");
    }
    if (spaceshipTime3 < 1 || spaceshipTime3 > 10000000000000 || spaceshipTime3 === '') {
      alert('Invalid amount of time. Enter time in seconds. Do not use comma or dots');
      return;
    }
    if (!Number.isInteger(spaceshipTime3) || !Number.isInteger(spaceshipVelocity3) ) {
      alert('Enter a valid number. Do not use commas or dots');
      return;
    }

    const speedLight = 299792.45;
    const part1 = Math.pow(speedLight, 2);
    const part2 = Math.pow(spaceshipVelocity3, 2);
    const part3 = part2/part1;
    const part4 = 1-part3;
    const part5 = Math.sqrt(part4);
    const part6 = spaceshipTime3/part5;
    const part7 = part6.toFixed(1)
    const side1 = spaceshipVelocity3*100;
    const side2 = side1/speedLight;
    const side3 = part7-spaceshipTime3;
    const side4 = side3.toFixed(1)

    setResultArea(
      <div style={{ textAlign: 'left' }}>
        <span>Speed of Light: {speedLight}</span> <br/> 
        <span>Ratio of Spaceship Velocity to Light: {side2}%</span> <br/>
        <span>Time Dilation: {side4} seconds</span> <br/>
        <span>Time passed on Spaceship: <strong>{spaceshipTime3} seconds</strong></span> <br/>
        <span>Time passed on Earth: <strong>{part7} seconds.</strong>(Exact number is: {part6}) </span> <br/> <br/>
        <span>Above calculation is also same for months, weeks, years etc. For example, instead of seconds, you can say:</span> <br/>
        <span>Time passed on Spaceship: <strong>{spaceshipTime3} years</strong></span> <br/>
        <span>Time passed on Earth: <strong>{part7} years.</strong></span> <br/> <br/>
        <span>
          Einstein Time-Dilation Equation <br/>
          (Te: Time passed on Earth, Ts: Time passed in Spaceship, 
          v: velocity of Spaceship, c: speed of Light):
        </span> 
        <BlockMath>
          {'Te = \\frac{Ts}{\\sqrt{1 - \\frac{v^2}{c^2}}}'}
        </BlockMath>
      </div>
    )
  }

  const clearTimeDilationForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return (
    <div>
      <h1 className='formHeader'>Time Dilation Calculator</h1>
      <form className='formInvestment' onSubmit={calculateTimeDilation}>
        
        <input
          className='inputFields'
          type='number'
          name='spaceshipTime'
          id='spaceshipTime'
          aria-label='Enter Spaceship time in seconds.'
          min="1"
          max="100000000000000"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='spaceshipTime'>Enter Spaceship time (in seconds)</label> <br/><br/>

        
        <input
          className='inputFields'
          type='number'
          name='spaceshipVelocity'
          id='spaceshipVelocity'
          aria-label='Enter Spaceship velocity in km per second'
          min="1"
          max="100000000000000000000"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='spaceshipVelocity'>Enter Spaceship velocity (in km/seconds)</label> <br/><br/>

        <button className='button101' type="submit">Calculate</button>
        <button className='button101' onClick={clearTimeDilationForm}>Clear</button>
      </form>

      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>
    </div>
  )
}

export default SpeedOfLight;
