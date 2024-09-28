import React, { useState } from 'react';
import "../../styles/wordTools.css"; 

function Counter() {
  const [text, setText] = useState("");
  const [characterCount, setCharacterCount] = useState(null);
  const [characterCountWithoutSpaces, setCharacterCountWithoutSpaces] = useState(null);
  const [wordCount, setWordCount] = useState(null);
  const [isTwitterLimit, setIsTwitterLimit] = useState(null);
  
  const twitterCharacterLimit = 280;

  const handleTextChange = (e) => {
    setText(e.target.value);
  };

  const handleCount = () => {
    const countWithSpaces = text.length;
    const countWithoutSpaces = text.replace(/\s+/g, '').length;
    const wordsArray = text.trim().split(/\s+/);
    const countWords = text.trim() === "" ? 0 : wordsArray.length;
    const twitterLimitCheck = countWithSpaces <= twitterCharacterLimit;

    setCharacterCount(countWithSpaces);
    setCharacterCountWithoutSpaces(countWithoutSpaces);
    setWordCount(countWords);
    setIsTwitterLimit(twitterLimitCheck);
  };

  const handleClear = () => {
    setText("");
    setCharacterCount(null);
    setCharacterCountWithoutSpaces(null);
    setWordCount(null);
    setIsTwitterLimit(null);
  };

  return (
    <div  className='wordToolsArea'>
      <h2>Character and Word Counter</h2>
      <textarea
        value={text}
        onChange={handleTextChange}
        rows="20"
        cols="65"
        placeholder="Enter your text here..."
        style={{ display: 'block', marginBottom: '10px' }}
      />
      <button onClick={handleCount} className='button201'>Count</button>
      <button onClick={handleClear} className='button201'>Clear</button>

      {characterCount !== null && (
        <div style={{ marginTop: '10px' }}>
          <p>Characters (with spaces): {characterCount}</p>
          <p>Characters (without spaces): {characterCountWithoutSpaces}</p>
          <p>Word count: {wordCount}</p>

          <p>
            {isTwitterLimit ? (
              <span style={{ color: 'green', display: 'flex', alignItems: 'center' }}>
                ✅ Fits within X/Twitter {twitterCharacterLimit}-character limit
              </span>
            ) : (
              <span style={{ color: 'red', display: 'flex', alignItems: 'center' }}>
                ❌ Exceeds X/Twitter {twitterCharacterLimit}-character limit
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export default Counter;