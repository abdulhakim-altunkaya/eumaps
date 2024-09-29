import React, { useState } from 'react';
import "../../styles/wordTools.css"; 

function SentenceSplitter() {
  const [text, setText] = useState("");
  const [sentences, setSentences] = useState([]);

  const handleTextChange = (e) => {
    setText(e.target.value);
  };

  const handleSplit = () => {
    // Split text into sentences, including the last sentence without punctuation
    const splitSentences = text.match(/[^.!?]+[.!?]*\s*/g) || []; // Match sentences even if they don't end with punctuation
    setSentences(splitSentences.map(sentence => sentence.trim())); // Trim extra spaces and set the state
  };

  const handleClear = () => {
    setText("");
    setSentences([]);
  };

  return (
    <div className='wordToolsArea'>
      <h2>Sentence Splitter</h2>
      <p>Enter your text below and split it into individual sentences for easy reading or copying.</p>
      <textarea
        value={text}
        onChange={handleTextChange}
        rows="16"
        cols="50"
        placeholder="Enter your text here..."
      />
      <button onClick={handleSplit} className='button201'>Split</button>
      <button onClick={handleClear} className='button201'>Clear</button>

      {sentences.length > 0 && (
        <div style={{ marginTop: '10px' }}>
          <h3>Split Sentences:</h3>
          <ul>
            {sentences.map((sentence, index) => (
              <li key={index} style={{ marginBottom: '5px' }}>{sentence}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SentenceSplitter;
