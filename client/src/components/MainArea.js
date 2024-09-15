import React from 'react';
import {BrowserRouter as Router, Routes, Route, Link} from "react-router-dom";
import SpeedOfLight from "./subcomponents/SpeedOfLight";
import Investment from "./subcomponents/Investment";
import Rent from "./subcomponents/Rent";
import IndexComp from "./subcomponents/IndexComp";

function MainArea() {
  return (
    <div className='mainArea'>
      <Routes>
        <Route path="/speed-of-light-calculator" element={<SpeedOfLight/>} />
        <Route path="/investment-return-calculator" element={<Investment/>} />
        <Route path="/kira-yardimi-hesaplama" element={<Rent/>} />
        <Route path="/" element={<IndexComp/>} />
      </Routes>
    </div> 
    
  )
}

export default MainArea