import React from 'react';
import {useNavigate} from "react-router-dom";
import "../../styles/car.css"; 

function Customs() {

  const navigate = useNavigate(); 

  return (
    <div className='customsMainArea'>
      <div className='customsMainPageTitlesArea'>
        <h2>EUMAPS.ORG<br />
        BEDELSİZ ARAÇ İTHALATI<br />
        VERGİ HESAPLAMA</h2>
      </div>
      <div className='customsMainPageButtonsArea'>
        <button className='button2' onClick={()=>navigate("/benzin-dizel-arac-gumruk-vergi-hesaplama")}>Benzin/Dizel</button>
        <button className='button2' onClick={()=>navigate("/elektrikli-arac-gumruk-vergi-hesaplama")}>Elektrik</button>
        <button className='button2' onClick={()=>navigate("/hibrit-arac-gumruk-vergi-hesaplama")}>Hibrit</button>
        
      </div>
    </div>
  );
}

export default Customs;
