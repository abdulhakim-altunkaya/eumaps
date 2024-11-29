import React, { useState, useEffect} from 'react';
import axios from 'axios';
import '../../styles/investment.css';
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer"; 

function Rent() { 

  const [resultArea, setResultArea] = useState('');
  const pageIdVisitorPage = "mfa_rent"
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

  const calculateRentSupport = (e) => {
    e.preventDefault(); // prevent form from refreshing page

    const formData = new FormData(e.target);
    const amountSalary2 = formData.get('amountSalary');
    const amountRent2 = formData.get('amountRent');
    const typeCurrency2 = formData.get('typeCurrency');

    let amountSalary3 = Number(amountSalary2);
    let amountRent3 = Number(amountRent2);

    if (amountSalary3 < 1 || amountSalary3 > 10000000000 || amountSalary3 === '') {
      alert('Geçerli bir maaş meblağı giriniz');
      return;
    }
    if (amountRent3 < 1 || amountRent3 > 10000000000000 || amountRent3 === '') {
      alert('Geçerli bir kira meblağı giriniz');
      return;
    }
    if (typeCurrency2.length < 1 || typeCurrency2.length > 20 || typeCurrency2 === '') {
      alert('Geçerli bir döviz cinsi giriniz');
      return;
    }
    if (!Number.isInteger(amountSalary3) || !Number.isInteger(amountRent3) ) {
      alert('Geçerli bir meblağ giriniz. Nokta veya virgül gibi işaretler kullanmayınız');
      return;
    }

    if (amountRent3 <= amountSalary3/4) {
        setResultArea("Ödediğiniz kira maaşınızın %25'inden büyük değil. Kira yardımı alamıyorsunuz.")
    } else {
        let supportAmount = ( amountRent3 - (amountSalary3/4) ) * 80 / 100;
        let supportAmount2 = Math.round(supportAmount);
        setResultArea(`Alacağınız kira yardımı: ${supportAmount2} ${typeCurrency2}`)
    }
  }

  const clearRentForm = (e) => {
    e.preventDefault(); // prevent the form from refreshing the page
    e.target.closest('form').reset();
    setResultArea('');
  }
     
  return (
    <>
      <div>
        <h1 className='formHeader'>Dışişleri Bakanlığı Kira Yardımı Hesaplama</h1>
        <form className='formInvestment' onSubmit={calculateRentSupport}>
          
          <input
            className='inputFields'
            type='number'
            name='amountSalary'
            id='amountSalary'
            aria-label='Aylık Maaşınızı nokta veya virgül olmadan giriniz.'
            min="1"
            max="1000000"
            required
          /> &nbsp; &nbsp;
          <label htmlFor='amountSalary'>Aylık Maaşınız</label> <br /><br />

          
          <input
            className='inputFields'
            type='number'
            name='amountRent'
            id='amountRent'
            aria-label='Aylık kiranızı giriniz. Nokta ve virgül kullanmayınız.'
            min="1"
            max="100000"
            required
          /> &nbsp; &nbsp;
          <label htmlFor='amountRent'>Aylık Kiranız</label> <br /><br />

          
          <input
            className='inputFields'
            type='text'
            name='typeCurrency'
            id='typeCurrency'
            aria-label='Döviz cinsini giriniz. "Euro" veya "Dolar" gibi'
            required
          /> &nbsp; &nbsp;
          <label htmlFor='typeCurrency'>Döviz Cinsi</label> <br /><br />

          <button className='button101' type="submit">Hesapla</button>
          <button className='button101' onClick={clearRentForm}>Sil</button>
        </form>

        <div className='resultAreaInvestment' aria-live='polite'>
          {resultArea}
        </div>
      </div>
      <div> <br/><br/><br/><br/><br/><br/><br/> </div>
      <div> <CommentDisplay pageId={1}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </>
  )
}

export default Rent;
