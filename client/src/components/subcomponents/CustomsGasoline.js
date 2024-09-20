import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import "../../styles/car.css"; 

function CustomsGasoline() {
  const navigate = useNavigate();

  // State to track which radio button is selected
  const [selectedForm, setSelectedForm] = useState(null);
  const [currency, setCurrency] = useState(null);
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
    } else {
      setCurrency(exchangeDollar);
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
    const navlunAmount2 = formData.get('navlunAmount');

    const invoiceAmount3 = Number(invoiceAmount2);
    const invoiceYear3 = Number(invoiceYear2);
    const productionYear3 = Number(productionYear2);
    const customsRegYear3 = Number(customsRegYear2);
    const engineCapacity3 = Number(engineCapacity2);
    const navlunAmount3 = Number(navlunAmount2);

    if (invoiceAmount3 == "") {
      alert("Fatura tarihini sadece sene olarak giriniz: 2022 gibi");
      return;
    } else if (invoiceYear3 == "") {
      alert("Üretim tarihini sadece sene olarak giriniz: 2022 gibi");
      return;
    } else if (productionYear3 == "") {
      alert("Gümrüğe kaydetme tarihini sadece sene olarak giriniz: 2022 gibi");
      return;
    } else if (customsRegYear3 == "") {
      alert("Navlun-sigorta bedelini giriniz.");
      return;
    } else if (engineCapacity3 == "") {
      alert("Fatura'daki KDV hariç fiyatı giriniz.");
      return;
    } else if (navlunAmount3 == "") {
      alert("Motor hacmini giriniz.");
      return;
    } else if (currency == null) {
      alert("Para biriminizi Dolar veya Euro seçiniz.");
      return;
    };

    var yearDifference = customsRegYear3 - invoiceYear3;
    if (yearDifference > 6) {
      yearDifference = 6;
    } else if (yearDifference < 0) {
      alert("Gümrüğe kaydetme tarihini veya Fatura tarihini yanlış girdiniz.");
      return;
    } else  if (yearDifference == 0) {
      alert("Bu araçtan vergi indirimi alamazsınız çünkü fatura yılı ve gümrüğe kaydetme yılı aynı")
    }

    if (selectedForm == "usedCarsRadio") {
      firstYear = 10*invoiceAmount3/100;
    } else if(selectedForm == "newCarsRadio") {
      firstYear = 20*invoiceAmount3/100;
    }
    
    if(invoiceYear3 - productionYear3 >= 1) {
      alert("Üretim yılı ile fatura yılı arasında fark olan arabalar, yeni olsalar bile, vergileri ikinci el gibi hesaplanır.");
    }


  }

  const clearCarForm = () => {
    
  }

  return (
    <div className='customsMainArea'>
      <div className='customsMainPageTitlesArea'>
        <h3>EUMAPS.ORG<br />
        BEDELSİZ ARAÇ İTHALATI<br />
        VERGİ HESAPLAMA</h3>
      </div>
      <h4>BENZİN/DİZEL ARAÇLAR</h4>
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
                  aria-label='Faturada gözüken meblağı küsürat olmadan giriniz.' min="1" max="100000000" required/> &nbsp; &nbsp;
                <label htmlFor='invoiceAmount'>Fatura Bedeli</label> <br/>

                <input className='input2' type='number' name='invoiceYear' id='invoiceYear'
                  aria-label='Fatura yılını 4 rakam olarak giriniz.' min="2000" max="2050" required /> &nbsp; &nbsp;
                <label htmlFor='invoiceYear'>Fatura Yılı</label> <br/>

                <input className='input2' type='number' name='productionYear' id='productionYear'
                  aria-label='Araç üretim yılını 4 rakam olarak giriniz.' min="2000" max="2050" required /> &nbsp; &nbsp;
                <label htmlFor='productionYear'>Araç Üretim Yılı</label> <br/>

                <input className='input2' type='number' name='customsRegYear' id='customsRegYear'
                  aria-label='Arabayı Türkiyeye kaydedeceğiniz yılı 4 rakam olarak giriniz' min="2000" max="2050" required/> &nbsp; &nbsp;
                <label htmlFor='customsRegYear'>Arabayı Türkiye'ye kaydedeceğiniz Yıl</label> <br/>

                <input className='input2' type='number' name='engineCapacity' id='engineCapacity'
                  aria-label='Motor hacmini giriniz.' min="100" max="10000" required/> &nbsp; &nbsp;
                <label htmlFor='engineCapacity'>Motor Hacmi <i>("1500", "2000"... gibi)</i></label> <br/>

                <input className='input2' type='number' name='navlunAmount' id='navlunAmount'
                  aria-label='Aşağıdaki tabloya göre Navlun ve Sigorta harcını giriniz.' min="100" max="5000" required/> &nbsp; &nbsp;
                <label htmlFor='navlunAmount'>"Navlun ve sigorta" harcı (aşağıdaki tabloya göre)</label> <br/> <br/>

                <table className="customsTable">
                    <tbody>
                      <tr className="customsRow">
                        <td>AĞIRLIK(kg)</td>
                        <td>Avrupa Menşeli</td>
                        <td>ABD/Uzakdoğu Menşeli</td>
                        <td>Avrupa'dan gelen Uzakdoğu Menşeli</td>
                      </tr>
                      <tr className="customsRow">
                        <td>0-1200</td>
                        <td>150 €</td>
                        <td>650 $</td>
                        <td>300 $ + 150 €</td>
                      </tr>
                      <tr className="customsRow">
                        <td>1200-1600</td>
                        <td>200 €</td>
                        <td>700 $</td>
                        <td>400 $ + 200 €</td>
                      </tr>
                      <tr className="customsRow">
                        <td>1600 üzeri</td>
                        <td>230 €</td>
                        <td>800 $</td>
                        <td>500 $ + 230 €</td>
                      </tr>
                    </tbody>
                  </table>
                  <br/>
                  <button className='button2' type="submit">Hesapla</button>
                  <button className='button2' onClick={clearCarForm}>Sil</button>
              </form>
              <br/>
              <p>{resultArea}</p>
              <br/>
              <br/>
              <br/>
              <br/>
            </div>
          )}
      </div>


    </div>
  )
}

export default CustomsGasoline