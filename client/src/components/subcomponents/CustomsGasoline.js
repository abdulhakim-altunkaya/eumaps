import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import "../../styles/car.css"; 

function CustomsGasoline() {
  const navigate = useNavigate();

  // State to track which radio button is selected
  const [selectedForm, setSelectedForm] = useState(null);
  const [currencyRadio, setCurrencyRadio] = useState(null);

  // Handle radio button changes
  const handleRadioChange = (e) => {
    setSelectedForm(e.target.value);
  };
  const handleRadioCurrency = (e) => {
    setCurrencyRadio(e.target.value);
  }

  return (
    <div className='customsMainArea'>
      <div className='customsMainPageTitlesArea'>
        <h2>EUMAPS.ORG<br />
        BEDELSİZ ARAÇ İTHALATI<br />
        VERGİ HESAPLAMA</h2>
      </div>
      <h3>BENZİN/DİZEL ARAÇLAR</h3>
      <div>
        {/* Radio buttons */}
        <div>
          <input
            type="radio"
            id="usedCarsRadio"
            name="formSelector"
            value="usedCarsRadio"
            onChange={handleRadioChange}
          />
          <label htmlFor="usedCarsRadio">İkinci El Araba</label>
          <br/>
          <input
            type="radio"
            id="newCarsRadio"
            name="formSelector"
            value="newCarsRadio"
            onChange={handleRadioChange}
          />
          <label htmlFor="newCarsRadio">Yeni Araba</label>
        </div>
          {/* Conditionally render the forms based on the selected radio button */}
          {selectedForm === 'usedCarsRadio' && (
            <div>
              <p>Fatura Bedeli kısmına KDV iadesi almışsanız veya KDV ödememişseniz, KDV hariç bedeli yazınız.</p>
              <p>Detaylı bilgi: 
                <span className="notesSpan" onClick={()=> navigate("/bedelsiz-arac-ithalati-onemli-notlar")}>Süreç ve 
                Önemli Notlar</span></p>
              <form>
                <input type="radio" id="dollarRadio" name="formSelectorCurrency" value="dollarRadio" onChange={handleRadioCurrency}/>
                <label htmlFor="dollarRadio">Dolar</label> <br/>
                <input type="radio" id="euroRadio" name="formSelectorCurrency" value="euroRadio" onChange={handleRadioCurrency}/>
                <label htmlFor="euroRadio">Euro</label>
              </form>
            </div>
          )}
          {selectedForm === 'newCarsRadio' && (
            <div>
              <p>Fatura Bedeli kısmına KDV iadesi almışsanız veya KDV ödememişseniz, KDV hariç bedeli yazınız.</p>
              <p>Detaylı bilgi: 
                <span className="notesSpan" onClick={()=> navigate("/bedelsiz-arac-ithalati-onemli-notlar")}>Süreç ve 
                Önemli Notlar</span></p>
              <form>
                <input type="radio" id="dollarRadio" name="formSelectorCurrency" value="dollarRadio" onChange={handleRadioCurrency}/>
                <label htmlFor="dollarRadio">Dolar</label> <br/>
                <input type="radio" id="euroRadio" name="formSelectorCurrency" value="euroRadio" onChange={handleRadioCurrency}/>
                <label htmlFor="euroRadio">Euro</label>
              </form>
            </div>
          )}
      </div>


    </div>
  )
}

export default CustomsGasoline