import React, { useState } from 'react';
import {useNavigate} from "react-router-dom";
import "../../styles/car.css"; 

function Customs() {

  const navigate = useNavigate(); 
  /*
  const [carType, setCarType] = useState(''); // newCar or usedCar
  const [currency, setCurrency] = useState(''); // Dolar or Euro
  const [inputs, setInputs] = useState({
    invoiceAmount: '',
    productionYear: '',
    invoiceYear: '',
    registerYear: '',
    engineSize: '',
    insurance: ''
  });
  const [results, setResults] = useState({ OTV: '', KDV: '', navlun: '', sum: '', note: '' });

  // Handlers
  const handleCarTypeChange = (type) => setCarType(type);

  const handleCurrencyChange = (currencyType) => setCurrency(currencyType);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputs({ ...inputs, [name]: value });
  };

  const calculate = () => {
    // Your custom calculation logic
    // Update results
    setResults({
      OTV: 'Sample OTV result',
      KDV: 'Sample KDV result',
      navlun: 'Sample navlun result',
      sum: 'Sample total sum',
      note: 'Sample note result'
    });
  };

  const clearForm = () => {
    setInputs({
      invoiceAmount: '',
      productionYear: '',
      invoiceYear: '',
      registerYear: '',
      engineSize: '',
      insurance: ''
    });
    setResults({ OTV: '', KDV: '', navlun: '', sum: '', note: '' });
  };
  */

  return (
    <div className='customsMainArea'>
      <div className='customsMainPageTitlesArea'>
        <h2>EUMAPS.ORG<br />
        BEDELSİZ ARAÇ İTHALATI<br />
        VERGİ HESAPLAMA</h2>
      </div>
      <div className='customsMainPageButtonsArea'>
        <button className='button2' onClick={()=>navigate("/benzin-dizel-arac-gumruk-vergi-hesaplama")}>Benzin/Dizel</button>
        <button className='button2' onClick={()=>navigate("/hibrit-arac-gumruk-vergi-hesaplama")}>Elektrik</button>
        <button className='button2' onClick={()=>navigate("/elektrikli-arac-gumruk-vergi-hesaplama")}>Hibrit</button>
      </div>


    {/* 
    <div id="pageMain">
      <div className="pageContent">
        <div id="customsArea">
          <div id="title">
            <h1>EUMAPS.ORG<br />
              BEDELSİZ ARAÇ İTHALATI<br />
              VERGİ HESAPLAMA MOTORU
            </h1>
          </div>
          <div id="calculation">
            <p><strong>BENZIN/DIZEL ARAÇLAR</strong></p>
            <div>
              <input type="radio" name="carType" id="newCar" onClick={() => handleCarTypeChange('newCar')} />
              <label htmlFor="newCar"> Yeni Araba </label><br />
              <input type="radio" name="carType" id="usedCar" onClick={() => handleCarTypeChange('usedCar')} />
              <label htmlFor="usedCar"> 2.El Araba </label><br />
            </div>
            <br />
            
            {carType === 'newCar' && (
              <div id="new">
                <div>Fatura Bedeli kısmına KDV iadesi almışsanız veya KDV ödememişseniz, KDV hariç bedeli yazınız.<br />
                  <br />
                  Detaylı bilgi: <a href="./customsNotes.html" className="customsNotes_color">Süreç ve önemli notlar</a>
                </div>
                <br />

                <form id="allInputsx">
                  <input type="radio" name="currency" id="inputArea001x" onClick={() => handleCurrencyChange('Dolar')} />
                  <label htmlFor="inputArea001x">Dolar</label><br />

                  <input type="radio" name="currency" id="inputArea002x" onClick={() => handleCurrencyChange('Euro')} />
                  <label htmlFor="inputArea002x">Euro</label><br />

                  <input className="inputTags" id="inputArea1x" type="number" name="invoiceAmount" value={inputs.invoiceAmount} onChange={handleInputChange} />
                  <label htmlFor="inputArea1x">Fatura bedeli</label><br />

                  <input className="inputTags" id="inputArea8x" type="number" name="productionYear" value={inputs.productionYear} onChange={handleInputChange} />
                  <label htmlFor="inputArea8x">Üretim YILI</label><br />

                  <input className="inputTags" id="inputArea3x" type="number" name="invoiceYear" value={inputs.invoiceYear} onChange={handleInputChange} />
                  <label htmlFor="inputArea3x">Fatura YILI</label><br />

                  <input className="inputTags" id="inputArea4x" type="number" name="registerYear" value={inputs.registerYear} onChange={handleInputChange} />
                  <label htmlFor="inputArea4x">Arabayı Türkiye'ye kaydedeceğiniz YIL</label><br />

                  <input className="inputTags" id="inputArea5x" type="number" name="engineSize" value={inputs.engineSize} onChange={handleInputChange} />
                  <label htmlFor="inputArea5x">Motor hacmi <em>("1500", "900" gibi)</em> </label><br />

                  <input className="inputTags" id="inputArea7x" type="number" name="insurance" value={inputs.insurance} onChange={handleInputChange} />
                  <label htmlFor="inputArea7x">"Navlun ve sigorta" harcı</label><br />
                </form>

                <table className="customsTable">
                  <tbody>
                    <tr className="customsRow">
                      <td>AĞIRLIK(kg)</td>
                      <td>AVRUPA MENŞELİ</td>
                      <td>ABD-UZAKDOĞU MENŞELİ</td>
                      <td>AVRUPA'DAN GELEN UZAKDOĞU MENŞELİ</td>
                    </tr>

                  </tbody>
                </table>

                <button onClick={calculate} className="calculateBtn" type="button">Hesapla</button>
                <button onClick={clearForm} className="calculateBtn" type="button">Temizle</button>
                <br />
                <p>
                  <span id="OTVspanx">{results.OTV}</span><br />
                  <span id="KDVspanx">{results.KDV}</span><br />
                  <span id="navlunSpanx">{results.navlun}</span><br />
                  <span id="sumSpanx">{results.sum}</span><br /><br />
                  <span id="noteSpanx">{results.note}</span><br />
                  <br />
                </p>
              </div>
            )}


          </div>
        </div>
      </div>
    
    </>
    */}
    </div>
  );
}

export default Customs;
