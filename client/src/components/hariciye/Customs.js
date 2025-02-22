import React from 'react';
import {useNavigate} from "react-router-dom";
import "../../styles/car.css"; 
import Footer from "../Footer";

function Customs() {
  const navigate = useNavigate(); 

  return (
    <>
     <div className='customsMainArea'>
        <div className='customsMainPageTitlesArea'>
          <h2>EUMAPS.ORG<br />
          BEDELSİZ ARAÇ İTHALATI<br />
          VERGİ HESAPLAMA</h2> 
        </div>
        <div className='customsMainPageButtonsArea'>
          <button className='button102' onClick={()=>navigate("/benzin-dizel-arac-gumruk-vergi-hesaplama")}>Benzin/Dizel</button>
          <button className='button102' onClick={()=>navigate("/elektrikli-arac-gumruk-vergi-hesaplama")}>Elektrik</button>
          <button className='button102' onClick={()=>navigate("/hibrit-arac-gumruk-vergi-hesaplama")}>Hibrit</button>
          <button className='button102' onClick={()=>navigate("/plug-in-hibrit-arac-gumruk-vergi-hesaplama")}>Plug-In Hibrit</button>
        </div>
      </div>
      <div> <br/><br/><br/> <br/><br/><br/> <br/><br/><br/>  <br/><br/><br/> <br/><br/><br/> <Footer /> </div>   
      </>
  );
}

export default Customs;
