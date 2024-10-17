import React from 'react';
import {useNavigate} from "react-router-dom";
import "../styles/ConvertersMain.css"; 

function MainTools() {
  
  const navigate = useNavigate();

  return (
    <div>
        <h1 className='convertersMainH1Short'>Tools</h1>
        <div className='convertersMain'>
            <div className='convertersIconsMainArea'>          
                <div className="converter-item" onClick={ () => navigate("/character-and-word-counter")}>
                    <span className="converter-name2">Character & Word Counter</span>
                    <span className="icon-wrapper"><img src="/icons/sentence.png" className="unitIcons" 
                        alt="Clickable Weight Icon"/></span>
                </div>
                <div className="converter-item" onClick={ () => navigate("/word-insulator")}>
                    <span className="converter-name">Word Insulator</span>
                    <span className="icon-wrapper"><img src="/icons/sentence.png" className="unitIcons" 
                        alt="Clickable Length Icon"/></span>
                </div>
                <div className="converter-item" onClick={ () => navigate("/sentence-splitter")}>
                    <span className="converter-name">Sentence Splitter</span>
                    <span className="icon-wrapper"><img src="/icons/sentence.png" className="unitIcons" 
                        alt="Clickable Temperature Icon"/></span>
                </div>
            </div>
            <div className='convertersIconsMainArea'>
                <div className="converter-item" onClick={ () => navigate("/schengen-visa-calculator")}>
                    <span className="converter-name2">Schengen Visa Calculator</span>
                    <span className="icon-wrapper"><img src="/icons/schengen.png" className="unitIcons" 
                            alt="Clickable Area Icon"/></span>
                </div>
                <div className="converter-item" onClick={ () => navigate("/investment-return-calculator")}>
                    <span className="converter-name2">Investment Return Calculator</span>
                    <span className="icon-wrapper"><img src="/icons/investment.png" className="unitIcons" 
                        alt="Clickable Area Icon"/></span>
                </div>
                <div className="converter-item" onClick={ () => navigate("/free-css-buttons")}>
                    <span className="converter-name2">Free CSS Buttons</span>
                    <span className="icon-wrapper"><img src="/icons/freecssbuttons.png" className="unitIcons" 
                        alt="Clickable FREE css buttons Icon"/></span>
                </div>
            </div>
        </div>
    </div>
    

  )
}

export default MainTools;