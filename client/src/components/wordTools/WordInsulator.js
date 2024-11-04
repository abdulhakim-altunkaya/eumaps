import React, { useState } from 'react';
import "../../styles/wordTools.css"; 
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

function WordInsulator() {
  const [text, setText] = useState("");
  const [insulatedText, setInsulatedText] = useState(null);

  const handleTextChange = (e) => {
    setText(e.target.value);
  };

  const handleInsulate = () => {
    // Remove punctuation and non-word characters using regex
    const cleanText = text.replace(/[^\w\sçğşöüıÇĞŞÖÜİ]/gi, ''); // Keeps only letters and spaces
    setInsulatedText(cleanText);
  };

  const handleClear = () => {
    setText("");
    setInsulatedText(null);
  };

  return (
    <div className='wordToolsArea'>
      <h2>Word Insulator</h2>
      <p>Put your text inside the box below, and get only the words. All punctuation, commas, dots, marks will be removed.</p>
      <textarea
        value={text}
        onChange={handleTextChange}
        rows="16"
        cols="50"
        placeholder="Enter your text here..."
      />
      <div>
        <button onClick={handleInsulate} className='button20155'>Insulate</button>
        <button onClick={handleClear} className='button20155'>Clear</button>
      </div>
      {insulatedText && (
        <div style={{ marginTop: '10px' }}>
          <h3>Insulated Text:</h3>
          <p>{insulatedText}</p>
        </div>
      )}
      <div> <br/><br/><br/><br/><br/><br/><br/> </div>
      <div> <CommentDisplay pageId={22}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </div>
  );
}

export default WordInsulator; 
