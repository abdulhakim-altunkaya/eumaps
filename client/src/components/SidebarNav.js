import React, {useState} from 'react';
import { useNavigate } from 'react-router-dom';

function SidebarNav() {

  const navigate = useNavigate();

  const [converterToggle, setConverterToggle] = useState(false);
  const [wordToolsToggle, setWordToolsToggle] = useState(false);
  const [mfaCalculatorsToggle, setMfaCalculatorsToggle] = useState(false);

  const toggleConverters = () => {
    setConverterToggle(!converterToggle);
    navigate("/converters-calculators");
  }

  const toggleWordTools = () => {
    setWordToolsToggle(!wordToolsToggle);
    navigate("/tools");
  }

  const toggleMFACalculators = () => {
    setMfaCalculatorsToggle(!mfaCalculatorsToggle);
  }


  return (
    <div className='sidebarButtonsArea'>
      <div onClick={toggleMFACalculators} className='sidebarMainButtons'>Hariciye &#x25BC;</div>
      {
        mfaCalculatorsToggle && (
          <>
            <div className='sidebarSideButtons' onClick={() => navigate("/arac-gumruk-vergi-hesaplama")}>Araç Gümrük Vergi Hesaplama</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/motorsiklet-gumruk-vergi-hesaplama")}>Motorsiklet Gümrük Vergi Hesaplama</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/kira-yardimi-hesaplama")}>Kira Yardımı Hesaplama</div>
          </>
        )
      }
      
      <div className='sidebarMainButtons' onClick={() => navigate("/free-css-buttons")}>Free CSS Buttons</div>
      <div onClick={toggleConverters} className='sidebarMainButtons'>Converters & Calculators &#x25BC;</div>
      {
        converterToggle && (
          <>
            <div className='sidebarSideButtons' onClick={() => navigate("/weight-units-converter")}>Weight Converter</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/length-units-converter")}>Length Converter</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/temperature-units-converter")}>Temperature Converter</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/area-units-converter")}>Area Converter</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/volume-units-converter")}>Volume Converter</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/time-units-converter")}>Time Converter</div>
            <div className='sidebarSideButtons' 
              onClick={() => navigate("/einstein-mass-energy-converter")}>Einstein Mass-Energy Converter</div>
            <div className='sidebarSideButtons' 
              onClick={() => navigate("/einstein-time-dilation-calculator")}>Einstein Time Dilation Calculator (Speed)</div>
            <div className='sidebarSideButtons' 
              onClick={() => navigate("/einstein-gravitational-time-dilation-calculator")}>Einstein Time Dilation Calculator (Gravity)</div>
          </>
        )
      }
      <div onClick={toggleWordTools} className='sidebarMainButtons'>Tools &#9660;</div>
      {
        wordToolsToggle && (
          <>
            <div className='sidebarSideButtons' onClick={() => navigate("/character-and-word-counter")}>Character & Word Counter</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/word-insulator")}>Word Insulator</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/sentence-splitter")}>Sentence Splitter</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/schengen-visa-calculator")}>Schengen Visa Calculator</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/investment-return-calculator")}>Investment Return Calculator</div>
          </>
        )
      }
    </div>
  )
}

export default SidebarNav