import React, {useState} from 'react';
import '../../styles/investment.css';

function Investment() {

  const [resultArea, setResultArea] = useState("");

  

  const calculateInvestment = (e) => {
    e.preventDefault();//prevent form from refreshing page;

    const formData = new FormData(e.target);
    const invAmount2 = formData.get("invAmount");
    const invDuration2 = formData.get("invDuration");
    const invPercentage2 = formData.get("invPercentage");

    if (Number(invAmount2) < 1 || Number(invAmount2) > 10000000000 || invAmount2==="" ) {
      alert("Please enter a valid amount");
      return;
    }
    if (Number(invDuration2) < 1 || Number(invDuration2) > 100 || invDuration2==="" ) {
      alert("Please enter a valid duration");
      return;
    }
    if (Number(invPercentage2) < 1 || Number(invPercentage2) > 10000 || invAmount2==="" ) {
      alert("Please enter a valid percentage");
      return;
    }
    if (!Number.isInteger(Number(invAmount2)) || !Number.isInteger(Number(invDuration2)) || !Number.isInteger(Number(invPercentage2))) {
      alert("Please enter a whole number (no decimals allowed).");
      return;
    }

    let balance = invAmount2;
    let resultsArray = [];
    for (let i = 0; i < invDuration2; i++) {
      balance = Number(balance) + Number(balance*(invPercentage2/100));
      resultsArray.push(Math.round(balance));
    }
    
    setResultArea(
      resultsArray.map( (invReturn, index) => (
        <span key={index}><span>{invReturn}</span> in {index+1} years <br/></span>
      ))
    )
  }

  const clearInvestment = (e) => {
    e.preventDefault();//prevent the form from refreshing the page
    e.target.closest("form").reset();
    setResultArea("");
  }

  return (
    <div>
      <h1 className='formHeader'>Investment Return Calculator</h1>
      <form className='formInvestment' onSubmit={calculateInvestment}> 
        <input className='inputFields' type='number' name='invAmount' min="1" max="10000000000" required/> &nbsp; &nbsp;
        <label>Investment Amount (No dots or commas)</label> <br/><br/>

        <input className='inputFields' type='number' name='invDuration' min="1" max="100" required/> &nbsp; &nbsp;
        <label>Duration (No dots or commas. Years, days or months)</label> <br/><br/>
        
        <input className='inputFields' type='number' name='invPercentage' min="1" max="10000" required/> &nbsp; &nbsp;
        <label>Percentage of return</label> <br/><br/>
        
        <button className='button1' type="submit" >Calculate</button>
        <button className='button1' onClick={clearInvestment} >Clear</button>
      </form>

      <div className='resultAreaInvestment'>
        {resultArea}
     </div>
    </div>
  )
}

export default Investment