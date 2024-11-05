import React, { useState } from 'react';
import "../../styles/wordTools.css"; 
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

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
    <>
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
        <div>
          <button onClick={handleSplit} className='button20155'>Split</button>
          <button onClick={handleClear} className='button20155'>Clear</button>
        </div>
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
      <div> <br/><br/><br/><br/><br/><br/><br/> </div>
      <div> <CommentDisplay pageId={23}/></div>
      <div> <br/><br/><br/> <Footer /> </div>
    </>
  );
}

export default SentenceSplitter;
