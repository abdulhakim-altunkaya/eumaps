import React from 'react';
import {useNavigate} from "react-router-dom";
import "../styles/ConvertersMain.css"; 

function MainHariciye() {
  
  const navigate = useNavigate(); 

  return (
    <div className='mainAreasMainComponents'>
      <h3 className='convertersMainH1Long'>Dışişleri Bakanlığı Hesaplamaları</h3>
      <div className='convertersMain'>
        <div className='convertersIconsMainArea'>
            <div className="converter-item" onClick={ () => navigate("/arac-gumruk-vergi-hesaplama")}>
                <span className="converter-name2">Araç Gümrük Vergi Hesaplama</span>
                <span className="icon-wrapper"><img src="/icons/car2.png" className="unitIcons" 
                    alt="Ara Gümrük Vergi Hesaplama sayfasına gitmek için üzerine tıklayabileceğiniz resim"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/motorsiklet-gumruk-vergi-hesaplama")}>
                <span className="converter-name2">Motorsiklet Gümrük Vergi Hesaplama</span>
                <span className="icon-wrapper"><img src="/icons/motorbike.png" className="unitIcons" 
                    alt="Motorsiklet Gümrük Vergi Hesaplama sayfasına gitmek için üzerine tıklayabileceğiniz resim"/></span>
            </div>
            <div className="converter-item" onClick={ () => navigate("/kira-yardimi-hesaplama")}>
                <span className="converter-name2">Kira Yardımı Hesaplama</span>
                <span className="icon-wrapper"><img src="/icons/rent.png" className="unitIcons" 
                    alt="Kira yardımı hesaplamak için üzerine tıklayabileceğiniz resim"/></span>
            </div>
        </div>
      </div>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
      <br/>
    </div>

  )
}

export default MainHariciye