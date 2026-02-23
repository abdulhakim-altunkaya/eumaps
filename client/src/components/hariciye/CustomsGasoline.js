import React, { useState, useEffect  } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import "../../styles/car.css"; 
import CommentDisplay from '../CommentDisplay';
import Footer from "../Footer"; 

function CustomsGasoline() {
  const pageIdVisitorPage = "customs_gasoline";
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

  const exchangeDollar = 43.84;
  const exchangeEuro = 51.72;

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
    } else if (engineCapacity3 === "" || engineCapacity3 < 100 || engineCapacity3 > 10000) {
      alert("Geçersiz motor gücü. Aracın motor gücünü sadece rakam olarak giriniz.");
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
      } else if(yearDifference >= 8) {
        firstYear = 0;
      } else {
        firstYear = 1;
      }
    } else {
      alert("Aracın eski  veya yeni olup olmadığı tespit edilemedi");
      return;
    }

    let amortismanPercentage = 10*(yearDifference+firstYear);
    let discount = (amortismanPercentage*invoiceAmount3)/100;
    let basePrice = invoiceAmount3 - discount;
    console.log(`
      amortismanPercentage: ${amortismanPercentage}
      discount: ${discount}
      basePrice: ${basePrice}
    `);

    let basePriceLira = basePrice * currency;

    let percentage;
    if (engineCapacity3 <1401 && basePriceLira<650001) {
      percentage = 70/100;
    } else if (engineCapacity3 < 1401 && basePriceLira<900001) {
      percentage = 75/100;
    } else if (engineCapacity3 < 1401 && basePriceLira<1100001) {
      percentage = 80/100;
    } else if (engineCapacity3 < 1401 && basePriceLira>1100000) {
      percentage = 90/100;
    } else if (engineCapacity3 < 1601 && basePriceLira<850001) {
      percentage = 75/100;
    } else if (engineCapacity3 < 1601 && basePriceLira<1100001) {
      percentage = 80/100;
    } else if (engineCapacity3 < 1601 && basePriceLira<1650001) {
      percentage = 90/100;
    } else if (engineCapacity3 < 1601 && basePriceLira>1650000) {
      percentage = 100/100;
    } else if (engineCapacity3 < 2001 && basePriceLira<1650001) {
      percentage = 150/100;
    } else if (engineCapacity3 < 2001 && basePriceLira>1650000) {
      percentage = 170/100;
    } else if (engineCapacity3 > 2000) {
      percentage = 220/100;
    }

    let amountNavlun = Math.round(basePrice*0.02);
    let taxYurticiGider = 200;
    let taxDamga = 28;
    let taxBandrol = 15;
    let otherTaxes = taxYurticiGider + taxDamga + taxBandrol;

    let finalBasePrice = basePrice + amountNavlun + otherTaxes;


    let amountOTV = Math.round(finalBasePrice*percentage);
    let amountKDV = Math.round((amountOTV+finalBasePrice)*20/100);
    let amountSum = amountKDV + amountOTV + amountNavlun + otherTaxes;

    console.log(`
      amountNavlun: ${amountNavlun}
      amountTaxes: ${otherTaxes}
      finalBasePrice: ${finalBasePrice}
      amountOTV: ${amountOTV}
      amountKDV: ${amountKDV}
      amountSum: ${amountSum}
    `);
    setResultArea(
      <div>
        <span>ÖTV meblağı: {amountOTV} {currencyName}</span> <br/>
        <span>KDV meblağı: {amountKDV} {currencyName}</span> <br/>
        <span>Navlun (AB, Ortadoğu ve KKTC araçları için %2): {amountNavlun} {currencyName}</span> <br/>
        <span>Bandrol + Damga + Yurtiçi gider:{otherTaxes} {currencyName}</span><br/>
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
          *2025 itibariyle gümrük işlerini zorlaştırdıkları için sizi gümrük müşavirine mecbur bırakıyorlar.
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
        <h3 className='customsLeftMargin'>BENZİN/DİZEL ARAÇLAR</h3>
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
                <form onSubmit={calculateTax} className='customsForm'>
                  <input type="radio" id="dollarRadio" name="formSelectorCurrency" value="dollarRadio" onChange={handleRadioCurrency} 
                  required className='radioLabelsCustoms'/>
                  <label htmlFor="dollarRadio">Dolar</label> <br/>
                  <input type="radio" id="euroRadio" name="formSelectorCurrency" value="euroRadio" onChange={handleRadioCurrency} 
                  requiredclassName='radioLabelsCustoms' />
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
                    aria-label='Motor hacmini giriniz.' required/> &nbsp; &nbsp;
                  <label htmlFor='engineCapacity'>Motor Hacmi <i>("1500", "2000" gibi)</i></label> <br/>
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
      <div> <CommentDisplay pageId={5}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </>
  )
}

export default CustomsGasoline