import React, { useState } from 'react';
import "../../styles/wordTools.css"; 

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
        rows="20"
        cols="65"
        placeholder="Enter your text here..."
        style={{ display: 'block', marginBottom: '10px', fontSize: '14px' }}
      />
      <button onClick={handleInsulate} className='button201'>Insulate</button>
      <button onClick={handleClear} className='button201'>Clear</button>

      {insulatedText && (
        <div style={{ marginTop: '10px' }}>
          <h3>Insulated Text:</h3>
          <p>{insulatedText}</p>
        </div>
      )}
    </div>
  );
}

export default WordInsulator;
