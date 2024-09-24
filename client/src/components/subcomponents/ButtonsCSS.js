import React from 'react';
import "../../styles/buttons.css"; 
import { objectsArray } from './ButtonsArray';

function ButtonsCSS() {

    const styleBtn = (index) => {
        navigator.clipboard.writeText(objectsArray[index - 1].css);
        alert('CSS copied to clipboard successfully!');
    } 

  return (
    <div>
        <h2>FREE CSS BUTTON STYLES</h2>
        <p>You are welcome to copy and use them but You cannot sell them. You cannot also show them as if it is your design. </p>
        <p>Of course I appreciate credits: "Abdulhakim Luanda, 2024, eumaps.org"</p>
        <div className="allButtonsArea">
            <button className="button1" onClick={() => styleBtn(1)}>COPY ME</button>
            <button className="button2" onClick={() => styleBtn(2)}>COPY ME</button>
            <button className="button3" onClick={() => styleBtn(3)}>COPY ME</button>
            <button className="button4" onClick={() => styleBtn(4)}>COPY ME</button>
            <button className="button5" onClick={() => styleBtn(5)}>COPY ME</button>
            <button className="button6" onClick={() => styleBtn(6)}>COPY ME</button>
            <button className="button7" onClick={() => styleBtn(7)}>COPY ME</button>
            <button className="button8" onClick={() => styleBtn(8)}>COPY ME</button>
            <button className="button8" onClick={() => styleBtn(9)}>COPY INPUT</button>
            <input type="number" className="input1" />
            <button className="button10" onClick={() => styleBtn(10)}>COPY ME</button>
            <button className="button11" onClick={() => styleBtn(11)}>COPY ME</button>
        </div>
    </div>
  )
}

export default ButtonsCSS