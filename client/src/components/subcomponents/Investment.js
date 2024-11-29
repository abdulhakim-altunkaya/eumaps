import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";
 
function Investment() {
  const pageIdVisitorPage = "tools_investment";
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
 
  const calculateInvestment = (e) => {
    e.preventDefault(); // prevent form from refreshing page

    const formData = new FormData(e.target);
    const invAmount2 = formData.get('invAmount');
    const invDuration2 = formData.get('invDuration');
    const invPercentage2 = formData.get('invPercentage');

    if (Number(invAmount2) < 1 || Number(invAmount2) > 10000000000 || invAmount2 === '') {
      alert('Please enter a valid amount');
      return;
    }
    if (Number(invDuration2) < 1 || Number(invDuration2) > 100 || invDuration2 === '') {
      alert('Please enter a valid duration');
      return;
    }
    if (Number(invPercentage2) < 1 || Number(invPercentage2) > 10000 || invPercentage2 === '') {
      alert('Please enter a valid percentage');
      return; 
    }
    if (!Number.isInteger(Number(invAmount2)) || !Number.isInteger(Number(invDuration2)) || !Number.isInteger(Number(invPercentage2))) {
      alert('Please enter a whole number (no decimals allowed).');
      return;
    }

    let balance = invAmount2;
    let resultsArray = [];
    for (let i = 0; i < invDuration2; i++) {
      balance = Number(balance) + Number(balance * (invPercentage2 / 100));
      resultsArray.push(Math.round(balance));
    }

    setResultArea(
      resultsArray.map((invReturn, index) => (
        <span key={index}><span>{invReturn}</span> in {index + 1} years <br /></span>
      ))
    );
  }

  const clearInvestment = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return (
    <div>
      <h1 className='formHeader'>Investment Return Calculator</h1>
      <form className='formInvestment' onSubmit={calculateInvestment}>
        
        <input
          className='inputFields'
          type='number'
          name='invAmount'
          id='invAmount'
          aria-label='Investment Amount. Enter a number between 1 and 10 billion.'
          min="1"
          max="10000000000"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='invAmount'>Investment Amount</label> <br /><br />

        
        <input
          className='inputFields'
          type='number'
          name='invDuration'
          id='invDuration'
          aria-label='Duration. Enter a number between 1 and 100.'
          min="1"
          max="100"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='invDuration'>Duration</label> <br /><br />

        
        <input
          className='inputFields'
          type='number'
          name='invPercentage'
          id='invPercentage'
          aria-label='Percentage of return. Enter a number between 1 and 10,000.'
          min="1"
          max="10000"
          required
        /> &nbsp; &nbsp;
        <label htmlFor='invPercentage'>Percentage of return</label> <br /><br />

        <button className='button101' type="submit">Calculate</button>
        <button className='button101' onClick={clearInvestment}>Clear</button>
      </form>

      <div className='resultAreaInvestment' aria-live='polite'>
        {resultArea}
      </div>
      <div> <br/><br/><br/><br/><br/><br/><br/> </div>
      <div> <CommentDisplay pageId={20}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </div>
  )
}

export default Investment;
