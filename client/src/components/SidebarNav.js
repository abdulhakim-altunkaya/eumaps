import {useState} from 'react';
import { useNavigate } from 'react-router-dom';

function SidebarNav() {

  const navigate = useNavigate();

  const [wordToolsToggle, setWordToolsToggle] = useState(false);
  const [mfaCalculatorsToggle, setMfaCalculatorsToggle] = useState(true);

  const toggleWordTools = () => {
    setWordToolsToggle(!wordToolsToggle);
    navigate("/tools");
  }

  const toggleMFACalculators = () => {
    navigate("/hariciye");
  }
 

  return (
    <div className='sidebarButtonsArea'>
      <div onClick={toggleMFACalculators} className='sidebarMainButtons'>Hariciye &#x25BC;</div>
      {
        mfaCalculatorsToggle && (
          <>
            <div className='sidebarSideButtons' 
              onClick={() => navigate("/arac-gumruk-vergi-hesaplama")}>Araç Gümrük Vergi Hesaplama</div>
            <div className='sidebarSideButtons' 
              onClick={() => navigate("/motorsiklet-gumruk-vergi-hesaplama")}>Motorsiklet Gümrük Vergi Hesaplama</div>
            <div className='sidebarSideButtons' 
              onClick={() => navigate("/kira-yardimi-hesaplama")}>Kira Yardımı Hesaplama</div>
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
            <div className='sidebarSideButtons' onClick={() => navigate("/investment-return-calculator")}>Investment Return Calculator</div>
            <div className='sidebarSideButtons' onClick={() => navigate("/free-css-buttons")}>Free CSS Buttons</div>
          </>
        )
      }
    </div>
  )
}

export default SidebarNav