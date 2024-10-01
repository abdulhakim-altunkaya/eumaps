import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import "../../styles/car.css"; 
import CommentDisplay from '../CommentDisplay'; 

function CustomsBike() {
  const navigate = useNavigate();

  // State to track which radio button is selected
  const [selectedForm, setSelectedForm] = useState(null);
  const [currency, setCurrency] = useState(null);
  const [currencyName, setCurrencyName] = useState("");
  const [resultArea, setResultArea] = useState("");

  const exchangeDollar = 34.04;
  const exchangeEuro = 37.87;

  // Handle radio button changes
  const handleRadioChange = (e) => {
    setSelectedForm(e.target.value);
  };
  const handleRadioCurrency = (e) => {
    if(e.target.value === "euroRadio") {
      setCurrency(exchangeEuro);
      setCurrencyName("Euro");
    } else {
      setCurrency(exchangeDollar);
      setCurrencyName("Dolar");
    }
  }

  const calculateTax = (e) => {
    e.preventDefault(); // prevent form from refreshing page
    const formData = new FormData(e.target);
    const invoiceAmount2 = formData.get('invoiceAmount');
    const invoiceYear2 = formData.get('invoiceYear');
    const productionYear2 = formData.get('productionYear');
    const customsRegYear2 = formData.get('customsRegYear');
    const engineCapacity2 = formData.get('engineCapacity');

    const invoiceAmount3 = Number(invoiceAmount2);
    const invoiceYear3 = Number(invoiceYear2);
    const productionYear3 = Number(productionYear2);
    const customsRegYear3 = Number(customsRegYear2);
    const engineCapacity3 = Number(engineCapacity2);

    if (invoiceAmount3 === "" || invoiceAmount3 < 100 || invoiceAmount3 > 10000000) {
      alert("Geçersiz meblağ. Fatura'daki KDV hariç fiyatı giriniz.");
      return;
    } else if (invoiceYear3 === "" || invoiceYear3 < 2000 || invoiceYear3 > 2050) {
      alert("Geçersiz fatura yılı. Fatura tarihini sadece sene olarak giriniz: 2022 gibi");
      return;
    } else if (productionYear3 === "" || productionYear3 < 2000 || productionYear3 > 2050) {
      alert("Geçersiz imalat yılı. Arabanın üretim yılını giriniz: 2022 gibi");
      return;
    } else if (customsRegYear3 === "" || customsRegYear3 < 2000 || customsRegYear3 > 2050) {
      alert("Gümrüğe kaydetme tarihi geçersiz.Gümrüğe kaydetme tarihini sadece sene olarak giriniz: 2022 gibi");
      return;
    } else if (engineCapacity3 === "" || engineCapacity3 < 10 || engineCapacity3 > 10000) {
      alert("Geçersiz motor gücü. Motorsikletin motor gücünü sadece rakam olarak giriniz.");
      return;
    } else if (currency === null) {
      alert("Para biriminizi Dolar veya Euro seçiniz.");
      return;
    };

    if (invoiceYear3 - productionYear3 > 3) {
      alert("Motorsiklet satın aldığınız tarihte 3 yaşından büyük olmamalıdır. Bu motorsikleti ithal edemezsiniz.");
      return;
    };

    let yearDifference = customsRegYear3 - invoiceYear3;
    if (yearDifference > 6) {
      yearDifference = 6;
    } else if (yearDifference < 0) {
      alert("Gümrüğe kaydetme tarihini veya Fatura tarihini yanlış girdiniz.");
      return;
    } else  if (yearDifference === 0) {
      alert("Bu motorsikletten vergi indirimi alamazsınız çünkü fatura yılı ve gümrüğe kaydetme yılı aynı");
      return;
    }
    
    let firstYear;
    if (selectedForm === "usedCarsRadio") {
      firstYear = 0;
    } else if(selectedForm === "newCarsRadio") {
      if (invoiceYear3 - productionYear3 >= 1) {
        alert("Üretim ile fatura yılları arasında fark olan motorsikletler yeni olsalar bile İkinci el motorsiklet olarak muamele görürler.");
        firstYear = 0;
      } else {
        firstYear = 10*invoiceAmount3/100;
      }
    } else {
      alert("Motorsikletin eski veya yeni olup olmadığı tespit edilemedi");
      return;
    }

    let discount = 10*yearDifference*invoiceAmount3/100;
    discount = discount + firstYear;
    const basePrice = invoiceAmount3 - discount;
    //const basePriceLira = basePrice * currency;//no need for basePriceLira as percentage is not depending on it

    let percentage;
    if (engineCapacity3<251 ) {
        percentage = 8/100;
    } else {
        percentage = 37/100;
    }

    const amountOTV = Math.round(basePrice*percentage);
    const amountKDV = Math.round((amountOTV+basePrice)*20/100);
    const amountSum = amountKDV + amountOTV;

    setResultArea(
      <div>
        <span>ÖTV meblağı: {amountOTV} {currencyName}</span> <br/>
        <span>KDV meblağı: {amountKDV} {currencyName}</span> <br/>
        <span>Toplam vergi: <strong>{amountSum} {currencyName}</strong></span> <br/> <br/>
        <span>Not: Rakamlar tahminidir.</span> <br/>
      </div>
    )

  }

  const clearCarForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return (
    <div className='customsMainArea'>
      <div className='customsMainPageTitlesArea'>
        <h3>EUMAPS.ORG<br />
        BEDELSİZ ARAÇ İTHALATI<br />
        VERGİ HESAPLAMA</h3>
      </div>
      <h4>MOTORSİKLETLER</h4>
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
          <label htmlFor="usedCarsRadio">İkinci El Motorsiklet</label>
          <br/>
          <input
            type="radio"
            id="newCarsRadio"
            name="formSelector"
            value="newCarsRadio"
            onChange={handleRadioChange}
          />
          <label htmlFor="newCarsRadio">Yeni Motorsiklet</label>
        </div>
          {/* Conditionally render the forms based on the selected radio button */}
          {(selectedForm === 'newCarsRadio' || selectedForm === 'usedCarsRadio')  && (
            <div>
              <p>Fatura Bedeli kısmına KDV iadesi almışsanız veya KDV ödememişseniz, KDV hariç bedeli yazınız.</p>
              <p>Detaylı bilgi: 
                <span className="notesSpan" onClick={()=> navigate("/bedelsiz-arac-ithalati-onemli-notlar")}>Süreç ve 
                Önemli Notlar</span></p>
              <form onSubmit={calculateTax}>
                <input type="radio" id="dollarRadio" name="formSelectorCurrency" value="dollarRadio" onChange={handleRadioCurrency} 
                required />
                <label htmlFor="dollarRadio">Dolar</label> <br/>
                <input type="radio" id="euroRadio" name="formSelectorCurrency" value="euroRadio" onChange={handleRadioCurrency} 
                required />
                <label htmlFor="euroRadio">Euro</label> <br/>

                <input className='input2' type='number' name='invoiceAmount' id='invoiceAmount'
                  aria-label='Faturada gözüken meblağı küsürat olmadan giriniz.' required/> &nbsp; &nbsp;
                <label htmlFor='invoiceAmount'>Fatura Bedeli</label> <br/>

                <input className='input2' type='number' name='invoiceYear' id='invoiceYear'
                  aria-label='Fatura yılını 4 rakam olarak giriniz.' required /> &nbsp; &nbsp;
                <label htmlFor='invoiceYear'>Fatura Yılı</label> <br/>

                <input className='input2' type='number' name='productionYear' id='productionYear'
                  aria-label='Motorsiklet üretim yılını 4 rakam olarak giriniz.' required /> &nbsp; &nbsp;
                <label htmlFor='productionYear'>Üretim Yılı</label> <br/>

                <input className='input2' type='number' name='customsRegYear' id='customsRegYear'
                  aria-label='Motorsikleti Türkiyeye kaydedeceğiniz yılı 4 rakam olarak giriniz' required/> &nbsp; &nbsp;
                <label htmlFor='customsRegYear'>Türkiye'ye kaydedeceğiniz Yıl</label> <br/>

                <input className='input2' type='number' name='engineCapacity' id='engineCapacity'
                  aria-label='Motor hacmini giriniz.' required/> &nbsp; &nbsp;
                <label htmlFor='engineCapacity'>Motor Hacmi <i>("200", "250" gibi)</i></label> <br/>

                <br/>
                <button className='button102' type="submit">Hesapla</button>
                <button className='button102' onClick={clearCarForm}>Sil</button>
              </form>
              <br/>
              <p>{resultArea}</p>
              <div> <br/><br/><br/><br/><br/><br/><br/> </div>
              <div> <CommentDisplay pageId={2}/></div>
            </div>
          )}
      </div>


    </div>
  )
}

export default CustomsBike;