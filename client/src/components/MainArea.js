import React from 'react';
import {BrowserRouter as Router, Routes, Route, Link} from "react-router-dom";
import SpeedOfLight from "./subcomponents/SpeedOfLight";
import IndexComp from "./subcomponents/IndexComp";

function MainArea() {
  return (
    <div className='mainArea'>
      <Routes>
        <Route path="/speedoflight" element={<SpeedOfLight/>} />
        <Route path="/" element={<IndexComp/>} />
      </Routes>
    </div>
    
  )
}

export default MainArea