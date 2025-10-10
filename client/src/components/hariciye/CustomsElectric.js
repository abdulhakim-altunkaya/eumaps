import React, { useState, useEffect  } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import "../../styles/car.css"; 
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

function CustomsElectric() {
  const pageIdVisitorPage = "customs_electric";
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

  const navigate = useNavigate();

  // State to track which radio button is selected
  const [selectedForm, setSelectedForm] = useState(null);
  const [currency, setCurrency] = useState(null);
  const [currencyName, setCurrencyName] = useState("");
  const [resultArea, setResultArea] = useState("");

  const exchangeDollar = 41.82;
  const exchangeEuro = 48.55;

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
    const navlunAmount2 = formData.get('navlunAmount');

    const invoiceAmount3 = Number(invoiceAmount2);
    const invoiceYear3 = Number(invoiceYear2);
    const productionYear3 = Number(productionYear2);
    const customsRegYear3 = Number(customsRegYear2);
    const engineCapacity3 = Number(engineCapacity2);
    const navlunAmount3 = Number(navlunAmount2);

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
      alert("Geçersiz KW gücü. Aracın KW gücünü sadece rakam olarak giriniz.");
      return;
    } else if (navlunAmount3 === "" || navlunAmount3 < 1 || navlunAmount3 > 10000) {
      alert("Geçersiz navlun bedeli. Navlun-Sigorta bedelini giriniz");
      return;
    } else if (currency === null) {
      alert("Para biriminizi Dolar veya Euro seçiniz.");
      return;
    };

    if (invoiceYear3 - productionYear3 > 3) {
      alert("Araba satın aldığınız tarihte 3 yaşından büyük olmamalıdır. Bu aracı ithal edemezsiniz.");
      return;
    };

    let yearDifference = customsRegYear3 - invoiceYear3;
    if (yearDifference > 8) {
      yearDifference = 8;
    } else if (yearDifference < 0) {
      alert("Gümrüğe kaydetme tarihini veya Fatura tarihini yanlış girdiniz.");
      return;
    } else  if (yearDifference === 0) {
      alert("Bu araçtan vergi indirimi alamazsınız çünkü fatura yılı ve gümrüğe kaydetme yılı aynı");
      return;
    }
    
    let firstYear;
    if (selectedForm === "usedCarsRadio") {
      firstYear = 0;
    } else if(selectedForm === "newCarsRadio") {
      if (invoiceYear3 - productionYear3 >= 1) {
        alert("Üretim ile fatura yılları arasında fark olan araçlar yeni olsalar bile İkinci el araç olarak muamele görürler.");
        firstYear = 0;
      } else if(yearDifference === 8) {
        firstYear = 0;
      } else {
        firstYear = 10*invoiceAmount3/100;
      }
    } else {
      alert("Aracın eski veya yeni olup olmadığı tespit edilemedi");
      return;
    }

    let discount = 10*yearDifference*invoiceAmount3/100;
    discount = discount + firstYear;
    const basePrice = invoiceAmount3 - discount;
    const basePriceLira = basePrice * currency;

    let percentage;
    if (engineCapacity3<161 && basePriceLira<1650001) {
      percentage = 25/100;
    } else if (engineCapacity3<161 && basePriceLira>1650000) {
      percentage = 55/100;
    } else if (engineCapacity3>160 && basePriceLira<1650001) {
      percentage = 65/100;
    } else if (engineCapacity3>160 && basePriceLira>1650000) {
      percentage = 75/100;
    } else {
      percentage = 75/100;
    }
    const amountNavlun = Math.round(navlunAmount3);
    const finalBasePrice = basePrice + 200 + amountNavlun;
    const amountOTV = Math.round(finalBasePrice*percentage);
    const amountKDV = Math.round((amountOTV+finalBasePrice)*20/100);
    const amountSum = amountKDV + amountOTV;

    setResultArea(
      <div>
        <span>ÖTV meblağı: {amountOTV} {currencyName}</span> <br/>
        <span>KDV meblağı: {amountKDV} {currencyName}</span> <br/>
        <span>Bandrol + Damga Vergisi + Yurtiçi gider: 200 {currencyName}</span><br/>
        <span>Toplam vergi: <strong>{amountSum} {currencyName}</strong></span> <br/> <br/>
                <span>Gümrük Müşaviri*: <strong>500 {currencyName}</strong></span> <br/> <br/>
        <span>Toplam vergi + Gümrük Müşaviri: <strong>{500 + amountSum} {currencyName}</strong></span> <br/> <br/>
        <span>Not: Rakamlar tahminidir.</span> <br/>
        <br/>
        <br/>
        <br/>
        <br/>
        <br/>
        <br/>
        <br/>
        <br/>
        <span>
          <em>
          *2025 itibariyle gümrük işlerini iyice zorlaştırdıkları için sizi gümrük müşavirine mecbur bırakıyorlar.
          Gümrük müşavirleri herşey dahil hizmet 500 Euro civarı ücret istiyor.
          </em>
        </span>
      </div>
    )

  }

  const clearCarForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }

  return (
    <>
      <div className='customsMainArea'>
        <div className='customsMainPageTitlesArea'>
          <h3>EUMAPS.ORG<br />
          BEDELSİZ ARAÇ İTHALATI<br />
          VERGİ HESAPLAMA</h3>
        </div>
        <h3 className='customsLeftMargin'>ELEKTRİKLİ ARAÇLAR</h3>
        <div className='customsLeftMargin customsTexts'>
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
                <p className='customsTexts'>Fatura Bedeli kısmına KDV ödememişseniz veya KDV iadesi almışsanız, KDV hariç bedeli yazınız.</p>
                <p className='customsTexts'>Detaylı bilgi: 
                  <span className="notesSpan" onClick={()=> navigate("/bedelsiz-arac-ithalati-onemli-notlar")}>Süreç ve 
                  Önemli Notlar</span></p>
                <form onSubmit={calculateTax} className='customsTexts'>
                  <input type="radio" id="dollarRadio" name="formSelectorCurrency" value="dollarRadio" onChange={handleRadioCurrency} 
                  required className='radioLabelsCustoms'/>
                  <label htmlFor="dollarRadio">Dolar</label> <br/>
                  <input type="radio" id="euroRadio" name="formSelectorCurrency" value="euroRadio" onChange={handleRadioCurrency} 
                  required className='radioLabelsCustoms'/>
                  <label htmlFor="euroRadio">Euro</label> <br/>

                  <input className='input2' type='number' name='invoiceAmount' id='invoiceAmount'
                    aria-label='Faturada gözüken meblağı küsürat olmadan giriniz.' required/> &nbsp; &nbsp;
                  <label htmlFor='invoiceAmount'>Fatura Bedeli</label> <br/>

                  <input className='input2' type='number' name='invoiceYear' id='invoiceYear'
                    aria-label='Fatura yılını 4 rakam olarak giriniz.' required /> &nbsp; &nbsp;
                  <label htmlFor='invoiceYear'>Fatura Yılı</label> <br/>

                  <input className='input2' type='number' name='productionYear' id='productionYear'
                    aria-label='Araç üretim yılını 4 rakam olarak giriniz.' required /> &nbsp; &nbsp;
                  <label htmlFor='productionYear'>Üretim Yılı</label> <br/>

                  <input className='input2' type='number' name='customsRegYear' id='customsRegYear'
                    aria-label='Arabayı Türkiyeye kaydedeceğiniz yılı 4 rakam olarak giriniz' required/> &nbsp; &nbsp;
                  <label htmlFor='customsRegYear'>Türkiye'ye kaydedeceğiniz Yıl</label> <br/>

                  <input className='input2' type='number' name='engineCapacity' id='engineCapacity'
                    aria-label='Arabanın KW gücünü hacmini giriniz. 125, 150 gibi' required/> &nbsp; &nbsp;
                  <label htmlFor='engineCapacity'>KW gücü <i>("125", "150" gibi)</i></label> <br/>

                  <input className='input2' type='number' name='navlunAmount' id='navlunAmount'
                    aria-label='Aşağıdaki tabloya göre Navlun ve Sigorta harcını giriniz.' min="100" max="5000" required/> &nbsp; &nbsp;
                  <label htmlFor='navlunAmount'>"Navlun ve sigorta" (Tabloya göre)</label> <br/> <br/>


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
                    <button className='button102' type="submit">Hesapla</button>
                    <button className='button102' onClick={clearCarForm}>Sil</button>
                </form>
                <br/>
                <div>{resultArea}</div>
              </div>
            )}
        </div>
      </div>  
      <div> <br/><br/><br/><br/><br/><br/><br/> </div>
      <div> <CommentDisplay pageId={3}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </>

  )
}

export default CustomsElectric