import React from 'react';
import "../../styles/buttons.css"; 
import { objectsArray } from './ButtonsArray';
import CommentDisplay from '../CommentDisplay'; 

function ButtonsCSS() {

    const styleBtn = (index) => {
      const targetButton = objectsArray.find(obj => obj.id === `button${index}`);
      if(targetButton && targetButton.css) {

      }
      navigator.clipboard.writeText(targetButton.css);
      alert('CSS copied to clipboard successfully!');
    }  

  return (
    <div className='buttonsMainArea'>
        <h2>FREE CSS BUTTON STYLES</h2>
        <p>You are welcome to copy and use them but You cannot sell them. You cannot also show them as if it is your design. </p>
        <p>Of course I appreciate credits: "Abdulhakim Luanda, 2024, eumaps.org"</p>
        <div className="allButtonsArea">
            <button className="button1001" onClick={() => styleBtn(1001)}>COPY ME</button>
            <button className="button2002" onClick={() => styleBtn(2002)}>COPY ME</button>
            <button className="button3003" onClick={() => styleBtn(3003)}>COPY ME</button>
            <button className="button4004" onClick={() => styleBtn(4004)}>COPY ME</button>
            <button className="button5005" onClick={() => styleBtn(5005)}>COPY ME</button>
            <button className="button6006" onClick={() => styleBtn(6006)}>COPY ME</button>
            <button className="button7007" onClick={() => styleBtn(7007)}>COPY ME</button>
            <button className="button8008" onClick={() => styleBtn(8008)}>COPY ME</button>
            <button className="button8008" onClick={() => styleBtn(9009)}>COPY INPUT</button>
            <input type="number" className="input1" />
            <button className="button1010" onClick={() => styleBtn(1010)}>COPY ME</button>
            <button className="button1111" onClick={() => styleBtn(1111)}>COPY ME</button>
        </div>
        <div> <br/><br/><br/><br/><br/><br/><br/> </div>
        <div> <CommentDisplay pageId={25}/></div>
    </div>
  )
}

export default ButtonsCSS